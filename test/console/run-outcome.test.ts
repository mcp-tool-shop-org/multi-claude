/**
 * Run Outcome Derivation Tests — Phase 9F-203
 *
 * Tests the outcome derivation engine, rendering, and
 * structural invariants for the closure system.
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { renderOutcome } from '../../src/console/outcome-render.js';
import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent } from '../../src/console/hook-feed.js';
import type { AuditEntry } from '../../src/types/actions.js';
import type { RunOutcome } from '../../src/types/outcome.js';

// ── Factory helpers ─────────────────────────────────────────────────

function makeOverview(overrides?: Partial<RunOverview>): RunOverview {
  return {
    runId: 'run-001',
    featureId: 'feat-001',
    featureTitle: 'Test Feature',
    status: 'complete',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: '2026-01-01T01:00:00Z',
    currentWave: 2,
    totalWaves: 2,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 3,
    packetsByStatus: {},
    mergedCount: 3,
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
    status: 'merged',
    wave: 1,
    goal: 'Do thing',
    owner: null,
    attemptNumber: 1,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeRunModel(overrides?: Partial<RunModel>): RunModel {
  return {
    overview: makeOverview(),
    packets: [],
    workers: [],
    gates: [],
    queriedAt: '2026-01-01T01:05:00Z',
    ...overrides,
  };
}

function makeHookEvent(overrides?: Partial<HookEvent>): HookEvent {
  return {
    id: 'hk-001',
    timestamp: '2026-01-01T00:02:00Z',
    event: 'packet.verified',
    entityId: 'pkt-001',
    featureId: 'feat-001',
    ruleMatched: null,
    action: null,
    packets: [],
    mode: 'advisory',
    operatorDecision: 'auto',
    executed: true,
    reason: null,
    conditions: null,
    ...overrides,
  };
}

function makeHookFeed(events: HookEvent[] = []): HookFeedResult {
  const pending = events.filter(e => e.operatorDecision === 'pending').length;
  return {
    events,
    summary: {
      totalDecisions: events.length,
      pendingApprovals: pending,
      autoExecuted: events.filter(e => e.operatorDecision === 'auto' && e.executed).length,
      confirmedByOperator: events.filter(e => e.operatorDecision === 'confirmed').length,
      rejectedByOperator: events.filter(e => e.operatorDecision === 'rejected').length,
      byEvent: {},
      byAction: {},
      byRule: {},
    },
    queriedAt: '2026-01-01T01:05:00Z',
  };
}

function makeAuditEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'aud-001',
    timestamp: '2026-01-01T00:30:00Z',
    actor: 'operator',
    action: 'retry_packet',
    targetType: 'packet',
    targetId: 'pkt-001',
    beforeState: 'failed',
    afterState: 'ready',
    reason: 'Retry after failure',
    command: 'multi-claude claim pkt-001',
    success: true,
    error: null,
    ...overrides,
  };
}

function makeGate(overrides?: Partial<GateStatus>): GateStatus {
  return {
    type: 'merge_approval',
    scopeType: 'feature',
    scopeId: 'feat-001',
    resolved: true,
    decision: 'approved',
    actor: 'operator',
    ...overrides,
  };
}

// ── Outcome status classification ───────────────────────────────────

describe('Outcome status classification', () => {
  it('classifies clean_success when all packets resolved, no intervention', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'verified', attemptNumber: 1 }),
      ],
      overview: makeOverview({ totalPackets: 2 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('clean_success');
    expect(outcome.acceptable).toBe(true);
  });

  it('classifies assisted_success when all resolved but operator retried', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 2 }),
        makePacket({ packetId: 'p2', status: 'merged', attemptNumber: 1 }),
      ],
      overview: makeOverview({ totalPackets: 2 }),
    });
    const audit = [makeAuditEntry({ action: 'retry_packet', targetId: 'p1' })];
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), audit);
    expect(outcome.status).toBe('assisted_success');
    expect(outcome.acceptable).toBe(true);
    expect(outcome.recoveredCount).toBe(1);
  });

  it('classifies assisted_success when all resolved but gate approved', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
      ],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const audit = [makeAuditEntry({ action: 'approve_gate', targetId: 'feat:001:merge' })];
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), audit);
    expect(outcome.status).toBe('assisted_success');
  });

  it('classifies partial_success when some packets failed in complete run', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'complete', totalPackets: 2, failedCount: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('partial_success');
    expect(outcome.acceptable).toBe(false);
  });

  it('classifies partial_success for failed run with some resolved packets', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'failed', totalPackets: 2, failedCount: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('partial_success');
  });

  it('classifies terminal_failure when all packets failed', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'failed', attemptNumber: 3 }),
        makePacket({ packetId: 'p2', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'failed', totalPackets: 2, failedCount: 2 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('terminal_failure');
    expect(outcome.acceptable).toBe(false);
  });

  it('classifies stopped when run was operator-stopped', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'ready', attemptNumber: 0 }),
      ],
      overview: makeOverview({ status: 'stopped', totalPackets: 2 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('stopped');
    expect(outcome.acceptable).toBe(false);
  });

  it('classifies in_progress for running run', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'ready', attemptNumber: 0 })],
      overview: makeOverview({ status: 'running', completedAt: null, totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('in_progress');
  });

  it('classifies in_progress for paused run', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', completedAt: null }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.status).toBe('in_progress');
  });
});

// ── Packet outcome derivation ───────────────────────────────────────

describe('Packet outcome derivation', () => {
  it('marks merged packets as resolved', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.packets[0]!.status).toBe('resolved');
  });

  it('marks retried-then-resolved packets as recovered', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 2 })],
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.packets[0]!.status).toBe('recovered');
    expect(outcome.packets[0]!.wasRetried).toBe(true);
  });

  it('marks ready packets as skipped when run is stopped', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'ready', attemptNumber: 0 })],
      overview: makeOverview({ status: 'stopped' }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.packets[0]!.status).toBe('skipped');
  });

  it('marks ready packets as pending when run is in progress', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'ready', attemptNumber: 0 })],
      overview: makeOverview({ status: 'running', completedAt: null }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.packets[0]!.status).toBe('pending');
  });
});

// ── Unresolved items ────────────────────────────────────────────────

describe('Unresolved items derivation', () => {
  it('lists failed packets', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'failed', attemptNumber: 3 })],
      overview: makeOverview({ status: 'failed' }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.unresolvedItems.some(i => i.type === 'failed_packet' && i.targetId === 'p1')).toBe(true);
  });

  it('lists pending hooks', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'running', completedAt: null }),
    });
    const hookFeed = makeHookFeed([
      makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'launch_workers' }),
    ]);
    const outcome = deriveOutcomeFromModels(runModel, hookFeed, []);
    expect(outcome.unresolvedItems.some(i => i.type === 'pending_hook')).toBe(true);
  });

  it('lists unresolved gates', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', completedAt: null }),
      gates: [makeGate({ resolved: false, decision: null, actor: null })],
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.unresolvedItems.some(i => i.type === 'unresolved_gate')).toBe(true);
  });

  it('empty for clean success', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.unresolvedItems).toHaveLength(0);
  });
});

// ── Intervention summary ────────────────────────────────────────────

describe('Intervention summary', () => {
  it('counts retries and gate approvals', () => {
    const audit = [
      makeAuditEntry({ action: 'retry_packet', targetId: 'p1' }),
      makeAuditEntry({ action: 'retry_packet', targetId: 'p2' }),
      makeAuditEntry({ action: 'approve_gate', targetId: 'g1' }),
    ];
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), audit);
    expect(outcome.interventions.retries).toBe(2);
    expect(outcome.interventions.gateApprovals).toBe(1);
    expect(outcome.interventions.totalActions).toBe(3);
  });

  it('zero interventions for automated run', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.interventions.totalActions).toBe(0);
  });
});

// ── Follow-up recommendations ───────────────────────────────────────

describe('Follow-up recommendations', () => {
  it('none for clean success', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.followUp.kind).toBe('none');
  });

  it('review for assisted success', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 2 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const audit = [makeAuditEntry({ action: 'retry_packet' })];
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), audit);
    expect(outcome.followUp.kind).toBe('review');
    expect(outcome.followUp.command).toContain('audit');
  });

  it('recover for partial success', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'complete', totalPackets: 2 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.followUp.kind).toBe('recover');
    expect(outcome.followUp.command).toContain('recover');
  });

  it('replan for terminal failure', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'failed', attemptNumber: 3 })],
      overview: makeOverview({ status: 'failed', totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.followUp.kind).toBe('replan');
  });

  it('resume for stopped run', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'ready', attemptNumber: 0 })],
      overview: makeOverview({ status: 'stopped', totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.followUp.kind).toBe('resume');
  });
});

// ── Rendering ───────────────────────────────────────────────────────

describe('Outcome rendering', () => {
  it('renders clean success', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1, title: 'Build core' })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    const output = renderOutcome(outcome);
    expect(output).toContain('RUN OUTCOME');
    expect(output).toContain('CLEAN SUCCESS');
    expect(output).toContain('Acceptable: YES');
    expect(output).toContain('Build core');
  });

  it('renders terminal failure with unresolved items', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'failed', attemptNumber: 3, title: 'Broken packet' })],
      overview: makeOverview({ status: 'failed', totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    const output = renderOutcome(outcome);
    expect(output).toContain('TERMINAL FAILURE');
    expect(output).toContain('Acceptable: NO');
    expect(output).toContain('Unresolved:');
    expect(output).toContain('failed_packet');
  });

  it('renders intervention summary', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 2 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const audit = [
      makeAuditEntry({ action: 'retry_packet' }),
      makeAuditEntry({ action: 'approve_gate' }),
    ];
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), audit);
    const output = renderOutcome(outcome);
    expect(output).toContain('Interventions:');
    expect(output).toContain('retries');
    expect(output).toContain('gate approvals');
  });

  it('renders follow-up command', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'complete', totalPackets: 2 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    const output = renderOutcome(outcome);
    expect(output).toContain('Follow-up:');
    expect(output).toContain('Run:');
  });

  it('JSON roundtrips cleanly', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    const json = JSON.stringify(outcome);
    const parsed = JSON.parse(json) as RunOutcome;
    expect(parsed.status).toBe('clean_success');
    expect(parsed.packets).toHaveLength(1);
    expect(parsed.followUp.kind).toBe('none');
  });
});

// ── Structure invariants ────────────────────────────────────────────

describe('Outcome structure invariants', () => {
  it('counts are consistent with packet array', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 }),
        makePacket({ packetId: 'p2', status: 'merged', attemptNumber: 2 }),
        makePacket({ packetId: 'p3', status: 'failed', attemptNumber: 3 }),
      ],
      overview: makeOverview({ status: 'complete', totalPackets: 3 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.resolvedCount + outcome.recoveredCount + outcome.failedCount + outcome.unresolvedCount)
      .toBe(outcome.packets.length);
  });

  it('summary is always non-empty', () => {
    const statuses = ['complete', 'failed', 'stopped', 'running'] as const;
    for (const s of statuses) {
      const runModel = makeRunModel({
        packets: [makePacket({ packetId: 'p1', status: s === 'complete' ? 'merged' : 'failed', attemptNumber: 1 })],
        overview: makeOverview({ status: s, completedAt: s === 'running' ? null : '2026-01-01T01:00:00Z' }),
      });
      const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
      expect(outcome.summary.length).toBeGreaterThan(0);
    }
  });

  it('followUp always has a title and reason', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'p1', status: 'merged', attemptNumber: 1 })],
      overview: makeOverview({ totalPackets: 1 }),
    });
    const outcome = deriveOutcomeFromModels(runModel, makeHookFeed(), []);
    expect(outcome.followUp.title).toBeTruthy();
    expect(outcome.followUp.reason).toBeTruthy();
  });
});
