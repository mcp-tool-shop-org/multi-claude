import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { isValidPacketId, generateId, nowISO } from '../lib/ids.js';
import { isFeatureTerminal } from '../lib/transitions.js';
import type { McfResult, PacketLayer, PacketRole, FeatureStatus } from '../types/common.js';

export interface PacketDef {
  packet_id: string;
  title: string;
  layer: PacketLayer;
  descriptor: string;
  role: PacketRole;
  playbook_id: string;
  goal: string;
  acceptance_criteria?: string[];
  context?: string;
  allowed_files: string[];
  forbidden_files?: string[];
  module_family?: string;
  protected_file_access?: string;
  seam_file_access?: string;
  merge_with_layer?: string;
  sequence_display?: number;
  verification_profile_id: string;
  verification_overrides?: unknown;
  rule_profile?: string;
  contract_delta_policy?: string;
  knowledge_writeback_required?: boolean;
  merge_target?: string;
  depends_on?: string[];
  soft_depends_on?: string[];
}

export interface PacketCreateResult {
  packets_created: Array<{
    packet_id: string;
    layer: string;
    role: string;
    status: string;
    depends_on: string[];
    soft_depends_on: string[];
  }>;
  dependency_graph_valid: boolean;
}

export interface PacketReadyResult {
  packets_readied: string[];
  feature_status: string;
  approval_id: string | null;
}

export function runPacketCreate(
  dbPath: string,
  featureId: string,
  packets: PacketDef[],
): McfResult<PacketCreateResult> {
  const db = openDb(dbPath);
  try {
    const feature = db.prepare('SELECT feature_id, status, repo_slug FROM features WHERE feature_id = ?').get(featureId) as { feature_id: string; status: FeatureStatus; repo_slug: string } | undefined;

    if (!feature) {
      return mcfError('mcf packet create', ERR.FEATURE_NOT_FOUND, `Feature '${featureId}' not found`, { feature_id: featureId });
    }
    if (feature.status !== 'approved' && feature.status !== 'in_progress') {
      return mcfError('mcf packet create', ERR.FEATURE_NOT_APPROVED, `Feature '${featureId}' status is '${feature.status}', expected 'approved' or 'in_progress'`, { feature_id: featureId, current_status: feature.status });
    }

    // Validate packet IDs
    for (const p of packets) {
      if (!isValidPacketId(p.packet_id)) {
        return mcfError('mcf packet create', ERR.INVALID_PACKET_ID, `Packet ID '${p.packet_id}' does not follow convention`, { packet_id: p.packet_id });
      }
      const existing = db.prepare('SELECT packet_id FROM packets WHERE packet_id = ?').get(p.packet_id);
      if (existing) {
        return mcfError('mcf packet create', ERR.DUPLICATE_PACKET, `Packet '${p.packet_id}' already exists`, { packet_id: p.packet_id });
      }
    }

    // Validate dependencies reference existing or batch-created packets
    const batchIds = new Set(packets.map(p => p.packet_id));
    for (const p of packets) {
      for (const dep of [...(p.depends_on ?? []), ...(p.soft_depends_on ?? [])]) {
        if (!batchIds.has(dep)) {
          const existing = db.prepare('SELECT packet_id FROM packets WHERE packet_id = ?').get(dep);
          if (!existing) {
            return mcfError('mcf packet create', ERR.DEPENDENCY_NOT_FOUND, `Dependency '${dep}' not found`, { packet_id: p.packet_id, dependency: dep });
          }
        }
        if (dep === p.packet_id) {
          return mcfError('mcf packet create', ERR.CIRCULAR_DEPENDENCY, `Packet '${p.packet_id}' depends on itself`, { packet_id: p.packet_id });
        }
      }
    }

    // Validate test packets have merge_with_layer
    for (const p of packets) {
      if (p.layer === 'test' && !p.merge_with_layer) {
        return mcfError('mcf packet create', ERR.MISSING_MERGE_LAYER, `Test packet '${p.packet_id}' requires merge_with_layer`, { packet_id: p.packet_id });
      }
    }

    const now = nowISO();
    const created: PacketCreateResult['packets_created'] = [];

    db.transaction(() => {
      for (const p of packets) {
        db.prepare(`
          INSERT INTO packets (
            packet_id, feature_id, title, layer, descriptor, role, playbook_id,
            status, goal, acceptance_criteria, context,
            allowed_files, forbidden_files, module_family,
            protected_file_access, seam_file_access, merge_with_layer,
            sequence_display, verification_profile_id, verification_overrides,
            rule_profile, contract_delta_policy, knowledge_writeback_required,
            merge_target, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'coordinator', ?, ?)
        `).run(
          p.packet_id, featureId, p.title, p.layer, p.descriptor, p.role, p.playbook_id,
          p.goal,
          p.acceptance_criteria ? JSON.stringify(p.acceptance_criteria) : null,
          p.context ?? null,
          JSON.stringify(p.allowed_files),
          JSON.stringify(p.forbidden_files ?? []),
          p.module_family ?? null,
          p.protected_file_access ?? 'none',
          p.seam_file_access ?? 'none',
          p.merge_with_layer ?? null,
          p.sequence_display ?? null,
          p.verification_profile_id,
          p.verification_overrides ? JSON.stringify(p.verification_overrides) : null,
          p.rule_profile ?? 'builder',
          p.contract_delta_policy ?? 'declare',
          p.knowledge_writeback_required !== false ? 1 : 0,
          p.merge_target ?? null,
          now, now,
        );

        // Insert dependencies
        for (const dep of p.depends_on ?? []) {
          db.prepare(`
            INSERT INTO packet_dependencies (packet_id, depends_on_packet_id, dependency_type, created_at)
            VALUES (?, ?, 'hard', ?)
          `).run(p.packet_id, dep, now);
        }
        for (const dep of p.soft_depends_on ?? []) {
          db.prepare(`
            INSERT INTO packet_dependencies (packet_id, depends_on_packet_id, dependency_type, created_at)
            VALUES (?, ?, 'soft', ?)
          `).run(p.packet_id, dep, now);
        }

        // Log transition
        db.prepare(`
          INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
          VALUES (?, 'packet', ?, NULL, 'draft', 'coordinator', 'cli', 'packet created', ?)
        `).run(generateId('tr'), p.packet_id, now);

        created.push({
          packet_id: p.packet_id,
          layer: p.layer,
          role: p.role,
          status: 'draft',
          depends_on: p.depends_on ?? [],
          soft_depends_on: p.soft_depends_on ?? [],
        });
      }
    })();

    return {
      ok: true,
      command: 'mcf packet create',
      result: { packets_created: created, dependency_graph_valid: true },
      transitions: created.map(p => ({
        entity_type: 'packet' as const,
        entity_id: p.packet_id,
        from_state: null,
        to_state: 'draft',
      })),
    };
  } finally {
    db.close();
  }
}

export function runPacketReady(
  dbPath: string,
  packetIds: string[],
  actor: string,
  approveGraph = false,
): McfResult<PacketReadyResult> {
  const db = openDb(dbPath);
  try {
    const now = nowISO();
    const readied: string[] = [];
    let featureStatus = '';
    let approvalId: string | null = null;

    db.transaction(() => {
      for (const packetId of packetIds) {
        const packet = db.prepare('SELECT packet_id, status, feature_id FROM packets WHERE packet_id = ?').get(packetId) as { packet_id: string; status: string; feature_id: string } | undefined;

        if (!packet) throw new Error(`PACKET_NOT_FOUND:${packetId}`);
        if (packet.status !== 'draft') throw new Error(`INVALID_STATE:${packetId}:${packet.status}`);

        db.prepare(`UPDATE packets SET status = 'ready', updated_at = ? WHERE packet_id = ?`).run(now, packetId);
        db.prepare(`
          INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
          VALUES (?, 'packet', ?, 'draft', 'ready', 'human', ?, 'packet readied', ?)
        `).run(generateId('tr'), packetId, actor, now);

        readied.push(packetId);

        // Update feature to in_progress if currently approved
        const feature = db.prepare('SELECT status FROM features WHERE feature_id = ?').get(packet.feature_id) as { status: string };
        if (feature.status === 'approved') {
          db.prepare(`UPDATE features SET status = 'in_progress', updated_at = ? WHERE feature_id = ?`).run(now, packet.feature_id);
          db.prepare(`
            INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
            VALUES (?, 'feature', ?, 'approved', 'in_progress', 'human', ?, 'first packet readied', ?)
          `).run(generateId('tr'), packet.feature_id, actor, now);
        }
        featureStatus = db.prepare('SELECT status FROM features WHERE feature_id = ?').pluck().get(packet.feature_id) as string;
      }

      if (approveGraph) {
        approvalId = generateId('apr');
        const featureId = db.prepare('SELECT feature_id FROM packets WHERE packet_id = ?').pluck().get(packetIds[0]!) as string;
        db.prepare(`
          INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor, created_at)
          VALUES (?, 'packet_graph', ?, 'packet_graph_approval', 'approved', ?, ?)
        `).run(approvalId, featureId, actor, now);
      }
    })();

    return {
      ok: true,
      command: 'mcf packet ready',
      result: { packets_readied: readied, feature_status: featureStatus, approval_id: approvalId },
      transitions: readied.map(id => ({
        entity_type: 'packet' as const,
        entity_id: id,
        from_state: 'draft',
        to_state: 'ready',
      })),
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('PACKET_NOT_FOUND:')) {
      return mcfError('mcf packet ready', ERR.PACKET_NOT_FOUND, msg, {});
    }
    if (msg.startsWith('INVALID_STATE:')) {
      const parts = msg.split(':');
      return mcfError('mcf packet ready', ERR.INVALID_STATE, `Packet '${parts[1]}' is '${parts[2]}', expected 'draft'`, { packet_id: parts[1], current_status: parts[2] });
    }
    throw e;
  } finally {
    db.close();
  }
}

export function packetCommand(): Command {
  const cmd = new Command('packet').description('Manage packets');

  cmd.command('create')
    .description('Create packets for a feature')
    .requiredOption('--feature <id>', 'Parent feature ID')
    .requiredOption('--from-file <path>', 'JSON file with packet definitions')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const raw = readFileSync(opts.fromFile, 'utf-8');
      const packets: PacketDef[] = JSON.parse(raw);
      const result = runPacketCreate(opts.dbPath, opts.feature, packets);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('ready')
    .description('Move packets from draft to ready')
    .requiredOption('--packet <ids...>', 'Packet IDs')
    .requiredOption('--actor <name>', 'Human identity')
    .option('--approve-graph', 'Create packet graph approval', false)
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runPacketReady(opts.dbPath, opts.packet, opts.actor, opts.approveGraph);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
