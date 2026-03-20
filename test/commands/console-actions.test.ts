/**
 * console-actions.test.ts — Tests for the console actions, act, and audit
 * sub-commands: rendering functions, JSON output, and integration with
 * the action-availability and audit-trail modules.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderActions,
  renderActionResult,
  renderAuditTrail,
} from '../../src/commands/console-actions.js';
import type { ActionResult } from '../../src/commands/console-actions.js';
import {
  computeAllActions,
  computeActionAvailability,
} from '../../src/console/action-availability.js';
import type { ActionAvailability, Precondition } from '../../src/console/action-availability.js';
import type { AuditEntry } from '../../src/console/audit-trail.js';
import type { RunModel, RunOverview, PacketNode, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent, HookFeedSummary } from '../../src/console/hook-feed.js';
import { queryRunModelWithDb } from '../../src/console/run-model.js';
import { MAX_RETRIES } from '../../src/hooks/policy.js';

// ── Factory helpers ─────────────────────────────────────────────────

function makeOverview(overrides: Partial<RunOverview> = {}): RunOverview {
  return {
    runId: 'run_demo',
    featureId: 'feat_demo',
    featureTitle: 'Demo Feature',
    status: 'running',
    startedAt: '2026-03-19T10:00:00Z',
    completedAt: null,
    currentWave: 1,
    totalWaves: 2,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 2,
    packetsByStatus: { ready: 1, failed: 1 },
    mergedCount: 0,
    failedCount: 1,
    blockedCount: 0,
    inProgressCount: 0,
    workClass: null,
    predictedFit: null,
    predictedGradeRange: null,
    ...overrides,
  };
}

function makePacket(overrides: Partial<PacketNode> = {}): PacketNode {
  return {
    packetId: 'pkt_203',
    title: 'Test Packet',
    layer: 'core',
    role: 'builder',
    status: 'ready',
    wave: 1,
    goal: 'Build something',
    owner: null,
    attemptNumber: 0,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeGate(overrides: Partial<GateStatus> = {}): GateStatus {
  return {
    type: 'feature_approval',
    scopeType: 'feature',
    scopeId: 'feat_demo',
    resolved: false,
    decision: null,
    actor: null,
    resolvedAt: null,
    ...overrides,
  };
}

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    id: 'hook-001',
    timestamp: '2026-03-19T10:05:00Z',
    event: 'packet.failed',
    entityId: 'pkt_203',
    featureId: 'feat_demo',
    ruleMatched: 'retry-rule',
    action: 'retry_once',
    packets: ['pkt_203'],
    mode: 'advisory',
    operatorDecision: 'pending',
    executed: false,
    reason: 'Deterministic failure',
    conditions: null,
    ...overrides,
  };
}

function makeHookFeed(events: HookEvent[] = []): HookFeedResult {
  return {
    events,
    summary: {
      totalDecisions: events.length,
      pendingApprovals: events.filter(e => e.operatorDecision === 'pending').length,
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

function makeRunModel(overrides: {
  overview?: Partial<RunOverview>;
  packets?: PacketNode[];
  gates?: GateStatus[];
} = {}): RunModel {
  return {
    overview: makeOverview(overrides.overview),
    packets: overrides.packets ?? [makePacket()],
    workers: [],
    gates: overrides.gates ?? [],
    queriedAt: '2026-03-19T10:00:00Z',
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'aud_abc123',
    timestamp: '2026-03-19T16:30:45Z',
    actor: 'operator',
    action: 'stop_run',
    targetType: 'run',
    targetId: 'run_demo',
    beforeState: 'running',
    afterState: 'stopped',
    reason: 'Packet taking too long',
    command: 'multi-claude auto stop --run run_demo',
    success: true,
    error: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('renderActions', () => {
  // 1. Shows checkmark for available actions
  it('shows checkmark for available actions', () => {
    const model = makeRunModel({ overview: { status: 'running' } });
    const actions = computeAllActions(model, makeHookFeed());
    const output = renderActions(actions);

    // stop_run should be available when status is 'running'
    expect(output).toContain('✓ stop_run');
    expect(output).toContain('AVAILABLE ACTIONS');
  });

  // 2. Shows X for unavailable actions
  it('shows X for unavailable actions', () => {
    const model = makeRunModel({ overview: { status: 'running' } });
    const actions = computeAllActions(model, makeHookFeed());
    const output = renderActions(actions);

    // resume_run should be unavailable when status is 'running'
    expect(output).toContain('✗ resume_run');
  });

  // 3. Shows preconditions for unavailable actions
  it('shows preconditions for unavailable actions', () => {
    const model = makeRunModel({
      overview: { status: 'running' },
      packets: [makePacket({ packetId: 'pkt_203', status: 'in_progress', attemptNumber: 1 })],
    });
    const actions = computeAllActions(model, makeHookFeed());

    // Find the retry action (should be unavailable because packet is in_progress, not failed)
    // But retry only shows for failed packets — so let's make one failed with limit reached
    const model2 = makeRunModel({
      overview: { status: 'complete' },
    });
    const actions2 = computeAllActions(model2, makeHookFeed());
    const output2 = renderActions(actions2);

    // stop_run should be unavailable for complete run
    expect(output2).toContain('✗ stop_run');
    expect(output2).toContain('Preconditions:');
  });

  // Directly test with constructed ActionAvailability
  it('shows preconditions detail for constructed unavailable action', () => {
    const unavailable: ActionAvailability = {
      action: 'retry_packet',
      available: false,
      reason: "Packet status is 'in_progress', not 'failed'",
      command: null,
      targetId: 'pkt_203',
      targetType: 'packet',
      preconditions: [
        { check: 'Packet exists in run', met: true, detail: 'Packet pkt_203 found' },
        { check: 'Packet is failed', met: false, detail: "Packet status is 'in_progress', not 'failed'" },
        { check: 'Retry limit not reached', met: true, detail: 'Attempt 1 of 3' },
      ],
    };

    const output = renderActions([unavailable]);

    expect(output).toContain('✗ retry_packet (pkt_203)');
    expect(output).toContain('Preconditions:');
    expect(output).toContain('✓ Packet exists in run');
    expect(output).toContain('✗ Packet is failed');
    expect(output).toContain("Packet status is 'in_progress', not 'failed'");
    expect(output).toContain('✓ Retry limit not reached');
  });

  it('notes when no pending hook decisions exist', () => {
    const model = makeRunModel({ overview: { status: 'running' } });
    const actions = computeAllActions(model, makeHookFeed());
    const output = renderActions(actions);

    expect(output).toContain('No pending hook decisions to resolve');
  });

  it('renders empty list gracefully', () => {
    const output = renderActions([]);
    expect(output).toContain('AVAILABLE ACTIONS');
    expect(output).toContain('no actions available');
  });
});

describe('renderActionResult', () => {
  // 4. Shows success format
  it('shows success format with state transition', () => {
    const result: ActionResult = {
      success: true,
      action: 'stop_run',
      targetId: 'run_demo',
      beforeState: 'running',
      afterState: 'stopped',
      auditId: 'aud_abc123',
      error: null,
      preconditions: [],
    };

    const output = renderActionResult(result);

    expect(output).toContain('✓ Action: stop_run');
    expect(output).toContain('Target: run_demo');
    expect(output).toContain('Before: running');
    expect(output).toContain('After: stopped');
    expect(output).toContain('Audit: aud_abc123');
  });

  // 5. Shows failure format with preconditions
  it('shows failure format with failed preconditions', () => {
    const result: ActionResult = {
      success: false,
      action: 'retry_packet',
      targetId: 'pkt_203',
      beforeState: '',
      afterState: '',
      auditId: null,
      error: "Packet status is 'in_progress', not 'failed'",
      preconditions: [
        { check: 'Packet exists in run', met: true, detail: 'Packet pkt_203 found' },
        { check: 'Packet is failed', met: false, detail: "Packet status is 'in_progress', not 'failed'" },
      ],
    };

    const output = renderActionResult(result);

    expect(output).toContain('✗ Action: retry_packet');
    expect(output).toContain('Target: pkt_203');
    expect(output).toContain("Error: Packet status is 'in_progress', not 'failed'");
    expect(output).toContain('Preconditions that failed:');
    expect(output).toContain("✗ Packet is failed — Packet status is 'in_progress', not 'failed'");
  });

  it('does not show preconditions section when all met', () => {
    const result: ActionResult = {
      success: false,
      action: 'stop_run',
      targetId: 'run_demo',
      beforeState: '',
      afterState: '',
      auditId: null,
      error: 'Some other error',
      preconditions: [
        { check: 'Run exists', met: true, detail: 'Run run_demo' },
      ],
    };

    const output = renderActionResult(result);

    expect(output).not.toContain('Preconditions that failed:');
  });
});

describe('renderAuditTrail', () => {
  // 6. Shows entries with timestamps
  it('shows entries with timestamps and state transitions', () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({
        timestamp: '2026-03-19T16:30:45Z',
        action: 'stop_run',
        targetId: 'run_demo',
        beforeState: 'running',
        afterState: 'stopped',
        reason: 'Packet taking too long',
      }),
      makeAuditEntry({
        id: 'aud_def456',
        timestamp: '2026-03-19T16:25:12Z',
        action: 'approve_gate',
        targetId: 'feature:feat_demo',
        beforeState: 'pending',
        afterState: 'approved',
        reason: 'Ready to merge',
      }),
    ];

    const output = renderAuditTrail(entries);

    expect(output).toContain('OPERATOR AUDIT TRAIL');
    expect(output).toContain('stop_run');
    expect(output).toContain('run_demo');
    expect(output).toContain('running → stopped');
    expect(output).toContain('by operator');
    expect(output).toContain('Reason: Packet taking too long');
    expect(output).toContain('approve_gate');
    expect(output).toContain('pending → approved');
    expect(output).toContain('Reason: Ready to merge');
  });

  // 7. Handles empty list
  it('handles empty audit trail', () => {
    const output = renderAuditTrail([]);

    expect(output).toContain('OPERATOR AUDIT TRAIL');
    expect(output).toContain('no audit entries');
  });

  it('shows error for failed audit entries', () => {
    const entries: AuditEntry[] = [
      makeAuditEntry({
        success: false,
        error: 'Database locked',
        action: 'retry_packet',
        targetId: 'pkt_203',
      }),
    ];

    const output = renderAuditTrail(entries);
    expect(output).toContain('Error: Database locked');
  });
});

describe('JSON output', () => {
  // 8. JSON output for actions is valid JSON
  it('actions list serializes to valid JSON', () => {
    const model = makeRunModel({
      overview: { status: 'running' },
      gates: [makeGate({ resolved: false })],
    });
    const hookFeed = makeHookFeed([makeHookEvent()]);
    const actions = computeAllActions(model, hookFeed);

    const jsonStr = JSON.stringify({ actions }, null, 2);
    const parsed = JSON.parse(jsonStr);

    expect(parsed).toHaveProperty('actions');
    expect(Array.isArray(parsed.actions)).toBe(true);
    expect(parsed.actions.length).toBeGreaterThan(0);

    // Each action has required fields
    for (const a of parsed.actions) {
      expect(a).toHaveProperty('action');
      expect(a).toHaveProperty('available');
      expect(a).toHaveProperty('reason');
      expect(a).toHaveProperty('targetId');
      expect(a).toHaveProperty('targetType');
      expect(a).toHaveProperty('preconditions');
      expect(typeof a.available).toBe('boolean');
    }
  });

  // 9. JSON output for act result is valid JSON
  it('action result serializes to valid JSON', () => {
    const result: ActionResult = {
      success: true,
      action: 'stop_run',
      targetId: 'run_demo',
      beforeState: 'running',
      afterState: 'stopped',
      auditId: 'aud_abc123',
      error: null,
      preconditions: [
        { check: 'Run exists', met: true, detail: 'Run run_demo' },
        { check: 'Run is stoppable', met: true, detail: 'Status is running' },
      ],
    };

    const jsonStr = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(jsonStr);

    expect(parsed).toHaveProperty('success', true);
    expect(parsed).toHaveProperty('action', 'stop_run');
    expect(parsed).toHaveProperty('targetId', 'run_demo');
    expect(parsed).toHaveProperty('beforeState', 'running');
    expect(parsed).toHaveProperty('afterState', 'stopped');
    expect(parsed).toHaveProperty('auditId', 'aud_abc123');
    expect(parsed).toHaveProperty('preconditions');
    expect(Array.isArray(parsed.preconditions)).toBe(true);
  });

  it('failure action result serializes to valid JSON', () => {
    const result: ActionResult = {
      success: false,
      action: 'retry_packet',
      targetId: 'pkt_203',
      beforeState: '',
      afterState: '',
      auditId: null,
      error: 'Not failed',
      preconditions: [
        { check: 'Packet is failed', met: false, detail: 'Status is in_progress' },
      ],
    };

    const jsonStr = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Not failed');
    expect(parsed.auditId).toBeNull();
  });
});

// 10. Integration: console actions works with run model
describe('console actions integration with run model', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SCHEMA_PATH = join(__dirname, '..', '..', 'src', 'db', 'schema.sql');

  let db: Database.Database;

  function createTestDb(): Database.Database {
    const testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');

    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('PRAGMA'));

    for (const stmt of statements) {
      testDb.exec(stmt + ';');
    }

    testDb.exec(`
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

    return testDb;
  }

  beforeEach(() => {
    db = createTestDb();

    // Seed verification profile
    db.prepare(`
      INSERT OR IGNORE INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps)
      VALUES ('vp-1', 'org/repo', 'backend', 'default', 'builder', '[]')
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  it('computes actions for an active run from DB', () => {
    // Seed feature + packet + run
    db.prepare(`
      INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
      VALUES ('f-act', 'org/repo', 'Action Test', 'Test actions', 'in_progress', 'main', '["works"]', 'human')
    `).run();

    db.prepare(`
      INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id,
        status, goal, allowed_files, verification_profile_id, created_by)
      VALUES ('p-act', 'f-act', 'Action Packet', 'backend', 'desc', 'builder', 'pb-1',
        'failed', 'Do thing', '["src/**"]', 'vp-1', 'human')
    `).run();

    db.prepare(`
      INSERT INTO auto_runs (run_id, feature_id, status, started_at, completed_at,
        current_wave, total_waves, pause_reason, pause_gate_type, config_json)
      VALUES ('r-act', 'f-act', 'running', '2026-03-19T10:00:00Z', NULL, 1, 2, NULL, NULL, '{}')
    `).run();

    const runModel = queryRunModelWithDb(db, 'r-act');
    expect(runModel).not.toBeNull();

    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel!, hookFeed);

    // Should have stop_run (available), resume_run (unavailable), and retry_packet (for failed packet)
    expect(actions.length).toBeGreaterThanOrEqual(2);

    const stopAction = actions.find(a => a.action === 'stop_run');
    expect(stopAction).toBeDefined();
    expect(stopAction!.available).toBe(true);

    const resumeAction = actions.find(a => a.action === 'resume_run');
    expect(resumeAction).toBeDefined();
    expect(resumeAction!.available).toBe(false);

    // Render produces valid output
    const output = renderActions(actions);
    expect(output).toContain('AVAILABLE ACTIONS');
    expect(output).toContain('stop_run');
  });

  it('renders actions with gates from DB run model', () => {
    db.prepare(`
      INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
      VALUES ('f-gate', 'org/repo', 'Gate Test', 'Test gates', 'in_progress', 'main', '["works"]', 'human')
    `).run();

    db.prepare(`
      INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id,
        status, goal, allowed_files, verification_profile_id, created_by)
      VALUES ('p-gate', 'f-gate', 'Gate Packet', 'backend', 'desc', 'builder', 'pb-1',
        'ready', 'Do thing', '["src/**"]', 'vp-1', 'human')
    `).run();

    db.prepare(`
      INSERT INTO auto_runs (run_id, feature_id, status, started_at, completed_at,
        current_wave, total_waves, pause_reason, pause_gate_type, config_json)
      VALUES ('r-gate', 'f-gate', 'paused', '2026-03-19T10:00:00Z', NULL, 1, 2,
        'Feature approval needed', 'feature_approval', '{}')
    `).run();

    const runModel = queryRunModelWithDb(db, 'r-gate');
    expect(runModel).not.toBeNull();

    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel!, hookFeed);

    // Should include approve_gate for the unresolved feature_approval gate
    const gateActions = actions.filter(a => a.action === 'approve_gate');
    expect(gateActions.length).toBeGreaterThan(0);

    // stop_run should be available (paused is stoppable)
    const stopAction = actions.find(a => a.action === 'stop_run');
    expect(stopAction).toBeDefined();
    expect(stopAction!.available).toBe(true);

    const output = renderActions(actions);
    expect(output).toContain('approve_gate');
  });
});
