/**
 * Run Model — read-only aggregation layer for run/packet/session/gate state.
 * No new DB tables; pure reads from existing schema.
 */

import { openDb } from '../db/connection.js';
import { nowISO } from '../lib/ids.js';
import type Database from 'better-sqlite3';

// ── Interfaces ──────────────────────────────────────────────────────

export interface RunOverview {
  runId: string;
  featureId: string;
  featureTitle: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  currentWave: number;
  totalWaves: number;
  pauseReason: string | null;
  pauseGateType: string | null;
  totalPackets: number;
  packetsByStatus: Record<string, number>;
  mergedCount: number;
  failedCount: number;
  blockedCount: number;
  inProgressCount: number;
  workClass: string | null;
  predictedFit: string | null;
  predictedGradeRange: [string, string] | null;
}

export interface PacketNode {
  packetId: string;
  title: string;
  layer: string;
  role: string;
  status: string;
  wave: number;
  goal: string;
  owner: string | null;
  attemptNumber: number;
  dependencies: Array<{ packetId: string; type: 'hard' | 'soft'; status: string }>;
  dependents: Array<{ packetId: string; type: 'hard' | 'soft' }>;
}

export interface WorkerSession {
  workerId: string;
  packetId: string;
  wave: number;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  worktreePath: string | null;
  branchName: string | null;
  attemptNumber: number;
  error: string | null;
  modelName: string | null;
  role: string | null;
  endReason: string | null;
}

export interface GateStatus {
  type: string;
  scopeType: string;
  scopeId: string;
  resolved: boolean;
  decision: string | null;
  actor: string | null;
  resolvedAt: string | null;
}

export interface RunModel {
  overview: RunOverview;
  packets: PacketNode[];
  workers: WorkerSession[];
  gates: GateStatus[];
  queriedAt: string;
}

// ── Internal helpers ────────────────────────────────────────────────

function computeElapsedMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return end - start;
}

interface RunRow {
  run_id: string;
  feature_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  current_wave: number;
  total_waves: number;
  pause_reason: string | null;
  pause_gate_type: string | null;
  config_json: string;
}

interface FeatureRow {
  title: string;
}

interface PacketRow {
  packet_id: string;
  title: string;
  layer: string;
  role: string;
  status: string;
  goal: string;
}

interface PacketStatusRow {
  status: string;
  cnt: number;
}

interface DepRow {
  packet_id: string;
  depends_on_packet_id: string;
  dependency_type: string;
}

interface ClaimRow {
  packet_id: string;
  claimed_by: string;
}

interface AttemptRow {
  packet_id: string;
  attempt_number: number;
}

interface WorkerRow {
  worker_id: string;
  packet_id: string;
  wave: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  attempt_number: number;
  error: string | null;
}

interface PacketAttemptRow {
  packet_id: string;
  attempt_number: number;
  model_name: string | null;
  role: string | null;
  end_reason: string | null;
}

interface BlueprintRow {
  work_class: string;
  assessment_json: string;
}

interface WaveRow {
  wave: number;
  packet_id: string;
}

interface ApprovalRow {
  approval_type: string;
  scope_type: string;
  scope_id: string;
  decision: string;
  actor: string;
  created_at: string;
}

// ── Query functions ─────────────────────────────────────────────────

/**
 * Query the full run model for a given run (or the most recent run).
 * Returns null if no runs exist (or the specified runId is not found).
 */
export function queryRunModel(dbPath: string, runId?: string): RunModel | null {
  const db = openDb(dbPath);
  try {
    return queryRunModelWithDb(db, runId);
  } finally {
    db.close();
  }
}

/** Internal: uses an already-open db handle (useful for testing). */
export function queryRunModelWithDb(db: Database.Database, runId?: string): RunModel | null {
  // Check if auto_runs table exists (DB may not be migrated)
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='auto_runs'"
  ).get();
  if (!tableCheck) return null;

  // Find the run
  let run: RunRow | undefined;
  if (runId) {
    run = db.prepare('SELECT * FROM auto_runs WHERE run_id = ?').get(runId) as RunRow | undefined;
  } else {
    run = db.prepare('SELECT * FROM auto_runs ORDER BY started_at DESC LIMIT 1').get() as RunRow | undefined;
  }
  if (!run) return null;

  // Feature title
  const feature = db.prepare('SELECT title FROM features WHERE feature_id = ?').get(run.feature_id) as FeatureRow | undefined;
  const featureTitle = feature?.title ?? '';

  // Packets for this feature
  const packets = db.prepare('SELECT packet_id, title, layer, role, status, goal FROM packets WHERE feature_id = ?')
    .all(run.feature_id) as PacketRow[];

  // Packet status counts
  const statusRows = db.prepare(
    'SELECT status, count(*) as cnt FROM packets WHERE feature_id = ? GROUP BY status'
  ).all(run.feature_id) as PacketStatusRow[];

  const packetsByStatus: Record<string, number> = {};
  for (const row of statusRows) {
    packetsByStatus[row.status] = row.cnt;
  }

  // Blueprint/plan info — find via most recent frozen blueprint
  let workClass: string | null = null;
  let predictedFit: string | null = null;
  let predictedGradeRange: [string, string] | null = null;

  const blueprint = db.prepare(`
    SELECT rb.work_class, rp.assessment_json
    FROM run_blueprints rb
    JOIN run_plans rp ON rp.id = rb.plan_id
    ORDER BY rb.created_at DESC
    LIMIT 1
  `).get() as BlueprintRow | undefined;

  if (blueprint) {
    workClass = blueprint.work_class;
    try {
      const assessment = JSON.parse(blueprint.assessment_json) as {
        predicted_fit?: string;
        predicted_grade_range?: [string, string];
      };
      predictedFit = assessment.predicted_fit ?? null;
      predictedGradeRange = assessment.predicted_grade_range ?? null;
    } catch {
      // assessment_json may not parse or not have expected shape
    }
  }

  const overview: RunOverview = {
    runId: run.run_id,
    featureId: run.feature_id,
    featureTitle,
    status: run.status,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    currentWave: run.current_wave,
    totalWaves: run.total_waves,
    pauseReason: run.pause_reason,
    pauseGateType: run.pause_gate_type,
    totalPackets: packets.length,
    packetsByStatus,
    mergedCount: packetsByStatus['merged'] ?? 0,
    failedCount: packetsByStatus['failed'] ?? 0,
    blockedCount: packetsByStatus['blocked'] ?? 0,
    inProgressCount: packetsByStatus['in_progress'] ?? 0,
    workClass,
    predictedFit,
    predictedGradeRange,
  };

  const packetGraph = queryPacketGraphWithDb(db, run.feature_id);
  const workers = queryWorkerSessionsWithDb(db, run.run_id);
  const gates = queryGatesWithDb(db, run.feature_id);

  return {
    overview,
    packets: packetGraph,
    workers,
    gates,
    queriedAt: nowISO(),
  };
}

/**
 * Query the packet dependency graph for a feature.
 */
export function queryPacketGraph(dbPath: string, featureId: string): PacketNode[] {
  const db = openDb(dbPath);
  try {
    return queryPacketGraphWithDb(db, featureId);
  } finally {
    db.close();
  }
}

export function queryPacketGraphWithDb(db: Database.Database, featureId: string): PacketNode[] {
  const packets = db.prepare(
    'SELECT packet_id, title, layer, role, status, goal FROM packets WHERE feature_id = ?'
  ).all(featureId) as PacketRow[];

  if (packets.length === 0) return [];

  const packetIds = packets.map(p => p.packet_id);
  const placeholders = packetIds.map(() => '?').join(',');

  // All dependencies where either side is in our packet set
  const deps = db.prepare(
    `SELECT packet_id, depends_on_packet_id, dependency_type
     FROM packet_dependencies
     WHERE packet_id IN (${placeholders}) OR depends_on_packet_id IN (${placeholders})`
  ).all(...packetIds, ...packetIds) as DepRow[];

  // Active claims
  const claims = db.prepare(
    `SELECT packet_id, claimed_by FROM claims WHERE packet_id IN (${placeholders}) AND is_active = 1`
  ).all(...packetIds) as ClaimRow[];
  const claimMap = new Map(claims.map(c => [c.packet_id, c.claimed_by]));

  // Latest attempt per packet
  const attempts = db.prepare(
    `SELECT packet_id, MAX(attempt_number) as attempt_number
     FROM packet_attempts
     WHERE packet_id IN (${placeholders})
     GROUP BY packet_id`
  ).all(...packetIds) as AttemptRow[];
  const attemptMap = new Map(attempts.map(a => [a.packet_id, a.attempt_number]));

  // Wave assignments from auto_run_workers
  const waves = db.prepare(
    `SELECT wave, packet_id FROM auto_run_workers WHERE packet_id IN (${placeholders})`
  ).all(...packetIds) as WaveRow[];
  const waveMap = new Map(waves.map(w => [w.packet_id, w.wave]));

  // Build packet status lookup for dependency resolution
  const statusMap = new Map(packets.map(p => [p.packet_id, p.status]));

  // Build dependency and dependent edges
  const depsOf = new Map<string, Array<{ packetId: string; type: 'hard' | 'soft'; status: string }>>();
  const dependentsOf = new Map<string, Array<{ packetId: string; type: 'hard' | 'soft' }>>();

  for (const d of deps) {
    const depType = d.dependency_type as 'hard' | 'soft';

    // d.packet_id depends on d.depends_on_packet_id
    if (!depsOf.has(d.packet_id)) depsOf.set(d.packet_id, []);
    depsOf.get(d.packet_id)!.push({
      packetId: d.depends_on_packet_id,
      type: depType,
      status: statusMap.get(d.depends_on_packet_id) ?? 'unknown',
    });

    if (!dependentsOf.has(d.depends_on_packet_id)) dependentsOf.set(d.depends_on_packet_id, []);
    dependentsOf.get(d.depends_on_packet_id)!.push({
      packetId: d.packet_id,
      type: depType,
    });
  }

  return packets.map(p => ({
    packetId: p.packet_id,
    title: p.title,
    layer: p.layer,
    role: p.role,
    status: p.status,
    wave: waveMap.get(p.packet_id) ?? 0,
    goal: p.goal,
    owner: claimMap.get(p.packet_id) ?? null,
    attemptNumber: attemptMap.get(p.packet_id) ?? 0,
    dependencies: depsOf.get(p.packet_id) ?? [],
    dependents: dependentsOf.get(p.packet_id) ?? [],
  }));
}

/**
 * Query worker sessions for a run, with elapsed time computation.
 */
export function queryWorkerSessions(dbPath: string, runId: string): WorkerSession[] {
  const db = openDb(dbPath);
  try {
    return queryWorkerSessionsWithDb(db, runId);
  } finally {
    db.close();
  }
}

export function queryWorkerSessionsWithDb(db: Database.Database, runId: string): WorkerSession[] {
  const workers = db.prepare(
    `SELECT worker_id, packet_id, wave, status, started_at, completed_at,
            worktree_path, branch_name, attempt_number, error
     FROM auto_run_workers
     WHERE run_id = ?
     ORDER BY wave ASC, started_at ASC`
  ).all(runId) as WorkerRow[];

  if (workers.length === 0) return [];

  // Look up packet_attempts for model_name, role, end_reason
  // Match on (packet_id, attempt_number)
  const packetIds = workers.map(w => w.packet_id);
  const placeholders = packetIds.map(() => '?').join(',');

  const attempts = db.prepare(
    `SELECT packet_id, attempt_number, model_name, role, end_reason
     FROM packet_attempts
     WHERE packet_id IN (${placeholders})`
  ).all(...packetIds) as PacketAttemptRow[];

  const attemptMap = new Map<string, PacketAttemptRow>();
  for (const a of attempts) {
    attemptMap.set(`${a.packet_id}:${a.attempt_number}`, a);
  }

  return workers.map(w => {
    const attempt = attemptMap.get(`${w.packet_id}:${w.attempt_number}`);
    return {
      workerId: w.worker_id,
      packetId: w.packet_id,
      wave: w.wave,
      status: w.status,
      startedAt: w.started_at,
      completedAt: w.completed_at,
      elapsedMs: computeElapsedMs(w.started_at, w.completed_at),
      worktreePath: w.worktree_path,
      branchName: w.branch_name,
      attemptNumber: w.attempt_number,
      error: w.error,
      modelName: attempt?.model_name ?? null,
      role: attempt?.role ?? null,
      endReason: attempt?.end_reason ?? null,
    };
  });
}

/**
 * Query gates (approvals) for a feature — both pending and resolved.
 * Gates are derived from the approval types relevant to the feature and its packets.
 */
export function queryGates(dbPath: string, featureId: string): GateStatus[] {
  const db = openDb(dbPath);
  try {
    return queryGatesWithDb(db, featureId);
  } finally {
    db.close();
  }
}

export function queryGatesWithDb(db: Database.Database, featureId: string): GateStatus[] {
  const gates: GateStatus[] = [];

  // Feature-level approval
  const featureApproval = db.prepare(
    `SELECT approval_type, scope_type, scope_id, decision, actor, created_at
     FROM approvals
     WHERE scope_type = 'feature' AND scope_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(featureId) as ApprovalRow | undefined;

  gates.push({
    type: 'feature_approval',
    scopeType: 'feature',
    scopeId: featureId,
    resolved: !!featureApproval,
    decision: featureApproval?.decision ?? null,
    actor: featureApproval?.actor ?? null,
    resolvedAt: featureApproval?.created_at ?? null,
  });

  // Packet graph approval
  const graphApproval = db.prepare(
    `SELECT approval_type, scope_type, scope_id, decision, actor, created_at
     FROM approvals
     WHERE scope_type = 'packet_graph' AND scope_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(featureId) as ApprovalRow | undefined;

  gates.push({
    type: 'packet_graph_approval',
    scopeType: 'packet_graph',
    scopeId: featureId,
    resolved: !!graphApproval,
    decision: graphApproval?.decision ?? null,
    actor: graphApproval?.actor ?? null,
    resolvedAt: graphApproval?.created_at ?? null,
  });

  // Per-packet merge approvals
  const packetIds = (db.prepare(
    'SELECT packet_id FROM packets WHERE feature_id = ?'
  ).all(featureId) as Array<{ packet_id: string }>).map(r => r.packet_id);

  if (packetIds.length > 0) {
    const placeholders = packetIds.map(() => '?').join(',');
    const mergeApprovals = db.prepare(
      `SELECT approval_type, scope_type, scope_id, decision, actor, created_at
       FROM approvals
       WHERE scope_type = 'packet' AND scope_id IN (${placeholders})
         AND approval_type = 'merge_approval'`
    ).all(...packetIds) as ApprovalRow[];

    const approvalMap = new Map(mergeApprovals.map(a => [a.scope_id, a]));

    for (const pid of packetIds) {
      const approval = approvalMap.get(pid);
      gates.push({
        type: 'merge_approval',
        scopeType: 'packet',
        scopeId: pid,
        resolved: !!approval,
        decision: approval?.decision ?? null,
        actor: approval?.actor ?? null,
        resolvedAt: approval?.created_at ?? null,
      });
    }
  }

  // Integration run approval
  const integrationApproval = db.prepare(
    `SELECT approval_type, scope_type, scope_id, decision, actor, created_at
     FROM approvals
     WHERE scope_type = 'integration_run' AND scope_id = ?
     ORDER BY created_at DESC LIMIT 1`
  ).get(featureId) as ApprovalRow | undefined;

  gates.push({
    type: 'integration_approval',
    scopeType: 'integration_run',
    scopeId: featureId,
    resolved: !!integrationApproval,
    decision: integrationApproval?.decision ?? null,
    actor: integrationApproval?.actor ?? null,
    resolvedAt: integrationApproval?.created_at ?? null,
  });

  return gates;
}
