/**
 * console.test.ts — Integration tests for the console command's
 * query + render + next-action pipeline.
 *
 * Uses in-memory SQLite with the real schema, then calls the query
 * functions and render functions directly (no CLI shell-out).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryRunModelWithDb } from '../../src/console/run-model.js';
import type { RunModel } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent } from '../../src/console/hook-feed.js';
import type { FitnessViewResult } from '../../src/console/fitness-view.js';
import {
  renderConsole,
  renderRunOverview,
  renderPacketGraph,
  renderWorkerSessions,
  renderHooksAndGates,
  renderFitnessAndEvidence,
} from '../../src/console/render.js';
import { computeNextAction } from '../../src/console/next-action.js';
import type { NextAction } from '../../src/console/next-action.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

// ── DB helpers ──────────────────────────────────────────────────────

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

  // Also create hook_decisions table (used by hook-feed)
  db.exec(`
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
    )
  `);

  return db;
}

// ── Seed helpers ────────────────────────────────────────────────────

function seedVerificationProfile(db: Database.Database): void {
  db.prepare(`
    INSERT OR IGNORE INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps)
    VALUES ('vp-1', 'org/repo', 'backend', 'default', 'builder', '[]')
  `).run();
}

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
    attemptNumber?: number; error?: string | null;
  } = {},
): void {
  const {
    wave = 1, status = 'running', startedAt = '2026-03-19T10:01:00Z', completedAt = null,
    attemptNumber = 1, error = null,
  } = opts;
  db.prepare(`
    INSERT INTO auto_run_workers (worker_id, run_id, packet_id, wave, status,
      started_at, completed_at, attempt_number, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(workerId, runId, packetId, wave, status, startedAt, completedAt, attemptNumber, error);
}

function seedHookDecision(
  db: Database.Database,
  id: string,
  featureId: string,
  opts: {
    event?: string;
    entityId?: string;
    action?: string | null;
    mode?: string;
    operatorDecision?: string;
    executed?: number;
    timestamp?: string;
  } = {},
): void {
  const {
    event = 'packet.failed', entityId = 'p-1',
    action = 'retry_once', mode = 'advisory',
    operatorDecision = 'pending', executed = 0,
    timestamp = '2026-03-19T10:05:00Z',
  } = opts;
  db.prepare(`
    INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id,
      conditions_json, rule_matched, action, packets_json, mode, operator_decision, executed, reason)
    VALUES (?, ?, ?, ?, ?, '{}', 'test-rule', ?, '[]', ?, ?, ?, 'test reason')
  `).run(id, timestamp, event, entityId, featureId, action, mode, operatorDecision, executed);
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

// ── Empty hook/fitness factories (for render tests) ─────────────────

function emptyHookFeed(): HookFeedResult {
  return {
    events: [],
    summary: {
      totalDecisions: 0,
      pendingApprovals: 0,
      autoExecuted: 0,
      confirmedByOperator: 0,
      rejectedByOperator: 0,
      byEvent: {},
      byAction: {},
      byRule: {},
    },
    queriedAt: '2026-03-19T10:10:00Z',
  };
}

function emptyFitnessView(): FitnessViewResult {
  return {
    runScore: null,
    packets: [],
    evidence: [],
    maturationSummary: { none: 0, submitted: 0, verified: 0, integrated: 0 },
    queriedAt: '2026-03-19T10:10:00Z',
  };
}

function hookFeedWithPending(featureId: string): HookFeedResult {
  const event: HookEvent = {
    id: 'hd-1',
    timestamp: '2026-03-19T10:05:00Z',
    event: 'packet.failed',
    entityId: 'p-1',
    featureId,
    ruleMatched: 'retry-rule',
    action: 'retry_once',
    packets: ['p-1'],
    mode: 'advisory',
    operatorDecision: 'pending',
    executed: false,
    reason: 'test',
    conditions: null,
  };
  return {
    events: [event],
    summary: {
      totalDecisions: 1,
      pendingApprovals: 1,
      autoExecuted: 0,
      confirmedByOperator: 0,
      rejectedByOperator: 0,
      byEvent: { 'packet.failed': 1 },
      byAction: { retry_once: 1 },
      byRule: { 'retry-rule': 1 },
    },
    queriedAt: '2026-03-19T10:10:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('console command pipeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedVerificationProfile(db);
  });

  afterEach(() => {
    db.close();
  });

  // 1. Full console render produces output with all 5 pane headers
  it('full console render contains all 5 pane headers', () => {
    seedFeature(db, 'f-1', 'Console Test Feature');
    seedPacket(db, 'p-1', 'f-1', { status: 'in_progress' });
    seedPacket(db, 'p-2', 'f-1', { status: 'merged' });
    seedRun(db, 'r-1', 'f-1', { currentWave: 1, totalWaves: 2 });
    seedWorker(db, 'w-1', 'r-1', 'p-1', { wave: 1, status: 'running' });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    expect(runModel).not.toBeNull();

    const hookFeed = emptyHookFeed();
    const fitnessView = emptyFitnessView();
    const nextAction = computeNextAction(runModel, hookFeed);

    const output = renderConsole(runModel, hookFeed, fitnessView, nextAction.action);

    // Check all 5 pane headers are present
    expect(output).toContain('RUN OVERVIEW');
    expect(output).toContain('PACKET GRAPH');
    expect(output).toContain('WORKER SESSIONS');
    expect(output).toContain('HOOKS & GATES');
    expect(output).toContain('FITNESS & EVIDENCE');
  });

  // 2. "No active run" when DB is empty
  it('returns null run model when DB is empty', () => {
    const result = queryRunModelWithDb(db);
    expect(result).toBeNull();
  });

  // 3. next command produces correct NextAction for a paused run
  it('computeNextAction returns critical merge approval for paused run', () => {
    seedFeature(db, 'f-1', 'Paused Feature');
    seedPacket(db, 'p-1', 'f-1', { status: 'verified' });
    seedRun(db, 'r-1', 'f-1', {
      status: 'paused',
      pauseReason: 'Merge approval required',
      pauseGateType: 'merge_approval',
    });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const hookFeed = emptyHookFeed();
    const nextAction = computeNextAction(runModel, hookFeed);

    expect(nextAction.priority).toBe('critical');
    expect(nextAction.action).toContain('merge gate');
    expect(nextAction.command).toContain('merge_approval');
    expect(nextAction.command).toContain('f-1');
    expect(nextAction.reason).toContain('merge approval');
  });

  // 4. next --json output is valid JSON with correct shape
  it('next action produces valid JSON-serializable output', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'in_progress' });
    seedRun(db, 'r-1', 'f-1');
    seedWorker(db, 'w-1', 'r-1', 'p-1', { status: 'running' });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const hookFeed = emptyHookFeed();
    const nextAction = computeNextAction(runModel, hookFeed);

    // Simulate --json output
    const jsonStr = JSON.stringify({
      action: nextAction.action,
      command: nextAction.command,
      priority: nextAction.priority,
      reason: nextAction.reason,
    }, null, 2);

    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveProperty('action');
    expect(parsed).toHaveProperty('command');
    expect(parsed).toHaveProperty('priority');
    expect(parsed).toHaveProperty('reason');
    expect(typeof parsed.action).toBe('string');
    expect(['critical', 'normal', 'info']).toContain(parsed.priority);
  });

  // 5. Individual pane commands produce output
  describe('individual pane renders', () => {
    let runModel: RunModel;

    beforeEach(() => {
      seedFeature(db, 'f-1', 'Pane Test');
      seedPacket(db, 'p-1', 'f-1', { status: 'in_progress', layer: 'backend', role: 'builder' });
      seedPacket(db, 'p-2', 'f-1', { status: 'merged', layer: 'ui', role: 'builder' });
      seedRun(db, 'r-1', 'f-1', { currentWave: 1, totalWaves: 2 });
      seedWorker(db, 'w-1', 'r-1', 'p-1', { wave: 1, status: 'running' });
      seedWorker(db, 'w-2', 'r-1', 'p-2', { wave: 1, status: 'completed', completedAt: '2026-03-19T10:05:00Z' });
      runModel = queryRunModelWithDb(db, 'r-1')!;
    });

    it('overview pane contains run ID and feature title', () => {
      const nextAction = computeNextAction(runModel, emptyHookFeed());
      const output = renderRunOverview(runModel.overview, nextAction.action);
      expect(output).toContain('RUN OVERVIEW');
      expect(output).toContain('r-1');
      expect(output).toContain('Pane Test');
    });

    it('packet graph pane lists packets by wave', () => {
      const output = renderPacketGraph(runModel.packets);
      expect(output).toContain('PACKET GRAPH');
      expect(output).toContain('p-1');
      expect(output).toContain('p-2');
    });

    it('worker sessions pane lists workers with status', () => {
      const output = renderWorkerSessions(runModel.workers);
      expect(output).toContain('WORKER SESSIONS');
      expect(output).toContain('p-1');
      expect(output).toContain('running');
    });

    it('hooks pane renders with empty feed', () => {
      const output = renderHooksAndGates(emptyHookFeed(), runModel.gates);
      expect(output).toContain('HOOKS & GATES');
      expect(output).toContain('Pending approvals: 0');
    });

    it('fitness pane renders with empty view', () => {
      const output = renderFitnessAndEvidence(emptyFitnessView());
      expect(output).toContain('FITNESS & EVIDENCE');
      expect(output).toContain('no score computed');
    });
  });

  // 6. Console works with a complete run (all statuses)
  it('renders a complete run with all packet statuses', () => {
    seedFeature(db, 'f-1', 'Complete Feature');
    seedPacket(db, 'p-1', 'f-1', { status: 'merged', title: 'Contract' });
    seedPacket(db, 'p-2', 'f-1', { status: 'merged', title: 'Backend' });
    seedPacket(db, 'p-3', 'f-1', { status: 'merged', title: 'UI' });
    seedRun(db, 'r-1', 'f-1', {
      status: 'complete',
      currentWave: 3,
      totalWaves: 3,
      completedAt: '2026-03-19T12:00:00Z',
    });
    seedWorker(db, 'w-1', 'r-1', 'p-1', { wave: 1, status: 'completed', completedAt: '2026-03-19T10:10:00Z' });
    seedWorker(db, 'w-2', 'r-1', 'p-2', { wave: 2, status: 'completed', completedAt: '2026-03-19T11:00:00Z' });
    seedWorker(db, 'w-3', 'r-1', 'p-3', { wave: 3, status: 'completed', completedAt: '2026-03-19T12:00:00Z' });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    expect(runModel).not.toBeNull();
    expect(runModel.overview.status).toBe('complete');
    expect(runModel.overview.mergedCount).toBe(3);

    const hookFeed = emptyHookFeed();
    const fitnessView = emptyFitnessView();
    const nextAction = computeNextAction(runModel, hookFeed);

    // Complete run should be info priority
    expect(nextAction.priority).toBe('info');
    expect(nextAction.action).toContain('complete');

    const output = renderConsole(runModel, hookFeed, fitnessView, nextAction.action);
    expect(output).toContain('RUN OVERVIEW');
    expect(output).toContain('complete');
    expect(output).toContain('3 merged');
  });

  // 7. Pending hook approvals produce critical next action
  it('pending hook approvals produce critical next action', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'failed' });
    seedRun(db, 'r-1', 'f-1');

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const hookFeed = hookFeedWithPending('f-1');
    const nextAction = computeNextAction(runModel, hookFeed);

    expect(nextAction.priority).toBe('critical');
    expect(nextAction.action).toContain('hook decision');
    expect(nextAction.command).toContain('hooks resolve');
  });

  // 8. Feature approval pending produces correct action
  it('feature approval gate produces critical next action', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedRun(db, 'r-1', 'f-1', {
      status: 'paused',
      pauseReason: 'Feature not approved',
      pauseGateType: 'feature_approval',
    });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const nextAction = computeNextAction(runModel, emptyHookFeed());

    expect(nextAction.priority).toBe('critical');
    expect(nextAction.action).toContain('feature gate');
    expect(nextAction.command).toContain('feature_approval');
  });

  // 9. Running workers produce info/wait next action
  it('running workers produce info wait action', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'in_progress' });
    seedPacket(db, 'p-2', 'f-1', { status: 'in_progress' });
    seedRun(db, 'r-1', 'f-1');
    seedWorker(db, 'w-1', 'r-1', 'p-1', { wave: 1, status: 'running' });
    seedWorker(db, 'w-2', 'r-1', 'p-2', { wave: 1, status: 'running' });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const nextAction = computeNextAction(runModel, emptyHookFeed());

    expect(nextAction.priority).toBe('info');
    expect(nextAction.action).toContain('Wait');
    expect(nextAction.action).toContain('2 worker(s)');
    expect(nextAction.command).toBeNull();
  });

  // 10. Gates appear in hooks pane rendering
  it('gates with resolved approvals render correctly', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1');
    seedApproval(db, 'a-1', 'feature', 'f-1', 'feature_approval', 'approved', 'mike');

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    // runModel is null because we didn't seed a run, but we can test gates directly
    const gates = db.prepare(`
      SELECT approval_type, scope_type, scope_id, decision, actor, created_at
      FROM approvals WHERE scope_type = 'feature' AND scope_id = 'f-1'
    `).all();
    expect(gates).toHaveLength(1);

    // Test via the hooks pane with gates from query
    seedRun(db, 'r-1', 'f-1');
    const model = queryRunModelWithDb(db, 'r-1')!;
    const output = renderHooksAndGates(emptyHookFeed(), model.gates);
    expect(output).toContain('HOOKS & GATES');
    expect(output).toContain('Gates:');
    expect(output).toContain('feature_approval');
  });

  // 11. Failed run produces normal priority next action
  it('failed run produces normal priority action with status command', () => {
    seedFeature(db, 'f-1');
    seedPacket(db, 'p-1', 'f-1', { status: 'failed' });
    seedRun(db, 'r-1', 'f-1', { status: 'failed', completedAt: '2026-03-19T11:00:00Z' });

    const runModel = queryRunModelWithDb(db, 'r-1')!;
    const nextAction = computeNextAction(runModel, emptyHookFeed());

    expect(nextAction.priority).toBe('normal');
    expect(nextAction.action).toContain('failed');
    expect(nextAction.command).toContain('auto status');
  });

  // 12. Null run model produces info next action
  it('null run model produces info next action', () => {
    const nextAction = computeNextAction(null, emptyHookFeed());

    expect(nextAction.priority).toBe('info');
    expect(nextAction.action).toContain('No active run');
    expect(nextAction.command).toContain('auto run');
  });
});
