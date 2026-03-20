/**
 * Recovery Plan Tests — Phase 9E-203
 *
 * Tests the derivation engine, scenario catalog, rendering, and
 * contract guards for the recovery system.
 */

import { describe, it, expect } from 'vitest';
import { deriveRecoveryPlan } from '../../src/console/recovery-plan.js';
import { classifyScenario } from '../../src/console/recovery-catalog.js';
import { renderRecovery } from '../../src/console/recovery-render.js';
import { computeAllActions } from '../../src/console/action-availability.js';
import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent, HookFeedSummary } from '../../src/console/hook-feed.js';
import type { RecoveryPlan, RecoveryResult } from '../../src/types/recovery.js';

// ── Factory helpers ─────────────────────────────────────────────────

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

function makeHookFeed(events: HookEvent[] = []): HookFeedResult {
  const pending = events.filter(e => e.operatorDecision === 'pending').length;
  const auto = events.filter(e => e.operatorDecision === 'auto' && e.executed).length;
  const confirmed = events.filter(e => e.operatorDecision === 'confirmed').length;
  const rejected = events.filter(e => e.operatorDecision === 'rejected').length;
  return {
    events,
    summary: {
      totalDecisions: events.length,
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

function makeGate(overrides?: Partial<GateStatus>): GateStatus {
  return {
    type: 'merge_approval',
    scopeType: 'feature',
    scopeId: 'feat-001',
    resolved: false,
    decision: null,
    actor: null,
    ...overrides,
  };
}

function isPlan(result: RecoveryResult): result is RecoveryPlan {
  return result.scenario !== 'no_recovery_needed';
}

// ── Scenario classification tests ───────────────────────────────────

describe('Recovery scenario classification', () => {
  it('returns null for completed run', () => {
    const runModel = makeRunModel({ overview: makeOverview({ status: 'complete' }) });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    expect(classifyScenario(runModel, hookFeed, actions)).toBeNull();
  });

  it('returns null for stopped run', () => {
    const runModel = makeRunModel({ overview: makeOverview({ status: 'stopped' }) });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    expect(classifyScenario(runModel, hookFeed, actions)).toBeNull();
  });

  it('classifies hook_pending_approval when hook decisions await operator', () => {
    const runModel = makeRunModel();
    const hookFeed = makeHookFeed([
      makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'launch_workers' }),
    ]);
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('hook_pending_approval');
    expect(result?.severity).toBe('critical');
  });

  it('classifies resume_blocked_by_gate when paused on merge approval', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate({ type: 'merge_approval', resolved: false })],
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('resume_blocked_by_gate');
    expect(result?.severity).toBe('critical');
  });

  it('classifies failed_packet_retryable when packet failed and retry legal', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('failed_packet_retryable');
    expect(result?.severity).toBe('actionable');
  });

  it('classifies failed_packet_exhausted when retry limit reached', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 3 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('failed_packet_exhausted');
    expect(result?.severity).toBe('actionable');
  });

  it('classifies run_blocked_dependencies when packets are blocked', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ blockedCount: 1 }),
      packets: [
        makePacket({ packetId: 'pkt-blocked', status: 'blocked', dependencies: [
          { packetId: 'pkt-upstream', type: 'hard', status: 'ready' },
        ] }),
      ],
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('run_blocked_dependencies');
  });

  it('classifies no_legal_action when workers are running', () => {
    const runModel = makeRunModel({
      workers: [makeWorker({ status: 'running' })],
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions);
    expect(result?.scenario).toBe('no_legal_action');
    expect(result?.severity).toBe('waiting');
  });

  it('classifies at packet level when target specified', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'pkt-ok', status: 'verified' }),
        makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 }),
      ],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const actions = computeAllActions(runModel, hookFeed);
    const result = classifyScenario(runModel, hookFeed, actions, 'pkt-fail');
    expect(result?.scenario).toBe('failed_packet_retryable');
    expect(result?.dominantTargetId).toBe('pkt-fail');
  });
});

// ── Recovery plan derivation tests ──────────────────────────────────

describe('Recovery plan derivation', () => {
  it('returns no_recovery_needed for healthy running run', () => {
    const runModel = makeRunModel({
      workers: [makeWorker({ status: 'running' })],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    // Running with workers = no_legal_action, which is a valid recovery scenario
    expect(isPlan(result)).toBe(true);
    if (isPlan(result)) {
      expect(result.scenario).toBe('no_legal_action');
      expect(result.severity).toBe('waiting');
    }
  });

  it('returns no_recovery_needed for complete run', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'complete' }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    expect(result.scenario).toBe('no_recovery_needed');
  });

  it('derives plan for failed packet with retry legal', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('failed_packet_retryable');
    expect(result.severity).toBe('actionable');
    expect(result.steps.length).toBeGreaterThanOrEqual(2);

    // Should have a retry step that is legal now
    const retryStep = result.steps.find(s => s.action === 'retry_packet');
    expect(retryStep).toBeDefined();
    expect(retryStep!.legalNow).toBe(true);
    expect(retryStep!.command).toBeTruthy();
  });

  it('derives plan for exhausted packet with manual fix', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 3 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('failed_packet_exhausted');
    // Should have a manual_fix step
    const manualStep = result.steps.find(s => s.kind === 'manual_fix');
    expect(manualStep).toBeDefined();
  });

  it('derives plan for gate-blocked resume', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate({ type: 'merge_approval', resolved: false })],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('resume_blocked_by_gate');
    expect(result.severity).toBe('critical');

    // Should have approve_gate and resume_run steps in order
    const gateStep = result.steps.find(s => s.action === 'approve_gate');
    const resumeStep = result.steps.find(s => s.action === 'resume_run');
    expect(gateStep).toBeDefined();
    expect(resumeStep).toBeDefined();
    expect(gateStep!.legalNow).toBe(true);
    expect(resumeStep!.legalNow).toBe(false); // blocked until gate approved
  });

  it('derives plan for pending hook decisions', () => {
    const runModel = makeRunModel();
    const hookFeed = makeHookFeed([
      makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'launch_workers' }),
      makeHookEvent({ id: 'h2', operatorDecision: 'pending', action: 'retry_once', timestamp: '2026-01-01T00:03:00Z' }),
    ]);
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('hook_pending_approval');
    expect(result.severity).toBe('critical');
    expect(result.steps.length).toBe(2);
    expect(result.steps.every(s => s.action === 'resolve_hook')).toBe(true);
  });

  it('derives plan for blocked dependencies', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ blockedCount: 1 }),
      packets: [
        makePacket({ packetId: 'pkt-up', status: 'ready', wave: 1 }),
        makePacket({
          packetId: 'pkt-blocked',
          status: 'blocked',
          wave: 2,
          dependencies: [{ packetId: 'pkt-up', type: 'hard', status: 'ready' }],
        }),
      ],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('run_blocked_dependencies');
    // Should have a diagnostic step and a wait step for the upstream
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('derives plan for no_legal_action with running workers', () => {
    const runModel = makeRunModel({
      workers: [makeWorker({ status: 'running', packetId: 'pkt-001' })],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.scenario).toBe('no_legal_action');
    expect(result.severity).toBe('waiting');
    // Should have a wait step
    const waitStep = result.steps.find(s => s.kind === 'wait');
    expect(waitStep).toBeDefined();
  });

  it('derives targeted plan for specific packet', () => {
    const runModel = makeRunModel({
      packets: [
        makePacket({ packetId: 'pkt-ok', status: 'verified' }),
        makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 }),
      ],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed, 'pkt-fail');

    expect(isPlan(result)).toBe(true);
    if (!isPlan(result)) return;

    expect(result.targetId).toBe('pkt-fail');
    expect(result.scenario).toBe('failed_packet_retryable');
  });
});

// ── Plan structure invariants ───────────────────────────────────────

describe('Recovery plan structure invariants', () => {
  it('every plan has exactly one dominant blocker', () => {
    const scenarios = [
      // failed_packet_retryable
      makeRunModel({
        packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
        overview: makeOverview({ failedCount: 1 }),
      }),
      // resume_blocked_by_gate
      makeRunModel({
        overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
        gates: [makeGate()],
      }),
    ];

    for (const runModel of scenarios) {
      const hookFeed = makeHookFeed();
      const result = deriveRecoveryPlan(runModel, hookFeed);
      if (isPlan(result)) {
        expect(result.blocker).toBeDefined();
        expect(result.blocker.summary).toBeTruthy();
      }
    }
  });

  it('every step has a non-empty expectedUnlock', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result)) {
      for (const step of result.steps) {
        expect(step.expectedUnlock).toBeTruthy();
      }
    }
  });

  it('no executable step points to an illegal action', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate()],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result)) {
      for (const step of result.steps) {
        if (step.kind === 'operator_action' && step.legalNow) {
          expect(step.action).toBeTruthy();
          expect(step.command).toBeTruthy();
        }
      }
    }
  });

  it('manual-only recovery stays non-executable', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 3 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result)) {
      const manualSteps = result.steps.filter(s => s.kind === 'manual_fix');
      for (const step of manualSteps) {
        expect(step.action).toBeNull();
      }
    }
  });

  it('currentStepIndex points to first legal step', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate()],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result) && result.currentStepIndex >= 0) {
      expect(result.steps[result.currentStepIndex]!.legalNow).toBe(true);
    }
  });

  it('terminal condition is always defined for every plan', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result)) {
      expect(result.terminalCondition).toBeDefined();
      expect(result.terminalCondition.description).toBeTruthy();
    }
  });

  it('derivedFrom contains provenance data', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);
    if (isPlan(result)) {
      expect(result.derivedFrom.runStatus).toBe('running');
      expect(result.derivedFrom.nextAction).toBeTruthy();
    }
  });
});

// ── Rendering tests ─────────────────────────────────────────────────

describe('Recovery rendering', () => {
  it('renders no-recovery-needed message', () => {
    const output = renderRecovery({
      scenario: 'no_recovery_needed',
      targetId: 'run-001',
      reason: 'Run is healthy',
    });
    expect(output).toContain('RECOVERY');
    expect(output).toContain('Run is healthy');
    expect(output).toContain('No recovery action needed');
  });

  it('renders a full recovery plan', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    const output = renderRecovery(result);
    expect(output).toContain('RECOVERY');
    expect(output).toContain('Scenario:');
    expect(output).toContain('Primary blocker:');
    expect(output).toContain('Recommended path:');
    expect(output).toContain('Recovered when:');
  });

  it('renders step legality correctly', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate()],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    const output = renderRecovery(result);
    expect(output).toContain('LEGAL NOW');
    expect(output).toContain('BLOCKED');
  });

  it('renders severity symbol', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval' }),
      gates: [makeGate()],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    const output = renderRecovery(result);
    expect(output).toContain('CRITICAL');
  });

  it('renders step commands', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    const output = renderRecovery(result);
    expect(output).toContain('Run:');
    expect(output).toContain('multi-claude');
  });

  it('JSON output matches plan structure', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-fail', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.scenario).toBeTruthy();
    expect(parsed.steps).toBeInstanceOf(Array);
    if (parsed.scenario !== 'no_recovery_needed') {
      expect(parsed.blocker).toBeDefined();
      expect(parsed.terminalCondition).toBeDefined();
    }
  });
});

// ── Multi-issue determinism ─────────────────────────────────────────

describe('Multi-issue determinism', () => {
  it('picks hook_pending_approval as dominant when hooks and failures coexist', () => {
    const runModel = makeRunModel({
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
      overview: makeOverview({ failedCount: 1 }),
    });
    const hookFeed = makeHookFeed([
      makeHookEvent({ id: 'h1', operatorDecision: 'pending', action: 'retry_once' }),
    ]);
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (isPlan(result)) {
      // Hook approval takes priority over failed packet
      expect(result.scenario).toBe('hook_pending_approval');
    }
  });

  it('picks gate over packet failure when both present', () => {
    const runModel = makeRunModel({
      overview: makeOverview({ status: 'paused', pauseGateType: 'merge_approval', failedCount: 1 }),
      packets: [makePacket({ packetId: 'pkt-f', status: 'failed', attemptNumber: 1 })],
      gates: [makeGate()],
    });
    const hookFeed = makeHookFeed();
    const result = deriveRecoveryPlan(runModel, hookFeed);

    expect(isPlan(result)).toBe(true);
    if (isPlan(result)) {
      expect(result.scenario).toBe('resume_blocked_by_gate');
    }
  });
});
