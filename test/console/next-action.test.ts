import { describe, it, expect } from 'vitest';
import { computeNextAction } from '../../src/console/next-action.js';
import type { NextAction } from '../../src/console/next-action.js';
import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookFeedSummary, HookEvent } from '../../src/console/hook-feed.js';

// ── Factory helpers ────────────────────────────────────────────────────

function makeOverview(overrides?: Partial<RunOverview>): RunOverview {
  return {
    runId: 'run-001',
    featureId: 'feat-001',
    featureTitle: 'Test Feature',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    currentWave: 1,
    totalWaves: 3,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 4,
    packetsByStatus: {},
    mergedCount: 0,
    failedCount: 0,
    blockedCount: 0,
    inProgressCount: 0,
    workClass: null,
    predictedFit: null,
    predictedGradeRange: null,
    ...overrides,
  };
}

function makePacket(overrides?: Partial<PacketNode>): PacketNode {
  return {
    packetId: 'pkt-001',
    title: 'Test Packet',
    layer: 'backend',
    role: 'builder',
    status: 'ready',
    wave: 1,
    goal: 'Do thing',
    owner: null,
    attemptNumber: 0,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeWorker(overrides?: Partial<WorkerSession>): WorkerSession {
  return {
    workerId: 'w-001',
    packetId: 'pkt-001',
    wave: 1,
    status: 'running',
    startedAt: '2026-01-01T00:01:00Z',
    completedAt: null,
    elapsedMs: null,
    worktreePath: null,
    branchName: null,
    attemptNumber: 1,
    error: null,
    modelName: null,
    role: null,
    endReason: null,
    ...overrides,
  };
}

function makeRunModel(overrides?: Partial<RunModel>): RunModel {
  return {
    overview: makeOverview(),
    packets: [],
    workers: [],
    gates: [],
    queriedAt: '2026-01-01T00:05:00Z',
    ...overrides,
  };
}

function makeHookEvent(overrides?: Partial<HookEvent>): HookEvent {
  return {
    id: 'hk-001',
    timestamp: '2026-01-01T00:02:00Z',
    event: 'packet.submitted',
    entityId: 'pkt-001',
    featureId: 'feat-001',
    ruleMatched: 'auto-verify',
    action: 'auto_verify',
    packets: ['pkt-001'],
    mode: 'advisory',
    operatorDecision: 'pending',
    executed: false,
    reason: null,
    conditions: null,
    ...overrides,
  };
}

function makeHookFeed(events?: HookEvent[]): HookFeedResult {
  const evs = events ?? [];
  const pending = evs.filter(e => e.operatorDecision === 'pending').length;
  const auto = evs.filter(e => e.operatorDecision === 'auto' && e.executed).length;
  const confirmed = evs.filter(e => e.operatorDecision === 'confirmed').length;
  const rejected = evs.filter(e => e.operatorDecision === 'rejected').length;
  return {
    events: evs,
    summary: {
      totalDecisions: evs.length,
      pendingApprovals: pending,
      autoExecuted: auto,
      confirmedByOperator: confirmed,
      rejectedByOperator: rejected,
      byEvent: {},
      byAction: {},
      byRule: {},
    },
    queriedAt: '2026-01-01T00:05:00Z',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('computeNextAction', () => {
  const emptyFeed = makeHookFeed();

  // 1. No active run
  it('returns info when no run model exists', () => {
    const result = computeNextAction(null, emptyFeed);
    expect(result.priority).toBe('info');
    expect(result.action).toBe('No active run found');
    expect(result.command).toContain('auto run');
  });

  // 2a. Run stopped
  it('returns info when run is stopped', () => {
    const model = makeRunModel({ overview: makeOverview({ status: 'stopped' }) });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('info');
    expect(result.action).toContain('stopped');
    expect(result.command).toBeNull();
  });

  // 2b. Run failed
  it('returns normal when run has failed', () => {
    const model = makeRunModel({
      overview: makeOverview({ status: 'failed', failedCount: 2 }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('normal');
    expect(result.action).toContain('failed');
    expect(result.reason).toContain('2 failed packet(s)');
  });

  // 2c. Run complete
  it('returns info when run is complete', () => {
    const model = makeRunModel({
      overview: makeOverview({ status: 'complete', mergedCount: 4, totalPackets: 4 }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('info');
    expect(result.action).toContain('complete');
    expect(result.command).toBeNull();
    expect(result.reason).toContain('4/4');
  });

  // 3. Pending hook approval
  it('returns critical for pending hook approval', () => {
    const hookEvent = makeHookEvent({
      id: 'hk-100',
      action: 'auto_verify',
      entityId: 'pkt-042',
      operatorDecision: 'pending',
    });
    const feed = makeHookFeed([hookEvent]);
    const model = makeRunModel();
    const result = computeNextAction(model, feed);
    expect(result.priority).toBe('critical');
    expect(result.action).toContain('auto_verify');
    expect(result.action).toContain('pkt-042');
    expect(result.command).toContain('hk-100');
    expect(result.command).toContain('--resolution confirmed');
  });

  // 4. Merge gate pending
  it('returns critical for merge gate pending', () => {
    const model = makeRunModel({
      overview: makeOverview({
        status: 'paused',
        pauseGateType: 'merge_approval',
        featureId: 'feat-xyz',
      }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('critical');
    expect(result.action).toContain('merge gate');
    expect(result.action).toContain('feat-xyz');
    expect(result.command).toContain('merge_approval');
  });

  // 5. Feature approval pending
  it('returns critical for feature approval pending', () => {
    const model = makeRunModel({
      overview: makeOverview({
        status: 'paused',
        pauseGateType: 'feature_approval',
        featureId: 'feat-abc',
      }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('critical');
    expect(result.action).toContain('feature gate');
    expect(result.action).toContain('feat-abc');
    expect(result.command).toContain('feature_approval');
  });

  // 6. Workers running
  it('returns info/wait when workers are actively running', () => {
    const model = makeRunModel({
      workers: [
        makeWorker({ workerId: 'w-1', packetId: 'pkt-a', wave: 2, status: 'running' }),
        makeWorker({ workerId: 'w-2', packetId: 'pkt-b', wave: 2, status: 'running' }),
      ],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('info');
    expect(result.action).toContain('2 worker(s) running');
    expect(result.action).toContain('wave 2');
    expect(result.command).toBeNull();
    expect(result.reason).toContain('pkt-a');
    expect(result.reason).toContain('pkt-b');
  });

  // 7. Packets blocked
  it('returns normal when packets are blocked', () => {
    const model = makeRunModel({
      overview: makeOverview({ blockedCount: 2 }),
      packets: [
        makePacket({ packetId: 'pkt-b1', status: 'blocked' }),
        makePacket({ packetId: 'pkt-b2', status: 'blocked' }),
      ],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('normal');
    expect(result.action).toContain('2 packet(s) blocked');
    expect(result.command).toContain('status feature');
  });

  // 8. Packets ready to claim
  it('returns normal when claimable packets exist', () => {
    const model = makeRunModel({
      packets: [
        makePacket({ packetId: 'pkt-r1', status: 'ready', owner: null }),
        makePacket({ packetId: 'pkt-r2', status: 'ready', owner: null }),
      ],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('normal');
    expect(result.action).toContain('2 packet(s) ready to claim');
    expect(result.command).toContain('auto run');
  });

  // 9. Run paused for other reason
  it('returns normal when run is paused for non-gate reason', () => {
    const model = makeRunModel({
      overview: makeOverview({
        status: 'paused',
        pauseReason: 'operator requested pause',
        pauseGateType: null,
      }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('normal');
    expect(result.action).toContain('paused');
    expect(result.action).toContain('operator requested pause');
    expect(result.command).toContain('resume');
  });

  // 10. Default unknown state
  it('returns info for default/unknown state', () => {
    const model = makeRunModel({
      overview: makeOverview({ status: 'initializing' }),
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('info');
    expect(result.action).toBe('Review run status');
    expect(result.command).toContain('auto status');
  });

  // 11. Multiple pending approvals — shows oldest
  it('selects the oldest pending hook when multiple exist', () => {
    const older = makeHookEvent({
      id: 'hk-old',
      timestamp: '2026-01-01T00:01:00Z',
      action: 'retry_packet',
      entityId: 'pkt-old',
      operatorDecision: 'pending',
    });
    const newer = makeHookEvent({
      id: 'hk-new',
      timestamp: '2026-01-01T00:03:00Z',
      action: 'escalate',
      entityId: 'pkt-new',
      operatorDecision: 'pending',
    });
    const feed = makeHookFeed([newer, older]); // deliberately out of order
    const model = makeRunModel();
    const result = computeNextAction(model, feed);
    expect(result.command).toContain('hk-old');
    expect(result.action).toContain('retry_packet');
    expect(result.action).toContain('pkt-old');
  });

  // 12. Priority ordering: hook approval beats merge gate
  it('hook approval takes priority over merge gate', () => {
    const model = makeRunModel({
      overview: makeOverview({
        status: 'paused',
        pauseGateType: 'merge_approval',
      }),
    });
    const hookEvent = makeHookEvent({
      id: 'hk-pri',
      action: 'block_merge',
      entityId: 'pkt-pri',
      operatorDecision: 'pending',
    });
    const feed = makeHookFeed([hookEvent]);
    const result = computeNextAction(model, feed);
    expect(result.priority).toBe('critical');
    expect(result.command).toContain('hooks resolve');
    // Must not be the merge gate command
    expect(result.command).not.toContain('merge_approval');
  });

  // 13. Priority ordering: merge gate beats workers running
  it('merge gate takes priority over running workers', () => {
    const model = makeRunModel({
      overview: makeOverview({
        status: 'paused',
        pauseGateType: 'merge_approval',
        featureId: 'feat-mg',
      }),
      workers: [
        makeWorker({ status: 'running' }),
      ],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.priority).toBe('critical');
    expect(result.action).toContain('merge gate');
  });

  // Edge: ready packets with unresolved hard deps are NOT claimable
  it('does not count ready packets with unresolved hard deps as claimable', () => {
    const depPacket = makePacket({ packetId: 'pkt-dep', status: 'in_progress' });
    const readyPacket = makePacket({
      packetId: 'pkt-wait',
      status: 'ready',
      owner: null,
      dependencies: [{ packetId: 'pkt-dep', type: 'hard', status: 'in_progress' }],
    });
    const model = makeRunModel({
      packets: [depPacket, readyPacket],
    });
    const result = computeNextAction(model, emptyFeed);
    // Should NOT match rule 8 (ready to claim), should fall through to default
    expect(result.action).not.toContain('ready to claim');
  });

  // Edge: ready packets with resolved hard deps ARE claimable
  it('counts ready packets with resolved hard deps as claimable', () => {
    const depPacket = makePacket({ packetId: 'pkt-dep', status: 'merged' });
    const readyPacket = makePacket({
      packetId: 'pkt-go',
      status: 'ready',
      owner: null,
      dependencies: [{ packetId: 'pkt-dep', type: 'hard', status: 'merged' }],
    });
    const model = makeRunModel({
      packets: [depPacket, readyPacket],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.action).toContain('1 packet(s) ready to claim');
  });

  // Edge: owned ready packets are NOT claimable
  it('does not count owned ready packets as claimable', () => {
    const ownedPacket = makePacket({
      packetId: 'pkt-owned',
      status: 'ready',
      owner: 'worker-5',
    });
    const model = makeRunModel({
      packets: [ownedPacket],
    });
    const result = computeNextAction(model, emptyFeed);
    expect(result.action).not.toContain('ready to claim');
  });

  // Edge: hook events with null action are skipped
  it('skips hook events with null action', () => {
    const nullActionHook = makeHookEvent({
      id: 'hk-null',
      action: null,
      operatorDecision: 'pending',
    });
    const feed = makeHookFeed([nullActionHook]);
    const model = makeRunModel();
    const result = computeNextAction(model, feed);
    // Should not match rule 3 since action is null
    expect(result.action).not.toContain('Resolve hook decision');
  });
});
