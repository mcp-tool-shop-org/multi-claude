import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import { isPacketTerminal } from '../lib/transitions.js';
import { checkRoleConflict } from '../lib/conflicts.js';
import type { McfResult, PacketStatus } from '../types/common.js';

const LEASE_HOURS = 2;

export interface ClaimResult {
  claim_id: string;
  packet_id: string;
  attempt_id: string;
  attempt_number: number;
  lease_expires_at: string;
  role: string;
  playbook_id: string;
  goal: string;
  allowed_files: string[];
  forbidden_files: string[];
  verification_steps: unknown[];
  contract_delta_policy: string;
}

export interface ProgressResult {
  packet_id: string;
  status: 'in_progress';
}

export function runClaim(
  dbPath: string,
  packetId: string,
  worker: string,
  session?: string,
  model?: string,
  branch?: string,
  worktree?: string,
): McfResult<ClaimResult> {
  const db = openDb(dbPath);
  try {
    // The entire claim must be one atomic transaction.
    // If any check fails, nothing is written.
    const result = db.transaction(() => {
      // 1. Verify packet exists and get its state
      const packet = db.prepare(`
        SELECT packet_id, feature_id, status, role, playbook_id, goal,
               allowed_files, forbidden_files, verification_profile_id,
               verification_overrides, contract_delta_policy
        FROM packets WHERE packet_id = ?
      `).get(packetId) as {
        packet_id: string; feature_id: string; status: PacketStatus;
        role: string; playbook_id: string; goal: string;
        allowed_files: string; forbidden_files: string;
        verification_profile_id: string; verification_overrides: string | null;
        contract_delta_policy: string;
      } | undefined;

      if (!packet) {
        return mcfError('mcf claim', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
      }
      if (isPacketTerminal(packet.status)) {
        return mcfError('mcf claim', ERR.TERMINAL_STATE, `Packet '${packetId}' is in terminal state '${packet.status}'`, { packet_id: packetId, current_status: packet.status });
      }
      if (packet.status !== 'ready') {
        return mcfError('mcf claim', ERR.PACKET_NOT_READY, `Packet '${packetId}' status is '${packet.status}', expected 'ready'`, { packet_id: packetId, current_status: packet.status });
      }

      // 2. Verify all hard dependencies are merged
      const unmetDeps = db.prepare(`
        SELECT pd.depends_on_packet_id, p.status
        FROM packet_dependencies pd
        JOIN packets p ON p.packet_id = pd.depends_on_packet_id
        WHERE pd.packet_id = ? AND pd.dependency_type = 'hard' AND p.status != 'merged'
      `).all(packetId) as Array<{ depends_on_packet_id: string; status: string }>;

      if (unmetDeps.length > 0) {
        return mcfError('mcf claim', ERR.DEPENDENCIES_NOT_MET,
          `${unmetDeps.length} hard dependencies not merged`,
          { unmet: unmetDeps.map(d => ({ packet_id: d.depends_on_packet_id, status: d.status })) },
        );
      }

      // 3. Verify no active claim exists
      const activeClaim = db.prepare(`
        SELECT claim_id, claimed_by, lease_expires_at
        FROM claims WHERE packet_id = ? AND is_active = 1
      `).get(packetId) as { claim_id: string; claimed_by: string; lease_expires_at: string } | undefined;

      if (activeClaim) {
        return mcfError('mcf claim', ERR.ALREADY_CLAIMED,
          `Packet '${packetId}' is already claimed by '${activeClaim.claimed_by}'`,
          { claim_id: activeClaim.claim_id, claimed_by: activeClaim.claimed_by, lease_expires_at: activeClaim.lease_expires_at },
        );
      }

      // 4. Verify role conflict matrix
      const conflict = checkRoleConflict(db, packetId, packet.feature_id, worker, packet.role);
      if (conflict) {
        return mcfError('mcf claim', ERR.ROLE_CONFLICT,
          conflict.conflicting_claim,
          { conflict_type: conflict.conflict_type, conflicting_claim: conflict.conflicting_claim },
        );
      }

      // 5. Determine next attempt number
      const maxAttempt = db.prepare(
        `SELECT COALESCE(MAX(attempt_number), 0) as max_num FROM packet_attempts WHERE packet_id = ?`
      ).get(packetId) as { max_num: number };
      const attemptNumber = maxAttempt.max_num + 1;

      // 6. Create attempt
      const now = nowISO();
      const attemptId = generateId('att');
      const claimId = generateId('clm');

      db.prepare(`
        INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, started_at, session_id, branch_name, worktree_path, model_name, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(attemptId, packetId, attemptNumber, worker, now, session ?? null, branch ?? null, worktree ?? null, model ?? null, packet.role);

      // 7. Create claim with lease
      const leaseExpiry = new Date(Date.now() + LEASE_HOURS * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

      db.prepare(`
        INSERT INTO claims (claim_id, packet_id, attempt_id, claimed_by, session_id, claimed_at, lease_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(claimId, packetId, attemptId, worker, session ?? null, now, leaseExpiry);

      // 8. Update packet status
      db.prepare(`UPDATE packets SET status = 'claimed', updated_at = ? WHERE packet_id = ?`).run(now, packetId);

      // 9. Log transition
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'ready', 'claimed', ?, ?, 'claim granted', ?)
      `).run(generateId('tr'), packetId, packet.role, worker, now);

      // Load verification steps from profile
      const profile = db.prepare(`
        SELECT steps FROM verification_profiles WHERE verification_profile_id = ?
      `).get(packet.verification_profile_id) as { steps: string } | undefined;

      let verificationSteps: unknown[] = [];
      if (profile) {
        try { verificationSteps = JSON.parse(profile.steps) as unknown[]; } catch { /* empty */ }
      }
      // Merge packet-level overrides if any
      if (packet.verification_overrides) {
        try {
          const overrides = JSON.parse(packet.verification_overrides) as unknown[];
          verificationSteps = [...verificationSteps, ...overrides];
        } catch { /* empty */ }
      }

      return {
        ok: true as const,
        command: 'mcf claim',
        result: {
          claim_id: claimId,
          packet_id: packetId,
          attempt_id: attemptId,
          attempt_number: attemptNumber,
          lease_expires_at: leaseExpiry,
          role: packet.role,
          playbook_id: packet.playbook_id,
          goal: packet.goal,
          allowed_files: JSON.parse(packet.allowed_files) as string[],
          forbidden_files: JSON.parse(packet.forbidden_files) as string[],
          verification_steps: verificationSteps,
          contract_delta_policy: packet.contract_delta_policy,
        },
        transitions: [{ entity_type: 'packet' as const, entity_id: packetId, from_state: 'ready', to_state: 'claimed' }],
      };
    })();

    return result;
  } finally {
    db.close();
  }
}

export function runProgress(
  dbPath: string,
  packetId: string,
  worker: string,
): McfResult<ProgressResult> {
  const db = openDb(dbPath);
  try {
    const packet = db.prepare('SELECT status FROM packets WHERE packet_id = ?').get(packetId) as { status: string } | undefined;
    if (!packet) {
      return mcfError('mcf progress', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
    }
    if (packet.status !== 'claimed') {
      return mcfError('mcf progress', ERR.PACKET_NOT_CLAIMED, `Packet '${packetId}' is '${packet.status}', expected 'claimed'`, { packet_id: packetId, current_status: packet.status });
    }

    const activeClaim = db.prepare(`
      SELECT claim_id, claimed_by FROM claims WHERE packet_id = ? AND is_active = 1
    `).get(packetId) as { claim_id: string; claimed_by: string } | undefined;

    if (!activeClaim || activeClaim.claimed_by !== worker) {
      return mcfError('mcf progress', ERR.NOT_OWNER, `Worker '${worker}' does not own the active claim`, { packet_id: packetId });
    }

    const now = nowISO();

    db.transaction(() => {
      db.prepare(`UPDATE packets SET status = 'in_progress', updated_at = ? WHERE packet_id = ?`).run(now, packetId);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'claimed', 'in_progress', 'builder', ?, 'work started', ?)
      `).run(generateId('tr'), packetId, worker, now);
    })();

    return {
      ok: true,
      command: 'mcf progress',
      result: { packet_id: packetId, status: 'in_progress' },
      transitions: [{ entity_type: 'packet', entity_id: packetId, from_state: 'claimed', to_state: 'in_progress' }],
    };
  } finally {
    db.close();
  }
}

export function claimCommand(): Command {
  const cmd = new Command('claim')
    .description('Claim a packet for execution')
    .requiredOption('--packet <id>', 'Packet ID')
    .requiredOption('--worker <name>', 'Worker identity')
    .option('--session <id>', 'Claude session identifier')
    .option('--model <name>', 'Model name (opus/sonnet/haiku)')
    .option('--branch <name>', 'Git branch')
    .option('--worktree <path>', 'Worktree path')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runClaim(opts.dbPath, opts.packet, opts.worker, opts.session, opts.model, opts.branch, opts.worktree);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}

export function progressCommand(): Command {
  const cmd = new Command('progress')
    .description('Move a claimed packet to in_progress')
    .requiredOption('--packet <id>', 'Packet ID')
    .requiredOption('--worker <name>', 'Worker identity')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runProgress(opts.dbPath, opts.packet, opts.worker);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
