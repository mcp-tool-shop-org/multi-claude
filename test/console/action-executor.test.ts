import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { executeActionWithDb } from '../../src/console/action-executor.js';
import { ensureAuditTableWithDb, queryAuditTrailWithDb } from '../../src/console/audit-trail.js';

// ── Helpers ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

function tempDbPath(): string {
  const dir = join(tmpdir(), 'mc-executor-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.db');
}

function loadSchema(db: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('PRAGMA'));

  db.transaction(() => {
    for (const stmt of statements) {
      db.exec(stmt + ';');
    }
  })();
}

const HOOK_DECISIONS_DDL = `
CREATE TABLE IF NOT EXISTS hook_decisions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  event_entity_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  rule_matched TEXT,
  action TEXT,
  packets_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  operator_decision TEXT NOT NULL DEFAULT 'pending',
  executed INTEGER NOT NULL DEFAULT 0,
  reason TEXT
)`;

const NOW = '2026-03-19T12:00:00Z';
const FEATURE_ID = 'feat-test-001';
const RUN_ID = 'run-test-001';
const PACKET_ID_OK = 'test-feature--backend-api';
const PACKET_ID_FAILED = 'test-feature--backend-fail';

function seedTestData(db: Database.Database, opts: { runStatus?: string; pauseGateType?: string | null } = {}): void {
  const runStatus = opts.runStatus ?? 'running';
  const pauseGateType = opts.pauseGateType ?? null;
  const pauseReason = runStatus === 'paused' ? 'gate_hold' : null;

  // Feature
  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target,
      acceptance_criteria, created_by, created_at, updated_at)
    VALUES (?, 'test-repo', 'Test Feature', 'Test objective', 'in_progress', 'main',
      'Must pass tests', 'operator', ?, ?)
  `).run(FEATURE_ID, NOW, NOW);

  // Packets — one ok, one failed
  const packetInsert = db.prepare(`
    INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, verification_profile_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'backend', 'desc', 'builder', 'pb-1', ?, 'Build API', '["src/**"]', 'vp-1', 'operator', ?, ?)
  `);
  packetInsert.run(PACKET_ID_OK, FEATURE_ID, 'Backend API', 'merged', NOW, NOW);
  packetInsert.run(PACKET_ID_FAILED, FEATURE_ID, 'Backend Fail', 'failed', NOW, NOW);

  // Packet attempt for the failed packet (attempt 1 — under MAX_RETRIES=3)
  db.prepare(`
    INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, started_at, role)
    VALUES ('att-fail-1', ?, 1, 'worker-1', ?, 'builder')
  `).run(PACKET_ID_FAILED, NOW);

  // Auto run
  db.prepare(`
    INSERT INTO auto_runs (run_id, feature_id, status, started_at, current_wave, total_waves,
      pause_reason, pause_gate_type, config_json)
    VALUES (?, ?, ?, ?, 1, 2, ?, ?, '{}')
  `).run(RUN_ID, FEATURE_ID, runStatus, NOW, pauseReason, pauseGateType);

  // Workers — one running, one completed
  db.prepare(`
    INSERT INTO auto_run_workers (worker_id, run_id, packet_id, wave, status, started_at, attempt_number)
    VALUES ('wrk-1', ?, ?, 1, 'completed', ?, 1)
  `).run(RUN_ID, PACKET_ID_OK, NOW);

  db.prepare(`
    INSERT INTO auto_run_workers (worker_id, run_id, packet_id, wave, status, started_at, attempt_number)
    VALUES ('wrk-2', ?, ?, 1, 'running', ?, 1)
  `).run(RUN_ID, PACKET_ID_FAILED, NOW);

  // Hook decisions table
  db.exec(HOOK_DECISIONS_DDL);
}

function seedHookDecision(db: Database.Database, opts: { id?: string; decision?: string; action?: string | null } = {}): void {
  const id = opts.id ?? 'hook-dec-001';
  const decision = opts.decision ?? 'pending';
  const action = opts.action ?? 'pause_run';

  db.prepare(`
    INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id,
      conditions_json, rule_matched, action, packets_json, mode, operator_decision, executed, reason)
    VALUES (?, ?, 'packet.failed', 'pkt-1', ?, '{}', 'rule-1', ?, '[]', 'advisory', ?, 0, 'test')
  `).run(id, NOW, FEATURE_ID, action, decision);
}

function seedGate(db: Database.Database, opts: { resolved?: boolean; scopeType?: string; scopeId?: string; gateType?: string } = {}): void {
  const resolved = opts.resolved ?? false;
  if (resolved) {
    const scopeType = opts.scopeType ?? 'feature';
    const scopeId = opts.scopeId ?? FEATURE_ID;
    const gateType = opts.gateType ?? 'feature_approval';
    db.prepare(`
      INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor, created_at)
      VALUES (?, ?, ?, ?, 'approved', 'prior-actor', ?)
    `).run('apv-existing', scopeType, scopeId, gateType, NOW);
  }
  // If not resolved, the gate is implicitly pending (no approval row)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('action-executor', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tempDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    loadSchema(db);
    ensureAuditTableWithDb(db);
  });

  afterEach(() => {
    db.close();
    try { if (existsSync(dbPath)) unlinkSync(dbPath); } catch { /* ignore */ }
  });

  // ── stop_run ──────────────────────────────────────────────────────

  // 1. stop_run succeeds for running run
  it('stop_run succeeds for a running run', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'stop_run', RUN_ID, 'operator', 'shutting down');

    expect(result.success).toBe(true);
    expect(result.beforeState).toBe('running');
    expect(result.afterState).toBe('stopped');
    expect(result.error).toBeNull();
    expect(result.auditId).toMatch(/^aud-/);

    // Verify DB state
    const run = db.prepare('SELECT status, completed_at FROM auto_runs WHERE run_id = ?').get(RUN_ID) as any;
    expect(run.status).toBe('stopped');
    expect(run.completed_at).toBeTruthy();
  });

  // 2. stop_run fails for completed run
  it('stop_run fails for a completed run', () => {
    seedTestData(db, { runStatus: 'complete' });

    const result = executeActionWithDb(db, dbPath, 'stop_run', RUN_ID, 'operator', 'too late');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.auditId).toBeNull();
  });

  // 3. stop_run records audit entry
  it('stop_run records an audit entry', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'stop_run', RUN_ID, 'operator', 'audit check');
    expect(result.auditId).toBeTruthy();

    const audits = queryAuditTrailWithDb(db, { action: 'stop_run' });
    expect(audits).toHaveLength(1);
    expect(audits[0].id).toBe(result.auditId);
    expect(audits[0].action).toBe('stop_run');
    expect(audits[0].targetId).toBe(RUN_ID);
    expect(audits[0].beforeState).toBe('running');
    expect(audits[0].afterState).toBe('stopped');
    expect(audits[0].success).toBe(true);
  });

  // 3b. stop_run also marks incomplete workers as failed
  it('stop_run marks incomplete workers as failed', () => {
    seedTestData(db, { runStatus: 'running' });

    executeActionWithDb(db, dbPath, 'stop_run', RUN_ID, 'operator', 'cleanup');

    const workers = db.prepare(
      'SELECT status, completed_at FROM auto_run_workers WHERE run_id = ? ORDER BY worker_id',
    ).all(RUN_ID) as any[];

    // wrk-1 was already completed — should stay completed
    expect(workers.find((w: any) => w.status === 'completed')).toBeTruthy();
    // wrk-2 was running — should be failed now
    const failedWorker = workers.find((w: any) => w.status === 'failed');
    expect(failedWorker).toBeTruthy();
    expect(failedWorker.completed_at).toBeTruthy();
  });

  // ── retry_packet ──────────────────────────────────────────────────

  // 4. retry_packet succeeds for failed packet below retry limit
  it('retry_packet succeeds for a failed packet below retry limit', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'retry_packet', PACKET_ID_FAILED, 'operator', 'retry it');

    expect(result.success).toBe(true);
    expect(result.beforeState).toBe('failed');
    expect(result.afterState).toBe('ready');
    expect(result.auditId).toMatch(/^aud-/);
  });

  // 5. retry_packet fails when packet not failed
  it('retry_packet fails when packet is not failed', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'retry_packet', PACKET_ID_OK, 'operator', 'retry merged');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.auditId).toBeNull();
  });

  // 6. retry_packet resets packet status to 'ready'
  it('retry_packet resets packet status to ready', () => {
    seedTestData(db, { runStatus: 'running' });

    executeActionWithDb(db, dbPath, 'retry_packet', PACKET_ID_FAILED, 'operator', 'reset');

    const pkt = db.prepare('SELECT status FROM packets WHERE packet_id = ?').get(PACKET_ID_FAILED) as any;
    expect(pkt.status).toBe('ready');
  });

  // ── resume_run ────────────────────────────────────────────────────

  // 7. resume_run succeeds when paused with resolved gate
  it('resume_run succeeds when paused with resolved gate', () => {
    seedTestData(db, { runStatus: 'paused', pauseGateType: 'feature_approval' });
    // Resolve the feature_approval gate
    seedGate(db, { resolved: true, scopeType: 'feature', scopeId: FEATURE_ID, gateType: 'feature_approval' });

    const result = executeActionWithDb(db, dbPath, 'resume_run', RUN_ID, 'operator', 'gate resolved');

    expect(result.success).toBe(true);
    expect(result.beforeState).toBe('paused');
    expect(result.afterState).toBe('running');

    const run = db.prepare('SELECT status, pause_reason, pause_gate_type FROM auto_runs WHERE run_id = ?').get(RUN_ID) as any;
    expect(run.status).toBe('running');
    expect(run.pause_reason).toBeNull();
    expect(run.pause_gate_type).toBeNull();
  });

  // 8. resume_run fails when not paused
  it('resume_run fails when run is not paused', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'resume_run', RUN_ID, 'operator', 'not paused');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.auditId).toBeNull();
  });

  // ── approve_gate ──────────────────────────────────────────────────

  // 9. approve_gate succeeds for pending gate
  it('approve_gate succeeds for a pending gate', () => {
    seedTestData(db, { runStatus: 'running' });
    // feature_approval gate is pending by default (no approval row)

    const gateTargetId = `feature:${FEATURE_ID}:feature_approval`;
    const result = executeActionWithDb(db, dbPath, 'approve_gate', gateTargetId, 'operator', 'looks good');

    expect(result.success).toBe(true);
    expect(result.beforeState).toBe('pending');
    expect(result.afterState).toBe('approved');
    expect(result.auditId).toMatch(/^aud-/);

    // Verify approval row was inserted
    const approval = db.prepare(
      "SELECT * FROM approvals WHERE scope_type = 'feature' AND scope_id = ? AND approval_type = 'feature_approval'",
    ).get(FEATURE_ID) as any;
    expect(approval).toBeTruthy();
    expect(approval.decision).toBe('approved');
    expect(approval.actor).toBe('operator');
  });

  // 10. approve_gate fails for already-resolved gate
  it('approve_gate fails for already-resolved gate', () => {
    seedTestData(db, { runStatus: 'running' });
    seedGate(db, { resolved: true, scopeType: 'feature', scopeId: FEATURE_ID, gateType: 'feature_approval' });

    const gateTargetId = `feature:${FEATURE_ID}:feature_approval`;
    const result = executeActionWithDb(db, dbPath, 'approve_gate', gateTargetId, 'operator', 'double approve');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.auditId).toBeNull();
  });

  // ── resolve_hook ──────────────────────────────────────────────────

  // 11. resolve_hook succeeds for pending decision
  it('resolve_hook succeeds for a pending decision', () => {
    seedTestData(db, { runStatus: 'running' });
    seedHookDecision(db, { id: 'hook-pending-1', decision: 'pending', action: 'pause_run' });

    const result = executeActionWithDb(db, dbPath, 'resolve_hook', 'hook-pending-1', 'operator', 'confirm it');

    expect(result.success).toBe(true);
    expect(result.beforeState).toBe('pending');
    expect(result.afterState).toBe('confirmed');
    expect(result.auditId).toMatch(/^aud-/);

    // Verify the hook decision was updated
    const decision = db.prepare('SELECT operator_decision, executed FROM hook_decisions WHERE id = ?').get('hook-pending-1') as any;
    expect(decision.operator_decision).toBe('confirmed');
    expect(decision.executed).toBe(1);
  });

  // 12. resolve_hook fails for already-resolved decision
  it('resolve_hook fails for an already-resolved decision', () => {
    seedTestData(db, { runStatus: 'running' });
    seedHookDecision(db, { id: 'hook-resolved-1', decision: 'confirmed', action: 'pause_run' });

    const result = executeActionWithDb(db, dbPath, 'resolve_hook', 'hook-resolved-1', 'operator', 'too late');

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.auditId).toBeNull();
  });

  // ── Cross-cutting ─────────────────────────────────────────────────

  // 13. All successful actions create audit entries
  it('all successful actions create audit entries', () => {
    seedTestData(db, { runStatus: 'running' });
    seedHookDecision(db, { id: 'hook-cross-1', decision: 'pending', action: 'pause_run' });

    const results = [
      executeActionWithDb(db, dbPath, 'retry_packet', PACKET_ID_FAILED, 'op', 'r1'),
      executeActionWithDb(db, dbPath, 'approve_gate', `feature:${FEATURE_ID}:feature_approval`, 'op', 'r2'),
      executeActionWithDb(db, dbPath, 'resolve_hook', 'hook-cross-1', 'op', 'r3'),
    ];

    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.auditId).toBeTruthy();
    }

    const audits = queryAuditTrailWithDb(db);
    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.every(a => a.success)).toBe(true);
  });

  // 14. Failed actions return error without audit entry
  it('failed actions do not create audit entries', () => {
    seedTestData(db, { runStatus: 'complete' });

    const result = executeActionWithDb(db, dbPath, 'stop_run', RUN_ID, 'operator', 'fail test');

    expect(result.success).toBe(false);
    expect(result.auditId).toBeNull();

    const audits = queryAuditTrailWithDb(db, { action: 'stop_run' });
    expect(audits).toHaveLength(0);
  });

  // 15. Unknown action returns error
  it('unknown action returns error', () => {
    seedTestData(db, { runStatus: 'running' });

    const result = executeActionWithDb(db, dbPath, 'explode_everything', 'target-x', 'operator', 'chaos');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown action');
    expect(result.auditId).toBeNull();
  });
});
