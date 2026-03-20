/**
 * Run Handoff Derivation Tests — Phase 10A-203
 *
 * Tests the handoff derivation engine, rendering, and structural invariants.
 */

import { describe, it, expect } from 'vitest';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { renderHandoff } from '../../src/console/handoff-render.js';
import type { RunModel, PacketNode, RunOverview, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookFeedEvent } from '../../src/console/hook-feed.js';
import type { AuditEntry } from '../../src/types/actions.js';

// ── Test helpers ────────────────────────────────────────────────────

function makeOverview(overrides: Partial<RunOverview> = {}): RunOverview {
  return {
    runId: 'run-1',
    featureId: 'feat-1',
    featureTitle: 'Test Feature',
    status: 'complete',
    startedAt: '2026-03-19T10:00:00Z',
    completedAt: '2026-03-19T11:00:00Z',
    currentWave: 2,
    totalWaves: 2,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 3,
    packetsByStatus: { merged: 3 },
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

function makePacket(overrides: Partial<PacketNode> = {}): PacketNode {
  return {
    packetId: 'pkt-1',
    title: 'Test Packet',
    layer: 'backend',
    role: 'builder',
    status: 'merged',
    wave: 1,
    goal: 'Build the thing',
    owner: null,
    attemptNumber: 1,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeRunModel(overrides: {
  overview?: Partial<RunOverview>;
  packets?: PacketNode[];
  workers?: WorkerSession[];
  gates?: GateStatus[];
} = {}): RunModel {
  return {
    overview: makeOverview(overrides.overview),
    packets: overrides.packets ?? [
      makePacket({ packetId: 'pkt-1', title: 'Contract layer' }),
      makePacket({ packetId: 'pkt-2', title: 'Backend layer' }),
      makePacket({ packetId: 'pkt-3', title: 'Integration tests' }),
    ],
    workers: overrides.workers ?? [],
    gates: overrides.gates ?? [],
    queriedAt: '2026-03-19T11:00:01Z',
  };
}

function makeHookFeed(events: HookFeedEvent[] = []): HookFeedResult {
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
  };
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'aud-1',
    timestamp: '2026-03-19T10:30:00Z',
    actor: 'operator',
    action: 'retry_packet',
    targetType: 'packet',
    targetId: 'pkt-2',
    beforeState: 'failed',
    afterState: 'ready',
    reason: 'Retry after fix',
    command: 'multi-claude console act retry_packet --target pkt-2',
    success: true,
    error: null,
    ...overrides,
  };
}

function deriveHandoff(
  modelOverrides: Parameters<typeof makeRunModel>[0] = {},
  auditEntries: AuditEntry[] = [],
  hookFeed?: HookFeedResult,
) {
  const runModel = makeRunModel(modelOverrides);
  const hf = hookFeed ?? makeHookFeed();
  const outcome = deriveOutcomeFromModels(runModel, hf, auditEntries);
  return deriveHandoffFromModels(runModel, outcome, hf, auditEntries);
}

// ── Verdict classification ──────────────────────────────────────────

describe('Handoff verdict classification', () => {
  it('clean success → review_ready', () => {
    const handoff = deriveHandoff();
    expect(handoff.verdict).toBe('review_ready');
    expect(handoff.reviewReadiness.ready).toBe(true);
  });

  it('assisted success → review_ready_with_notes', () => {
    const handoff = deriveHandoff(
      {
        packets: [
          makePacket({ packetId: 'pkt-1', status: 'merged', attemptNumber: 2 }),
          makePacket({ packetId: 'pkt-2', status: 'merged' }),
        ],
        overview: { totalPackets: 2, packetsByStatus: { merged: 2 } },
      },
      [makeAuditEntry()],
    );
    expect(handoff.verdict).toBe('review_ready_with_notes');
    expect(handoff.reviewReadiness.ready).toBe(true);
  });

  it('partial success with failed packet → not_review_ready', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { merged: 1, failed: 1 }, failedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    expect(handoff.verdict).toBe('not_review_ready');
    expect(handoff.reviewReadiness.ready).toBe(false);
  });

  it('terminal failure → not_review_ready', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { failed: 2 }, failedCount: 2, mergedCount: 0 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'failed' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    expect(handoff.verdict).toBe('not_review_ready');
    expect(handoff.reviewReadiness.ready).toBe(false);
  });

  it('stopped run → incomplete', () => {
    const handoff = deriveHandoff({
      overview: { status: 'stopped' },
    });
    expect(handoff.verdict).toBe('incomplete');
    expect(handoff.reviewReadiness.ready).toBe(false);
  });

  it('in-progress run → incomplete', () => {
    const handoff = deriveHandoff({
      overview: { status: 'running', completedAt: null },
    });
    expect(handoff.verdict).toBe('incomplete');
    expect(handoff.reviewReadiness.ready).toBe(false);
  });

  it('acceptable but unresolved gate → blocked', () => {
    const handoff = deriveHandoff({
      gates: [{
        type: 'merge_approval',
        scopeType: 'packet',
        scopeId: 'pkt-1',
        resolved: false,
        decision: null,
        actor: null,
        resolvedAt: null,
      }],
    });
    expect(handoff.verdict).toBe('blocked');
    expect(handoff.reviewReadiness.ready).toBe(false);
  });
});

// ── Contribution summary ────────────────────────────────────────────

describe('Contribution summary', () => {
  it('maps all packets to contributions', () => {
    const handoff = deriveHandoff();
    expect(handoff.contributions.length).toBe(3);
    expect(handoff.totalContributions).toBe(3);
  });

  it('marks resolved packets as contributing to result', () => {
    const handoff = deriveHandoff();
    for (const c of handoff.contributions) {
      expect(c.contributesToResult).toBe(true);
    }
    expect(handoff.landedContributions).toBe(3);
  });

  it('marks failed packets as not contributing', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 1, packetsByStatus: { failed: 1 }, failedCount: 1, mergedCount: 0 },
      packets: [makePacket({ packetId: 'pkt-1', status: 'failed' })],
    });
    expect(handoff.contributions[0]!.contributesToResult).toBe(false);
    expect(handoff.failedContributions).toBe(1);
    expect(handoff.landedContributions).toBe(0);
  });

  it('marks retried packets as intervened when audit exists', () => {
    const handoff = deriveHandoff(
      {
        packets: [makePacket({ packetId: 'pkt-2', status: 'merged', attemptNumber: 2 })],
        overview: { totalPackets: 1, packetsByStatus: { merged: 1 } },
      },
      [makeAuditEntry({ targetId: 'pkt-2' })],
    );
    expect(handoff.contributions[0]!.hadIntervention).toBe(true);
  });

  it('reports no file-level change evidence by default', () => {
    const handoff = deriveHandoff();
    expect(handoff.hasChangeEvidence).toBe(false);
    expect(handoff.totalFilesChanged).toBe(0);
    for (const c of handoff.contributions) {
      expect(c.changedFiles).toBeNull();
    }
  });

  it('preserves packet role and layer', () => {
    const handoff = deriveHandoff({
      packets: [makePacket({ packetId: 'pkt-1', role: 'architect', layer: 'contract' })],
      overview: { totalPackets: 1, packetsByStatus: { merged: 1 } },
    });
    expect(handoff.contributions[0]!.role).toBe('architect');
    expect(handoff.contributions[0]!.layer).toBe('contract');
  });
});

// ── Outstanding issues ──────────────────────────────────────────────

describe('Outstanding issues', () => {
  it('creates issues from unresolved items', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { merged: 1, failed: 1 }, failedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    expect(handoff.outstandingIssues.length).toBeGreaterThan(0);
    expect(handoff.outstandingIssues.some(i => i.kind === 'failed_packet')).toBe(true);
  });

  it('marks failed packets as blocking review', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 1, packetsByStatus: { failed: 1 }, failedCount: 1, mergedCount: 0 },
      packets: [makePacket({ status: 'failed' })],
    });
    const blocking = handoff.outstandingIssues.filter(i => i.blocksReview);
    expect(blocking.length).toBeGreaterThan(0);
    expect(handoff.reviewBlockingIssues).toBeGreaterThan(0);
  });

  it('provides recommended actions for actionable issues', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 1, packetsByStatus: { failed: 1 }, failedCount: 1, mergedCount: 0 },
      packets: [makePacket({ status: 'failed' })],
    });
    const withAction = handoff.outstandingIssues.filter(i => i.recommendedAction !== null);
    expect(withAction.length).toBeGreaterThan(0);
    expect(withAction[0]!.recommendedAction).toContain('multi-claude');
  });

  it('empty for clean success', () => {
    const handoff = deriveHandoff();
    expect(handoff.outstandingIssues.length).toBe(0);
    expect(handoff.reviewBlockingIssues).toBe(0);
  });
});

// ── Intervention digest ─────────────────────────────────────────────

describe('Intervention digest', () => {
  it('correctly reports interventions occurred', () => {
    const handoff = deriveHandoff({}, [makeAuditEntry()]);
    expect(handoff.interventions.occurred).toBe(true);
    expect(handoff.interventions.summary.retries).toBe(1);
  });

  it('reports no interventions for automated run', () => {
    const handoff = deriveHandoff();
    expect(handoff.interventions.occurred).toBe(false);
    expect(handoff.interventions.summary.totalActions).toBe(0);
  });

  it('captures significant actions', () => {
    const handoff = deriveHandoff({}, [makeAuditEntry()]);
    expect(handoff.interventions.significantActions.length).toBe(1);
    expect(handoff.interventions.significantActions[0]!.action).toBe('retry_packet');
  });
});

// ── Follow-up recommendations ───────────────────────────────────────

describe('Follow-up recommendations', () => {
  it('includes merge suggestion for clean success', () => {
    const handoff = deriveHandoff();
    const merge = handoff.followUps.find(f => f.action === 'merge');
    expect(merge).toBeDefined();
  });

  it('includes recovery follow-ups for failed packets', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 1, packetsByStatus: { failed: 1 }, failedCount: 1, mergedCount: 0 },
      packets: [makePacket({ status: 'failed' })],
    });
    const replan = handoff.followUps.find(f => f.action === 'replan');
    expect(replan).toBeDefined();
    expect(replan!.urgency).toBe('immediate');
  });

  it('every follow-up has a reason and description', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { merged: 1, failed: 1 }, failedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    for (const fu of handoff.followUps) {
      expect(fu.reason.length).toBeGreaterThan(0);
      expect(fu.description.length).toBeGreaterThan(0);
    }
  });
});

// ── Evidence references ─────────────────────────────────────────────

describe('Evidence references', () => {
  it('always includes run outcome reference', () => {
    const handoff = deriveHandoff();
    const outcomeRef = handoff.evidenceRefs.find(r => r.kind === 'run_outcome');
    expect(outcomeRef).toBeDefined();
    expect(outcomeRef!.command).toContain('console outcome');
  });

  it('includes audit trail when interventions occurred', () => {
    const handoff = deriveHandoff({}, [makeAuditEntry()]);
    const auditRef = handoff.evidenceRefs.find(r => r.kind === 'audit_trail');
    expect(auditRef).toBeDefined();
  });

  it('no audit trail reference for clean run', () => {
    const handoff = deriveHandoff();
    const auditRef = handoff.evidenceRefs.find(r => r.kind === 'audit_trail');
    expect(auditRef).toBeUndefined();
  });
});

// ── Rendering ───────────────────────────────────────────────────────

describe('Handoff rendering', () => {
  it('renders clean success', () => {
    const handoff = deriveHandoff();
    const output = renderHandoff(handoff);
    expect(output).toContain('RUN HANDOFF');
    expect(output).toContain('REVIEW READY');
    expect(output).toContain('Verdict');
  });

  it('renders with issues and follow-ups', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { merged: 1, failed: 1 }, failedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    const output = renderHandoff(handoff);
    expect(output).toContain('Outstanding Issues');
    expect(output).toContain('Follow-ups');
    expect(output).toContain('BLOCKS REVIEW');
  });

  it('renders intervention section when interventions exist', () => {
    const handoff = deriveHandoff({}, [makeAuditEntry()]);
    const output = renderHandoff(handoff);
    expect(output).toContain('Interventions');
    expect(output).toContain('retry');
  });

  it('renders review readiness section', () => {
    const handoff = deriveHandoff();
    const output = renderHandoff(handoff);
    expect(output).toContain('Review Readiness');
  });

  it('renders evidence trail', () => {
    const handoff = deriveHandoff();
    const output = renderHandoff(handoff);
    expect(output).toContain('Evidence');
    expect(output).toContain('run_outcome');
  });

  it('JSON roundtrips cleanly', () => {
    const handoff = deriveHandoff({}, [makeAuditEntry()]);
    const json = JSON.stringify(handoff);
    const parsed = JSON.parse(json);
    expect(parsed.verdict).toBe(handoff.verdict);
    expect(parsed.contributions.length).toBe(handoff.contributions.length);
    expect(parsed.reviewReadiness.verdict).toBe(handoff.reviewReadiness.verdict);
  });
});

// ── Structure invariants ────────────────────────────────────────────

describe('Handoff structure invariants', () => {
  it('contribution counts are consistent', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 3, packetsByStatus: { merged: 1, failed: 1, blocked: 1 }, failedCount: 1, blockedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
        makePacket({ packetId: 'pkt-3', status: 'blocked' }),
      ],
    });
    expect(handoff.totalContributions).toBe(handoff.contributions.length);
    expect(handoff.landedContributions + handoff.failedContributions + handoff.recoveredContributions)
      .toBeLessThanOrEqual(handoff.totalContributions);
  });

  it('reviewBlockingIssues matches actual count', () => {
    const handoff = deriveHandoff({
      overview: { status: 'failed', totalPackets: 2, packetsByStatus: { merged: 1, failed: 1 }, failedCount: 1 },
      packets: [
        makePacket({ packetId: 'pkt-1', status: 'merged' }),
        makePacket({ packetId: 'pkt-2', status: 'failed' }),
      ],
    });
    const actual = handoff.outstandingIssues.filter(i => i.blocksReview).length;
    expect(handoff.reviewBlockingIssues).toBe(actual);
  });

  it('verdict is always a known value', async () => {
    const { HANDOFF_VERDICTS } = await import('../../src/types/handoff.js');
    const handoff = deriveHandoff();
    expect(HANDOFF_VERDICTS.has(handoff.verdict)).toBe(true);
  });

  it('summary is always non-empty', () => {
    const handoff = deriveHandoff();
    expect(handoff.summary.length).toBeGreaterThan(0);
  });

  it('attemptedGoal is always non-empty', () => {
    const handoff = deriveHandoff();
    expect(handoff.attemptedGoal.length).toBeGreaterThan(0);
    expect(handoff.attemptedGoal).toContain('Test Feature');
  });

  it('generatedAt is a valid ISO timestamp', () => {
    const handoff = deriveHandoff();
    expect(() => new Date(handoff.generatedAt)).not.toThrow();
    expect(new Date(handoff.generatedAt).toISOString()).toBeTruthy();
  });
});
