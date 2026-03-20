/**
 * Handoff Spine — Bridge: Execution DB → HandoffPacket.
 *
 * Maps existing execution DB packet rows into DeriveHandoffInput
 * so they can flow through the Handoff Spine rendering chain.
 *
 * This is the Phase 2 integration seam — execution truth (packets table,
 * features table, dependencies) is mapped to the spine's instruction/
 * constraint/prohibition model.
 */

import type Database from 'better-sqlite3';
import type { DeriveHandoffInput } from '../derive/derive-handoff-packet.js';
import type { HandoffInstructionLayer, HandoffLane } from '../schema/packet.js';
import type { DecisionSource, RejectionSource } from '../derive/derive-decisions.js';
import type { OpenLoopSource } from '../derive/derive-open-loops.js';
import type { ArtifactRefSource } from '../derive/derive-artifact-refs.js';

// ── Row types from execution DB ──────────────────────────────────────

interface ExecutionPacketRow {
  packet_id: string;
  feature_id: string;
  title: string;
  layer: string;
  role: string;
  goal: string;
  status: string;
  acceptance_criteria: string | null;
  context: string | null;
  allowed_files: string;
  forbidden_files: string;
  forbidden_rationale: string;
  reference_files: string;
  module_family: string | null;
  protected_file_access: string;
  seam_file_access: string;
  contract_delta_policy: string;
  knowledge_writeback_required: number;
}

interface ExecutionFeatureRow {
  feature_id: string;
  title: string;
  merge_target: string;
}

interface ExecutionDepRow {
  depends_on_packet_id: string;
  dependency_type: string;
  dep_status: string;
}

interface ExecutionAttemptRow {
  attempt_number: number;
  started_by: string;
  end_reason: string | null;
}

// ── Public API ───────────────────────────────────────────────────────

export interface BridgeInput {
  db: Database.Database;
  packetId: string;
  runId: string;
  repoRoot?: string;
  lane?: HandoffLane;
}

export interface BridgeResult {
  ok: true;
  input: DeriveHandoffInput;
  /** The raw packet markdown summary for fallback/audit */
  packetTitle: string;
}

export interface BridgeError {
  ok: false;
  error: string;
}

/**
 * Bridge an execution DB packet into a DeriveHandoffInput.
 * Reads from the execution DB (packets, features, packet_dependencies,
 * packet_attempts tables) and maps to the spine's model.
 */
export function bridgeExecutionPacket(
  input: BridgeInput,
): BridgeResult | BridgeError {
  const { db, packetId, runId, repoRoot, lane } = input;

  // 1. Read packet row
  const packet = db.prepare('SELECT * FROM packets WHERE packet_id = ?')
    .get(packetId) as ExecutionPacketRow | undefined;
  if (!packet) {
    return { ok: false, error: `Packet '${packetId}' not found in execution DB` };
  }

  // 2. Read feature
  const feature = db.prepare(
    'SELECT feature_id, title, merge_target FROM features WHERE feature_id = ?',
  ).get(packet.feature_id) as ExecutionFeatureRow | undefined;
  if (!feature) {
    return { ok: false, error: `Feature '${packet.feature_id}' not found` };
  }

  // 3. Read dependencies
  const deps = db.prepare(`
    SELECT pd.depends_on_packet_id, pd.dependency_type, p.status as dep_status
    FROM packet_dependencies pd
    JOIN packets p ON p.packet_id = pd.depends_on_packet_id
    WHERE pd.packet_id = ?
  `).all(packetId) as ExecutionDepRow[];

  // 4. Read attempt history
  const attempts = db.prepare(
    'SELECT attempt_number, started_by, end_reason FROM packet_attempts WHERE packet_id = ? ORDER BY attempt_number',
  ).all(packetId) as ExecutionAttemptRow[];

  // 5. Parse JSON fields
  const allowedFiles = safeParseArray(packet.allowed_files);
  const forbiddenFiles = safeParseArray(packet.forbidden_files);
  const forbiddenRationale = safeParseRecord(packet.forbidden_rationale);
  const referenceFiles = safeParseArray(packet.reference_files);
  const criteria = packet.acceptance_criteria
    ? safeParseArray(packet.acceptance_criteria)
    : [];

  // 6. Build instruction layer
  const instructions = buildInstructionLayer(
    packet, feature, allowedFiles, forbiddenFiles,
    forbiddenRationale, referenceFiles, criteria,
  );

  // 7. Build summary
  const summary = buildSummary(packet, feature, attempts);

  // 8. Build source objects (mostly empty for fresh worker launch)
  const decisionSource: DecisionSource = {
    approvals: [],
    contractDeltas: [],
  };

  const rejectionSource: RejectionSource = {
    rejectedApprovals: [],
    rejectedDeltas: [],
  };

  const openLoopSource: OpenLoopSource = {
    failedPacketIds: [],
    blockedPacketIds: [],
    pendingPacketIds: [],
    unresolvedGates: [],
  };

  // Add dependency-based open loops
  for (const dep of deps) {
    if (dep.dep_status !== 'merged' && dep.dep_status !== 'verified') {
      openLoopSource.blockedPacketIds.push(dep.depends_on_packet_id);
    }
  }

  // Add previous attempt failures as context
  const failedAttempts = attempts.filter(a => a.end_reason === 'failed' || a.end_reason === 'crashed');
  if (failedAttempts.length > 0) {
    openLoopSource.customLoops = openLoopSource.customLoops ?? [];
    openLoopSource.customLoops.push({
      summary: `${failedAttempts.length} previous attempt(s) failed — review before retrying`,
      priority: 'medium',
      ownerRole: 'worker',
    });
  }

  const artifactSource: ArtifactRefSource = {
    artifacts: [],
  };

  return {
    ok: true,
    input: {
      projectId: packet.feature_id,
      runId,
      repoRoot,
      lane: lane ?? mapRoleToLane(packet.role),
      sourcePacketId: packetId,
      summary,
      instructions,
      decisionSource,
      rejectionSource,
      openLoopSource,
      artifactSource,
    },
    packetTitle: packet.title,
  };
}

// ── Instruction mapping ──────────────────────────────────────────────

function buildInstructionLayer(
  packet: ExecutionPacketRow,
  feature: ExecutionFeatureRow,
  allowedFiles: string[],
  forbiddenFiles: string[],
  forbiddenRationale: Record<string, string>,
  referenceFiles: string[],
  criteria: string[],
): HandoffInstructionLayer {
  const authoritative: string[] = [];
  const constraints: string[] = [];
  const prohibitions: string[] = [];

  // Goal is the primary authoritative instruction
  authoritative.push(packet.goal);

  // Acceptance criteria are authoritative
  for (const c of criteria) {
    authoritative.push(`Acceptance: ${c}`);
  }

  // Context is authoritative guidance
  if (packet.context) {
    authoritative.push(`Context: ${packet.context}`);
  }

  // Feature context
  authoritative.push(`Feature: ${feature.title} (${feature.feature_id})`);
  authoritative.push(`Layer: ${packet.layer} | Role: ${packet.role}`);

  // File scope is a constraint
  if (allowedFiles.length > 0) {
    constraints.push(`Allowed files: ${allowedFiles.join(', ')}`);
  }
  if (referenceFiles.length > 0) {
    constraints.push(`Reference files (read-only patterns): ${referenceFiles.join(', ')}`);
  }

  // Module family constraint
  if (packet.module_family) {
    constraints.push(`Module family: ${packet.module_family}`);
  }

  // Access rules
  constraints.push(`Protected file access: ${packet.protected_file_access}`);
  constraints.push(`Seam file access: ${packet.seam_file_access}`);

  // Contract delta policy
  constraints.push(`Contract delta policy: ${packet.contract_delta_policy}`);

  // Knowledge writeback
  if (packet.knowledge_writeback_required) {
    constraints.push('Knowledge writeback required: produce structured writeback + prose fragment');
  }

  // Forbidden files become prohibitions
  for (const f of forbiddenFiles) {
    const rationale = forbiddenRationale[f];
    prohibitions.push(rationale ? `${f} — ${rationale}` : f);
  }

  return { authoritative, constraints, prohibitions };
}

// ── Summary ──────────────────────────────────────────────────────────

function buildSummary(
  packet: ExecutionPacketRow,
  feature: ExecutionFeatureRow,
  attempts: ExecutionAttemptRow[],
): string {
  const parts = [
    `Packet ${packet.packet_id}: ${packet.title}`,
    `Feature: ${feature.title}`,
    `Goal: ${packet.goal}`,
  ];

  if (attempts.length > 0) {
    const lastAttempt = attempts[attempts.length - 1]!;
    parts.push(`Attempt ${lastAttempt.attempt_number + 1} (${attempts.length} prior)`);
  }

  return parts.join('\n');
}

// ── Role → Lane mapping ─────────────────────────────────────────────

function mapRoleToLane(role: string): HandoffLane {
  switch (role) {
    case 'reviewer': return 'reviewer';
    case 'approver': return 'approver';
    default: return 'worker';
  }
}

// ── Safe parsers ─────────────────────────────────────────────────────

function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json) as string[]; } catch { return []; }
}

function safeParseRecord(json: string | null): Record<string, string> {
  if (!json) return {};
  try { return JSON.parse(json) as Record<string, string>; } catch { return {}; }
}
