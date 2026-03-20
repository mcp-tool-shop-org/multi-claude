import { describe, it, expect } from 'vitest';
import {
  computeAllActions,
  computeActionAvailability,
} from '../../src/console/action-availability.js';
import type { ActionAvailability, Precondition } from '../../src/console/action-availability.js';
import type { RunModel, RunOverview, PacketNode, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent, HookFeedSummary } from '../../src/console/hook-feed.js';
import { MAX_RETRIES } from '../../src/hooks/policy.js';

// ── Factory helpers ─────────────────────────────────────────────────

function makeOverview(overrides: Partial<RunOverview> = {}): RunOverview {
  return {
    runId: 'run-001',
    featureId: 'feat-001',
    featureTitle: 'Test Feature',
    status: 'running',
    startedAt: '2026-03-19T00:00:00Z',
    completedAt: null,
    currentWave: 1,
    totalWaves: 3,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 3,
    packetsByStatus: { ready: 1, in_progress: 1, failed: 1 },
    mergedCount: 0,
    failedCount: 1,
    blockedCount: 0,
    inProgressCount: 1,
    workClass: null,
    predictedFit: null,
    predictedGradeRange: null,
    ...overrides,
  };
}

function makePacket(overrides: Partial<PacketNode> = {}): PacketNode {
  return {
    packetId: 'pkt-001',
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
    type: 'merge_approval',
    scopeType: 'packet',
    scopeId: 'pkt-001',
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
    timestamp: '2026-03-19T00:00:00Z',
    event: 'packet.failed',
    entityId: 'pkt-001',
    featureId: 'feat-001',
    ruleMatched: 'rule_4a_retry_deterministic',
    action: 'retry_once',
    packets: ['pkt-001'],
    mode: 'advisory',
    operatorDecision: 'pending',
    executed: false,
    reason: 'Deterministic failure',
    conditions: null,
    ...overrides,
  };
}

function makeHookFeedSummary(events: HookEvent[]): HookFeedSummary {
  return {
    totalDecisions: events.length,
    pendingApprovals: events.filter(e => e.operatorDecision === 'pending').length,
    autoExecuted: events.filter(e => e.operatorDecision === 'auto' && e.executed).length,
    confirmedByOperator: events.filter(e => e.operatorDecision === 'confirmed').length,
    rejectedByOperator: events.filter(e => e.operatorDecision === 'rejected').length,
    byEvent: {},
    byAction: {},
    byRule: {},
  };
}

function makeHookFeed(events: HookEvent[] = []): HookFeedResult {
  return {
    events,
    summary: makeHookFeedSummary(events),
    queriedAt: '2026-03-19T00:00:00Z',
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
    queriedAt: '2026-03-19T00:00:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('action-availability', () => {
  // ── stop_run ────────────────────────────────────────────────────

  describe('stop_run', () => {
    it('available when run is running', () => {
      const model = makeRunModel({ overview: { status: 'running' } });
      const result = computeActionAvailability('stop_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(true);
      expect(result.action).toBe('stop_run');
      expect(result.command).toContain('multi-claude auto stop');
      expect(result.command).toContain('run-001');
      expect(result.targetType).toBe('run');
    });

    it('available when run is paused', () => {
      const model = makeRunModel({ overview: { status: 'paused' } });
      const result = computeActionAvailability('stop_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(true);
      expect(result.command).not.toBeNull();
    });

    it('unavailable when run is complete', () => {
      const model = makeRunModel({ overview: { status: 'complete' } });
      const result = computeActionAvailability('stop_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.command).toBeNull();
      expect(result.reason).toContain('terminal state');
    });

    it('unavailable when run is failed', () => {
      const model = makeRunModel({ overview: { status: 'failed' } });
      const result = computeActionAvailability('stop_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.command).toBeNull();
      expect(result.reason).toContain("terminal state 'failed'");
    });
  });

  // ── retry_packet ────────────────────────────────────────────────

  describe('retry_packet', () => {
    it('available for failed packet with attempts < MAX_RETRIES', () => {
      const model = makeRunModel({
        packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      });
      const result = computeActionAvailability('retry_packet', 'pkt-fail', model, makeHookFeed());

      expect(result.available).toBe(true);
      expect(result.command).toContain('multi-claude claim pkt-fail');
      expect(result.command).toContain('--actor operator');
      expect(result.command).toContain('--session retry-pkt-fail');
      expect(result.targetType).toBe('packet');
    });

    it('unavailable when packet is not failed', () => {
      const model = makeRunModel({
        packets: [makePacket({ packetId: 'pkt-ok', status: 'in_progress', attemptNumber: 1 })],
      });
      const result = computeActionAvailability('retry_packet', 'pkt-ok', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain("'in_progress', not 'failed'");
    });

    it('unavailable when retry limit reached', () => {
      const model = makeRunModel({
        packets: [makePacket({ packetId: 'pkt-exhaust', status: 'failed', attemptNumber: MAX_RETRIES })],
      });
      const result = computeActionAvailability('retry_packet', 'pkt-exhaust', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('retry limit reached');
    });

    it('unavailable when packet not found', () => {
      const model = makeRunModel({ packets: [] });
      const result = computeActionAvailability('retry_packet', 'pkt-ghost', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── resume_run ──────────────────────────────────────────────────

  describe('resume_run', () => {
    it('available when paused with gate resolved', () => {
      const model = makeRunModel({
        overview: { status: 'paused', pauseGateType: 'merge_approval' },
        gates: [makeGate({ type: 'merge_approval', resolved: true, decision: 'approved', actor: 'operator' })],
      });
      const result = computeActionAvailability('resume_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(true);
      expect(result.command).toContain('multi-claude auto resume');
    });

    it('available when paused with no gate type (generic pause)', () => {
      const model = makeRunModel({
        overview: { status: 'paused', pauseGateType: null },
      });
      const result = computeActionAvailability('resume_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(true);
    });

    it('unavailable when not paused', () => {
      const model = makeRunModel({ overview: { status: 'running' } });
      const result = computeActionAvailability('resume_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain("'running', not 'paused'");
    });

    it('unavailable when gate is unresolved', () => {
      const model = makeRunModel({
        overview: { status: 'paused', pauseGateType: 'merge_approval' },
        gates: [makeGate({ type: 'merge_approval', resolved: false })],
      });
      const result = computeActionAvailability('resume_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('unresolved');
    });

    it('unavailable when feature_approval gate is unresolved', () => {
      const model = makeRunModel({
        overview: { status: 'paused', pauseGateType: 'feature_approval' },
        gates: [makeGate({ type: 'feature_approval', scopeType: 'feature', resolved: false })],
      });
      const result = computeActionAvailability('resume_run', 'run-001', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('unresolved');
    });
  });

  // ── approve_gate ────────────────────────────────────────────────

  describe('approve_gate', () => {
    it('available for unresolved gate', () => {
      const gate = makeGate({ type: 'merge_approval', scopeType: 'packet', scopeId: 'pkt-001', resolved: false });
      const model = makeRunModel({ gates: [gate] });
      const targetId = 'packet:pkt-001:merge_approval';
      const result = computeActionAvailability('approve_gate', targetId, model, makeHookFeed());

      expect(result.available).toBe(true);
      expect(result.command).toContain('--scope-type packet');
      expect(result.command).toContain('--scope-id pkt-001');
      expect(result.command).toContain('--type merge_approval');
      expect(result.command).toContain('--actor operator');
      expect(result.targetType).toBe('gate');
    });

    it('unavailable for resolved gate', () => {
      const gate = makeGate({
        type: 'merge_approval',
        scopeType: 'packet',
        scopeId: 'pkt-001',
        resolved: true,
        decision: 'approved',
        actor: 'operator',
      });
      const model = makeRunModel({ gates: [gate] });
      const targetId = 'packet:pkt-001:merge_approval';
      const result = computeActionAvailability('approve_gate', targetId, model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('already resolved');
    });

    it('unavailable when gate not found', () => {
      const model = makeRunModel({ gates: [] });
      const result = computeActionAvailability('approve_gate', 'packet:pkt-999:merge_approval', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── resolve_hook ────────────────────────────────────────────────

  describe('resolve_hook', () => {
    it('available for pending decision with action', () => {
      const hookEvent = makeHookEvent({ id: 'hook-pending', operatorDecision: 'pending', action: 'retry_once' });
      const feed = makeHookFeed([hookEvent]);
      const model = makeRunModel();
      const result = computeActionAvailability('resolve_hook', 'hook-pending', model, feed);

      expect(result.available).toBe(true);
      expect(result.command).toContain('multi-claude hooks resolve');
      expect(result.command).toContain('--decision hook-pending');
      expect(result.command).toContain('--resolution confirmed');
      expect(result.targetType).toBe('hook_decision');
    });

    it('unavailable for already-resolved decision', () => {
      const hookEvent = makeHookEvent({ id: 'hook-done', operatorDecision: 'confirmed', action: 'retry_once' });
      const feed = makeHookFeed([hookEvent]);
      const model = makeRunModel();
      const result = computeActionAvailability('resolve_hook', 'hook-done', model, feed);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('already resolved: confirmed');
    });

    it('unavailable when no action proposed', () => {
      const hookEvent = makeHookEvent({ id: 'hook-noaction', operatorDecision: 'pending', action: null });
      const feed = makeHookFeed([hookEvent]);
      const model = makeRunModel();
      const result = computeActionAvailability('resolve_hook', 'hook-noaction', model, feed);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('No action proposed');
    });

    it('unavailable when hook decision not found', () => {
      const model = makeRunModel();
      const result = computeActionAvailability('resolve_hook', 'hook-ghost', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── computeAllActions ───────────────────────────────────────────

  describe('computeAllActions', () => {
    it('returns available actions before unavailable', () => {
      const model = makeRunModel({
        overview: { status: 'running' },
        packets: [
          makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 }),
        ],
        gates: [makeGate({ resolved: false })],
      });
      const pendingHook = makeHookEvent({ id: 'hook-1', operatorDecision: 'pending', action: 'retry_once' });
      const feed = makeHookFeed([pendingHook]);

      const actions = computeAllActions(model, feed);

      // Find the boundary between available and unavailable
      const firstUnavailableIdx = actions.findIndex(a => !a.available);
      if (firstUnavailableIdx > 0) {
        // All actions before the first unavailable should be available
        for (let i = 0; i < firstUnavailableIdx; i++) {
          expect(actions[i].available).toBe(true);
        }
        // All actions from firstUnavailableIdx onward should be unavailable
        for (let i = firstUnavailableIdx; i < actions.length; i++) {
          expect(actions[i].available).toBe(false);
        }
      }
    });

    it('generates entries for each failed packet', () => {
      const model = makeRunModel({
        packets: [
          makePacket({ packetId: 'pkt-f1', status: 'failed', attemptNumber: 1 }),
          makePacket({ packetId: 'pkt-f2', status: 'failed', attemptNumber: 2 }),
          makePacket({ packetId: 'pkt-ok', status: 'merged', attemptNumber: 1 }),
        ],
      });
      const actions = computeAllActions(model, makeHookFeed());
      const retryActions = actions.filter(a => a.action === 'retry_packet');

      expect(retryActions).toHaveLength(2);
      expect(retryActions.map(a => a.targetId)).toContain('pkt-f1');
      expect(retryActions.map(a => a.targetId)).toContain('pkt-f2');
    });

    it('generates entries for each unresolved gate', () => {
      const model = makeRunModel({
        gates: [
          makeGate({ type: 'merge_approval', scopeId: 'pkt-001', resolved: false }),
          makeGate({ type: 'feature_approval', scopeType: 'feature', scopeId: 'feat-001', resolved: false }),
          makeGate({ type: 'merge_approval', scopeId: 'pkt-002', resolved: true, decision: 'approved', actor: 'op' }),
        ],
      });
      const actions = computeAllActions(model, makeHookFeed());
      const gateActions = actions.filter(a => a.action === 'approve_gate');

      // Only unresolved gates get entries
      expect(gateActions).toHaveLength(2);
    });

    it('generates entries for each pending hook decision', () => {
      const model = makeRunModel();
      const feed = makeHookFeed([
        makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'retry_once' }),
        makeHookEvent({ id: 'h2', operatorDecision: 'pending', action: 'launch_workers' }),
        makeHookEvent({ id: 'h3', operatorDecision: 'confirmed', action: 'retry_once' }),
      ]);
      const actions = computeAllActions(model, feed);
      const hookActions = actions.filter(a => a.action === 'resolve_hook');

      // Only pending decisions get entries
      expect(hookActions).toHaveLength(2);
    });

    it('always includes stop_run and resume_run entries', () => {
      const model = makeRunModel({ overview: { status: 'running' } });
      const actions = computeAllActions(model, makeHookFeed());

      expect(actions.some(a => a.action === 'stop_run')).toBe(true);
      expect(actions.some(a => a.action === 'resume_run')).toBe(true);
    });
  });

  // ── computeActionAvailability ───────────────────────────────────

  describe('computeActionAvailability', () => {
    it('returns correct result for specific target', () => {
      const model = makeRunModel({
        packets: [
          makePacket({ packetId: 'pkt-a', status: 'failed', attemptNumber: 1 }),
          makePacket({ packetId: 'pkt-b', status: 'failed', attemptNumber: MAX_RETRIES }),
        ],
      });

      const resultA = computeActionAvailability('retry_packet', 'pkt-a', model, makeHookFeed());
      expect(resultA.available).toBe(true);
      expect(resultA.targetId).toBe('pkt-a');

      const resultB = computeActionAvailability('retry_packet', 'pkt-b', model, makeHookFeed());
      expect(resultB.available).toBe(false);
      expect(resultB.targetId).toBe('pkt-b');
    });

    it('handles unknown action gracefully', () => {
      const model = makeRunModel();
      const result = computeActionAvailability('teleport', 'x', model, makeHookFeed());

      expect(result.available).toBe(false);
      expect(result.reason).toContain('Unknown action');
    });
  });

  // ── Precondition quality ────────────────────────────────────────

  describe('precondition quality', () => {
    it('all preconditions have descriptive check and detail strings', () => {
      const model = makeRunModel({
        overview: { status: 'paused', pauseGateType: 'merge_approval' },
        packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
        gates: [makeGate({ resolved: false })],
      });
      const feed = makeHookFeed([
        makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'retry_once' }),
      ]);

      const actions = computeAllActions(model, feed);

      for (const action of actions) {
        expect(action.preconditions.length).toBeGreaterThan(0);
        for (const pre of action.preconditions) {
          expect(pre.check).toBeTruthy();
          expect(pre.check.length).toBeGreaterThan(3);
          expect(pre.detail).toBeTruthy();
          expect(pre.detail.length).toBeGreaterThan(3);
          expect(typeof pre.met).toBe('boolean');
        }
      }
    });
  });
});
