import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  queryRunModelWithDb,
  queryPacketGraphWithDb,
  queryWorkerSessionsWithDb,
  queryGatesWithDb,
} from '../../src/console/run-model.js';
import type { RunModel, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('PRAGMA'));

  for (const stmt of statements) {
    db.exec(stmt + ';');
  }
  return db;
}

// ── Seed helpers ──────────────────────────────────────────────────

function seedFeature(db: Database.Database, id: string, title = 'Test Feature'): void {
  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES (?, 'org/repo', ?, 'Build it', 'in_progress', 'main', '["works"]', 'human')
  `).run(id, title);
}

function seedPacket(
  db: Database.Database,
  packetId: string,
  featureId: string,
  opts: { title?: string; layer?: string; role?: string; status?: string; goal?: string } = {},
): void {
  const { title = 'Packet', layer = 'backend', role = 'builder', status = 'ready', goal = 'Do thing' } = opts;
  db.prepare(`
    INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, verification_profile_id, created_by)
    VALUES (?, ?, ?, ?, 'desc', ?, 'pb-1', ?, ?, '["src/**"]', 'vp-1', 'human')
  `).run(packetId, featureId, title, layer, role, status, goal);
}

function seedRun(
  db: Database.Database,
  runId: string,
  featureId: string,
  opts: {
    status?: string; startedAt?: string; completedAt?: string | null;
    currentWave?: number; totalWaves?: number;
    pauseReason?: string | null; pauseGateType?: string | null;
  } = {},
): void {
  const {
    status = 'running', startedAt = '2026-03-19T10:00:00Z', completedAt = null,
    currentWave = 1, totalWaves = 2,
    pauseReason = null, pauseGateType = null,
  } = opts;
  db.prepare(`
    INSERT INTO auto_runs (run_id, feature_id, status, started_at, completed_at,
      current_wave, total_waves, pause_reason, pause_gate_type, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
  `).run(runId, featureId, status, startedAt, completedAt, currentWave, totalWaves, pauseReason, pauseGateType);
}

function seedWorker(
  db: Database.Database,
  workerId: string,
  runId: string,
  packetId: string,
  opts: {
    wave?: number; status?: string; startedAt?: string | null; completedAt?: string | null;
    attemptNumber?: number; error?: string | null; worktreePath?: string | null; branchName?: string | null;
  } = {},
): void {
  const {
    wave = 1, status = 'running', startedAt = '2026-03-19T10:01:00Z', completedAt = null,
    attemptNumber = 1, error = null, worktreePath = null, branchName = null,
  } = opts;
  db.prepare(`
    INSERT INTO auto_run_workers (worker_id, run_id, packet_id, wave, status,
      started_at, completed_at, attempt_number, error, worktree_path, branch_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workerId, runId, packetId, wave, status, startedAt, completedAt, attemptNumber, error, worktreePath, branchName);
}

function seedAttempt(
  db: Database.Database,
  attemptId: string,
  packetId: string,
  opts: {
    attemptNumber?: number; modelName?: string | null; role?: string; endReason?: string | null;
    startedAt?: string; endedAt?: string | null;
  } = {},
): void {
  const {
    attemptNumber = 1, modelName = null, role = 'builder', endReason = null,
    startedAt = '2026-03-19T10:01:00Z', endedAt = null,
  } = opts;
  db.prepare(`
    INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by,
      started_at, ended_at, end_reason, model_name, role)
    VALUES (?, ?, ?, 'system', ?, ?, ?, ?, ?)
  `).run(attemptId, packetId, attemptNumber, startedAt, endedAt, endReason, modelName, role);
}

function seedClaim(db: Database.Database, claimId: string, packetId: string, attemptId: string, claimedBy: string): void {
  db.prepare(`
    INSERT INTO claims (claim_id, packet_id, attempt_id, claimed_by, lease_expires_at, is_active)
    VALUES (?, ?, ?, ?, '2099-01-01T00:00:00Z', 1)
  `).run(claimId, packetId, attemptId, claimedBy);
}

function seedApproval(
  db: Database.Database,
  approvalId: string,
  scopeType: string,
  scopeId: string,
  approvalType: string,
  decision: string,
  actor: string,
): void {
  db.prepare(`
    INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(approvalId, scopeType, scopeId, approvalType, decision, actor);
}

function seedDep(db: Database.Database, packetId: string, dependsOn: string, depType: string = 'hard'): void {
  db.prepare(`
    INSERT INTO packet_dependencies (packet_id, depends_on_packet_id, dependency_type)
    VALUES (?, ?, ?)
  `).run(packetId, dependsOn, depType);
}

function seedVerificationProfile(db: Database.Database): void {
  db.prepare(`
    INSERT OR IGNORE INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps)
    VALUES ('vp-1', 'org/repo', 'backend', 'default', 'builder', '[]')
  `).run();
}

// ── Tests ───────────────────────────────────────────────────────────

describe('run-model', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedVerificationProfile(db);
  });

  afterEach(() => {
    db.close();
  });

  // 1. queryRunModel returns null when no runs exist
  it('returns null when no runs exist', () => {
    const result = queryRunModelWithDb(db);
    expect(result).toBeNull();
  });

  // 2. queryRunModel returns correct overview for a single run
  it('returns correct overview for a single run', () => {
    seedFeature(db, 'f-1', 'My Feature');
    seedPacket(db, 'p-1', 'f-1', { status: 'in_progress' });
    seedPacket(db, 'p-2', 'f-1', { status: 'merged' });
    seedPacket(db, 'p-3', 'f-1', { status: 'failed' });
    seedRun(db, 'r-1', 'f-1', { currentWave: 1, totalWaves: 3, pauseReason: 'gate', pauseGateType: 'merge_approval' });

    const model = queryRunModelWithDb(db, 'r-1')!;
    expect(model).not.toBeNull();
    expect(model.overview.runId).toBe('r-1');
    expect(model.overview.featureId).toBe('f-1');
    expect(model.overview.featureTitle).toBe('My Feature');
    expect(model.overview.status).toBe('running');
    expect(model.overview.currentWave).toBe(1);
    expect(model.overview.totalWaves).toBe(3);
    expect(model.overview.pauseReason).toBe('gate');
    expect(model.overview.pauseGateType).toBe('merge_approval');
    expect(model.overview.totalPackets).toBe(3);
    expect(model.overview.mergedCount).toBe(1);
    expect(model.overview.failedCount).toBe(1);
    expect(model.overview.inProgressCount).toBe(1);
  });

  // 3. Packet graph has correct dependency edges
  it('builds correct dependency edges', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-a', 'f-1', { status: 'merged', title: 'A' });
    seedPacket(db, 'p-b', 'f-1', { status: 'ready', title: 'B' });
    seedPacket(db, 'p-c', 'f-1', { status: 'ready', title: 'C' });
    seedDep(db, 'p-b', 'p-a', 'hard');
    seedDep(db, 'p-c', 'p-a', 'soft');

    const graph = queryPacketGraphWithDb(db, 'f-1');
    expect(graph).toHaveLength(3);

    const nodeA = graph.find(n => n.packetId === 'p-a')!;
    const nodeB = graph.find(n => n.packetId === 'p-b')!;
    const nodeC = graph.find(n => n.packetId === 'p-c')!;

    // A has no dependencies, but has two dependents
    expect(nodeA.dependencies).toHaveLength(0);
    expect(nodeA.dependents).toHaveLength(2);
    expect(nodeA.dependents.map(d => d.packetId).sort()).toEqual(['p-b', 'p-c']);

    // B depends on A (hard)
    expect(nodeB.dependencies).toHaveLength(1);
    expect(nodeB.dependencies[0]).toEqual({ packetId: 'p-a', type: 'hard', status: 'merged' });

    // C depends on A (soft)
    expect(nodeC.dependencies).toHaveLength(1);
    expect(nodeC.dependencies[0]).toEqual({ packetId: 'p-a', type: 'soft', status: 'merged' });
  });

  // 4. Worker sessions compute elapsed time correctly
  it('computes elapsed time for completed workers', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedRun(db, 'r-1', 'f-1');
    seedWorker(db, 'w-1', 'r-1', 'p-1', {
      startedAt: '2026-03-19T10:00:00Z',
      completedAt: '2026-03-19T10:05:00Z',
      status: 'completed',
    });

    const sessions = queryWorkerSessionsWithDb(db, 'r-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.elapsedMs).toBe(5 * 60 * 1000); // 5 minutes
  });

  // 5. Gates show pending when no approval exists
  it('shows pending gates when no approval exists', () => {
    seedFeature(db, 'f-1');

    const gates = queryGatesWithDb(db, 'f-1');
    const featureGate = gates.find(g => g.type === 'feature_approval')!;
    expect(featureGate.resolved).toBe(false);
    expect(featureGate.decision).toBeNull();
    expect(featureGate.actor).toBeNull();
    expect(featureGate.resolvedAt).toBeNull();
  });

  // 6. Gates show resolved when approval exists
  it('shows resolved gates when approval exists', () => {
    seedFeature(db, 'f-1');
    seedApproval(db, 'a-1', 'feature', 'f-1', 'feature_approval', 'approved', 'human');

    const gates = queryGatesWithDb(db, 'f-1');
    const featureGate = gates.find(g => g.type === 'feature_approval')!;
    expect(featureGate.resolved).toBe(true);
    expect(featureGate.decision).toBe('approved');
    expect(featureGate.actor).toBe('human');
    expect(featureGate.resolvedAt).toBeTruthy();
  });

  // 7. packetsByStatus counts are correct
  it('computes packetsByStatus correctly', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'ready' });
    seedPacket(db, 'p-2', 'f-1', { status: 'ready' });
    seedPacket(db, 'p-3', 'f-1', { status: 'in_progress' });
    seedPacket(db, 'p-4', 'f-1', { status: 'merged' });
    seedPacket(db, 'p-5', 'f-1', { status: 'merged' });
    seedPacket(db, 'p-6', 'f-1', { status: 'merged' });
    seedPacket(db, 'p-7', 'f-1', { status: 'blocked' });
    seedRun(db, 'r-1', 'f-1');

    const model = queryRunModelWithDb(db, 'r-1')!;
    expect(model.overview.packetsByStatus).toEqual({
      ready: 2,
      in_progress: 1,
      merged: 3,
      blocked: 1,
    });
    expect(model.overview.totalPackets).toBe(7);
    expect(model.overview.mergedCount).toBe(3);
    expect(model.overview.blockedCount).toBe(1);
    expect(model.overview.inProgressCount).toBe(1);
    expect(model.overview.failedCount).toBe(0);
  });

  // 8. Most recent run is returned when runId is omitted
  it('returns most recent run when runId is omitted', () => {
    seedFeature(db, 'f-1');
    seedRun(db, 'r-old', 'f-1', { status: 'complete', startedAt: '2026-03-18T08:00:00Z', completedAt: '2026-03-18T09:00:00Z' });

    seedFeature(db, 'f-2', 'Newer Feature');
    seedRun(db, 'r-new', 'f-2', { status: 'running', startedAt: '2026-03-19T10:00:00Z' });

    const model = queryRunModelWithDb(db)!;
    expect(model).not.toBeNull();
    expect(model.overview.runId).toBe('r-new');
    expect(model.overview.featureTitle).toBe('Newer Feature');
  });

  // 9. Worker with no startedAt has null elapsedMs
  it('returns null elapsedMs for worker with no startedAt', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedRun(db, 'r-1', 'f-1');
    seedWorker(db, 'w-1', 'r-1', 'p-1', {
      startedAt: null,
      status: 'pending',
    });

    const sessions = queryWorkerSessionsWithDb(db, 'r-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.elapsedMs).toBeNull();
    expect(sessions[0]!.startedAt).toBeNull();
  });

  // 10. Multiple waves are ordered correctly
  it('orders workers by wave then startedAt', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedPacket(db, 'p-2', 'f-1');
    seedPacket(db, 'p-3', 'f-1');
    seedRun(db, 'r-1', 'f-1', { totalWaves: 3 });

    // Insert out of order
    seedWorker(db, 'w-3', 'r-1', 'p-3', { wave: 3, startedAt: '2026-03-19T12:00:00Z', status: 'pending' });
    seedWorker(db, 'w-1', 'r-1', 'p-1', { wave: 1, startedAt: '2026-03-19T10:00:00Z', status: 'completed', completedAt: '2026-03-19T10:05:00Z' });
    seedWorker(db, 'w-2', 'r-1', 'p-2', { wave: 2, startedAt: '2026-03-19T11:00:00Z', status: 'running' });

    const sessions = queryWorkerSessionsWithDb(db, 'r-1');
    expect(sessions).toHaveLength(3);
    expect(sessions[0]!.wave).toBe(1);
    expect(sessions[0]!.workerId).toBe('w-1');
    expect(sessions[1]!.wave).toBe(2);
    expect(sessions[1]!.workerId).toBe('w-2');
    expect(sessions[2]!.wave).toBe(3);
    expect(sessions[2]!.workerId).toBe('w-3');
  });

  // Additional: worker sessions include packet_attempts metadata
  it('includes model_name and endReason from packet_attempts', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedRun(db, 'r-1', 'f-1');
    seedAttempt(db, 'att-1', 'p-1', { attemptNumber: 1, modelName: 'claude-opus-4', role: 'builder', endReason: 'submitted' });
    seedWorker(db, 'w-1', 'r-1', 'p-1', { attemptNumber: 1, status: 'completed' });

    const sessions = queryWorkerSessionsWithDb(db, 'r-1');
    expect(sessions[0]!.modelName).toBe('claude-opus-4');
    expect(sessions[0]!.role).toBe('builder');
    expect(sessions[0]!.endReason).toBe('submitted');
  });

  // Additional: packet graph includes owner from active claim
  it('shows owner from active claim on packet node', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'claimed' });
    seedAttempt(db, 'att-1', 'p-1', { attemptNumber: 1 });
    seedClaim(db, 'c-1', 'p-1', 'att-1', 'worker-alpha');

    const graph = queryPacketGraphWithDb(db, 'f-1');
    expect(graph[0]!.owner).toBe('worker-alpha');
    expect(graph[0]!.attemptNumber).toBe(1);
  });

  // Additional: per-packet merge approval gates
  it('generates merge_approval gates per packet', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedPacket(db, 'p-2', 'f-1');
    seedApproval(db, 'a-1', 'packet', 'p-1', 'merge_approval', 'approved', 'human');

    const gates = queryGatesWithDb(db, 'f-1');
    const mergeGates = gates.filter(g => g.type === 'merge_approval');
    expect(mergeGates).toHaveLength(2);

    const p1Gate = mergeGates.find(g => g.scopeId === 'p-1')!;
    expect(p1Gate.resolved).toBe(true);
    expect(p1Gate.decision).toBe('approved');

    const p2Gate = mergeGates.find(g => g.scopeId === 'p-2')!;
    expect(p2Gate.resolved).toBe(false);
    expect(p2Gate.decision).toBeNull();
  });
});
