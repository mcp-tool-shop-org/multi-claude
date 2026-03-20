import { describe, it, expect } from 'vitest';
import {
  renderConsole,
  renderRunOverview,
  renderPacketGraph,
  renderWorkerSessions,
  renderHooksAndGates,
  renderFitnessAndEvidence,
} from '../../src/console/render.js';
import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookEvent, HookFeedSummary } from '../../src/console/hook-feed.js';
import type { FitnessViewResult, RunFitnessView, PacketMaturation, EvidenceItem } from '../../src/console/fitness-view.js';

// ── Mock factories ──────────────────────────────────────────────────

function makeOverview(overrides: Partial<RunOverview> = {}): RunOverview {
  return {
    runId: 'run_abc123',
    featureId: 'feat_xyz',
    featureTitle: 'My Feature Title',
    status: 'running',
    startedAt: '2026-03-19T10:00:00Z',
    completedAt: null,
    currentWave: 2,
    totalWaves: 3,
    pauseReason: null,
    pauseGateType: null,
    totalPackets: 6,
    packetsByStatus: { merged: 3, in_progress: 1, blocked: 1, pending: 1 },
    mergedCount: 3,
    failedCount: 0,
    blockedCount: 1,
    inProgressCount: 1,
    workClass: 'backend_state',
    predictedFit: 'strong',
    predictedGradeRange: ['A-', 'A+'],
    ...overrides,
  };
}

function makePacketNode(overrides: Partial<PacketNode> = {}): PacketNode {
  return {
    packetId: 'pkt_001',
    title: 'Schema migration',
    layer: 'backend',
    role: 'builder',
    status: 'merged',
    wave: 1,
    goal: 'Migrate schema',
    owner: null,
    attemptNumber: 1,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeWorker(overrides: Partial<WorkerSession> = {}): WorkerSession {
  return {
    workerId: 'w_001',
    packetId: 'pkt_001',
    wave: 1,
    status: 'completed',
    startedAt: '2026-03-19T10:00:00Z',
    completedAt: '2026-03-19T10:08:12Z',
    elapsedMs: 492000,
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

function makeGate(overrides: Partial<GateStatus> = {}): GateStatus {
  return {
    type: 'feature_approval',
    scopeType: 'feature',
    scopeId: 'feat_xyz',
    resolved: true,
    decision: 'approved',
    actor: 'mike',
    resolvedAt: '2026-03-19T10:00:00Z',
    ...overrides,
  };
}

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    id: 'hd_001',
    timestamp: '2026-03-19T12:34:56Z',
    event: 'packet.verified',
    entityId: 'pkt_001',
    featureId: 'feat_xyz',
    ruleMatched: 'rule_1_auto_launch',
    action: 'launch_workers',
    packets: ['pkt_001'],
    mode: 'advisory',
    operatorDecision: 'pending',
    executed: false,
    reason: null,
    conditions: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<HookFeedSummary> = {}): HookFeedSummary {
  return {
    totalDecisions: 2,
    pendingApprovals: 1,
    autoExecuted: 1,
    confirmedByOperator: 0,
    rejectedByOperator: 0,
    byEvent: { 'packet.verified': 1, 'feature.approved': 1 },
    byAction: { launch_workers: 1, stay_single: 1 },
    byRule: { rule_1_auto_launch: 1, rule_2_stay_single: 1 },
    ...overrides,
  };
}

function makeHookFeed(overrides: Partial<HookFeedResult> = {}): HookFeedResult {
  return {
    events: [
      makeHookEvent(),
      makeHookEvent({
        id: 'hd_002',
        timestamp: '2026-03-19T12:30:12Z',
        event: 'feature.approved',
        action: 'stay_single',
        ruleMatched: 'rule_2_stay_single',
        mode: 'autonomous',
        operatorDecision: 'auto',
        executed: true,
      }),
    ],
    summary: makeSummary(),
    queriedAt: '2026-03-19T12:35:00Z',
    ...overrides,
  };
}

function makeRunScore(overrides: Partial<RunFitnessView> = {}): RunFitnessView {
  return {
    runId: 'run_abc123',
    featureId: 'feat_xyz',
    grade: 'B',
    overall: 72.5,
    quality: 28.5,
    lawfulness: 22.0,
    collaboration: 14.0,
    velocity: 8.0,
    penalties: [{ type: 'amendment', category: 'quality', description: '1 amendment', points: -2 }],
    computedAt: '2026-03-19T12:00:00Z',
    stale: false,
    ...overrides,
  };
}

function makeMaturation(overrides: Partial<PacketMaturation> = {}): PacketMaturation {
  return {
    packetId: 'pkt_001',
    layer: 'backend',
    role: 'builder',
    currentStatus: 'merged',
    maturationStage: 'integrated',
    submitScore: 10,
    verifyScore: 10,
    integrateScore: 10,
    finalScore: 30,
    penalties: 0,
    packetClass: 'state_domain',
    durationSeconds: 492,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    type: 'verification',
    entityId: 'vr_001',
    packetId: 'pkt_001',
    status: 'verified',
    summary: 'All checks passed',
    timestamp: '2026-03-19T12:00:00Z',
    details: null,
    ...overrides,
  };
}

function makeFitnessView(overrides: Partial<FitnessViewResult> = {}): FitnessViewResult {
  return {
    runScore: makeRunScore(),
    packets: [
      makeMaturation(),
      makeMaturation({ packetId: 'pkt_002', maturationStage: 'verified' }),
      makeMaturation({ packetId: 'pkt_003', maturationStage: 'submitted' }),
      makeMaturation({ packetId: 'pkt_004', maturationStage: 'none' }),
      makeMaturation({ packetId: 'pkt_005', maturationStage: 'none' }),
      makeMaturation({ packetId: 'pkt_006', maturationStage: 'integrated' }),
    ],
    evidence: [
      makeEvidence(),
      makeEvidence({
        type: 'submission',
        entityId: 'sub_001',
        packetId: 'pkt_003',
        status: 'submitted',
        summary: 'Built state machine',
        timestamp: '2026-03-19T11:55:00Z',
      }),
    ],
    maturationSummary: { none: 2, submitted: 1, verified: 1, integrated: 2 },
    queriedAt: '2026-03-19T12:35:00Z',
    ...overrides,
  };
}

function makeRunModel(overrides: Partial<RunModel> = {}): RunModel {
  return {
    overview: makeOverview(),
    packets: [
      makePacketNode({ packetId: 'pkt_001', wave: 1, status: 'merged' }),
      makePacketNode({ packetId: 'pkt_002', wave: 1, status: 'merged', title: 'API endpoints' }),
      makePacketNode({
        packetId: 'pkt_003', wave: 2, status: 'in_progress', title: 'State machine',
        layer: 'state', owner: 'auto-builder',
      }),
      makePacketNode({
        packetId: 'pkt_004', wave: 2, status: 'blocked', title: 'Dashboard view',
        layer: 'ui',
        dependencies: [{ packetId: 'pkt_003', type: 'hard', status: 'in_progress' }],
      }),
      makePacketNode({
        packetId: 'pkt_005', wave: 3, status: 'pending', title: 'Wire everything',
        layer: 'integration', role: 'integrator',
      }),
      makePacketNode({
        packetId: 'pkt_006', wave: 3, status: 'pending', title: 'Update handbook',
        layer: 'docs', role: 'knowledge',
      }),
    ],
    workers: [
      makeWorker({ packetId: 'pkt_001', status: 'completed', elapsedMs: 492000 }),
      makeWorker({
        workerId: 'w_002', packetId: 'pkt_002', status: 'completed', elapsedMs: 405000,
      }),
      makeWorker({
        workerId: 'w_003', packetId: 'pkt_003', wave: 2, status: 'running',
        elapsedMs: 323000, modelName: 'claude-sonnet-4-6',
        branchName: 'multi-claude/pkt_003',
        worktreePath: '.multi-claude/worktrees/pkt_003',
        completedAt: null,
      }),
    ],
    gates: [
      makeGate(),
      makeGate({ type: 'merge_approval', resolved: false, decision: null, actor: null }),
    ],
    queriedAt: '2026-03-19T12:35:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('renderRunOverview', () => {
  it('includes run ID and status', () => {
    const output = renderRunOverview(makeOverview(), 'Do something next');
    expect(output).toContain('run_abc123');
    expect(output).toContain('● running');
  });

  it('shows next action', () => {
    const output = renderRunOverview(makeOverview(), 'Approve merge gate for feature feat_xyz');
    expect(output).toContain('▶ Next: Approve merge gate for feature feat_xyz');
  });

  it('shows feature ID and title', () => {
    const output = renderRunOverview(makeOverview(), '');
    expect(output).toContain('feat_xyz (My Feature Title)');
  });

  it('shows wave progress', () => {
    const output = renderRunOverview(makeOverview(), '');
    expect(output).toContain('Wave:    2 / 3');
  });

  it('shows packet counts', () => {
    const output = renderRunOverview(makeOverview(), '');
    expect(output).toContain('6 total');
    expect(output).toContain('3 merged');
    expect(output).toContain('1 in-progress');
    expect(output).toContain('0 failed');
    expect(output).toContain('1 blocked');
  });

  it('shows fit prediction when available', () => {
    const output = renderRunOverview(makeOverview(), '');
    expect(output).toContain('backend_state');
    expect(output).toContain('strong');
    expect(output).toContain('[A-, A+]');
  });

  it('omits fit line when no workClass or predictedFit', () => {
    const output = renderRunOverview(
      makeOverview({ workClass: null, predictedFit: null, predictedGradeRange: null }),
      '',
    );
    expect(output).not.toContain('Fit:');
  });

  it('shows pause reason when paused', () => {
    const output = renderRunOverview(
      makeOverview({ status: 'paused', pauseReason: 'Awaiting approval' }),
      '',
    );
    expect(output).toContain('⏸ paused');
    expect(output).toContain('Paused:  Awaiting approval');
  });

  it('includes pane header', () => {
    const output = renderRunOverview(makeOverview(), '');
    expect(output).toContain('═══ RUN OVERVIEW ═══');
  });
});

describe('renderPacketGraph', () => {
  it('groups packets by wave', () => {
    const packets = [
      makePacketNode({ packetId: 'pkt_001', wave: 1 }),
      makePacketNode({ packetId: 'pkt_002', wave: 1, title: 'API endpoints' }),
      makePacketNode({ packetId: 'pkt_003', wave: 2, title: 'State machine' }),
    ];
    const output = renderPacketGraph(packets);
    expect(output).toContain('Wave 1:');
    expect(output).toContain('Wave 2:');
    // Wave 1 comes before Wave 2
    const w1 = output.indexOf('Wave 1:');
    const w2 = output.indexOf('Wave 2:');
    expect(w1).toBeLessThan(w2);
  });

  it('shows status symbols for each packet', () => {
    const packets = [
      makePacketNode({ packetId: 'pkt_001', wave: 1, status: 'merged' }),
      makePacketNode({ packetId: 'pkt_002', wave: 1, status: 'failed', title: 'Broken' }),
      makePacketNode({ packetId: 'pkt_003', wave: 2, status: 'in_progress', title: 'Active' }),
    ];
    const output = renderPacketGraph(packets);
    expect(output).toContain('✓ pkt_001');
    expect(output).toContain('✗ pkt_002');
    expect(output).toContain('● pkt_003');
  });

  it('shows blocked dependencies', () => {
    const packets = [
      makePacketNode({ packetId: 'pkt_003', wave: 2, status: 'in_progress' }),
      makePacketNode({
        packetId: 'pkt_004', wave: 2, status: 'blocked',
        dependencies: [{ packetId: 'pkt_003', type: 'hard', status: 'in_progress' }],
      }),
    ];
    const output = renderPacketGraph(packets);
    expect(output).toContain('blocked: pkt_003');
  });

  it('shows owner when claimed', () => {
    const packets = [
      makePacketNode({ packetId: 'pkt_003', wave: 2, status: 'in_progress', owner: 'auto-builder' }),
    ];
    const output = renderPacketGraph(packets);
    expect(output).toContain('claimed by auto-builder');
  });

  it('renders empty packet list gracefully', () => {
    const output = renderPacketGraph([]);
    expect(output).toContain('PACKET GRAPH');
    expect(output).toContain('(no packets)');
  });

  it('shows layer/role tag', () => {
    const packets = [
      makePacketNode({ packetId: 'pkt_005', layer: 'integration', role: 'integrator', wave: 3 }),
    ];
    const output = renderPacketGraph(packets);
    expect(output).toContain('[integration/integrator]');
  });
});

describe('renderWorkerSessions', () => {
  it('shows elapsed time formatted correctly', () => {
    const workers = [
      makeWorker({ elapsedMs: 323000, status: 'running' }), // 5m 23s
      makeWorker({ workerId: 'w_002', packetId: 'pkt_002', elapsedMs: 45000, status: 'completed' }), // 45s
    ];
    const output = renderWorkerSessions(workers);
    expect(output).toContain('5m 23s');
    expect(output).toContain('45s');
  });

  it('shows active workers first', () => {
    const workers = [
      makeWorker({ workerId: 'w_001', packetId: 'pkt_001', status: 'completed', startedAt: '2026-03-19T10:00:00Z' }),
      makeWorker({ workerId: 'w_002', packetId: 'pkt_003', status: 'running', startedAt: '2026-03-19T10:05:00Z' }),
    ];
    const output = renderWorkerSessions(workers);
    const runningIdx = output.indexOf('pkt_003');
    const completedIdx = output.indexOf('pkt_001');
    expect(runningIdx).toBeLessThan(completedIdx);
  });

  it('shows model and branch for workers that have them', () => {
    const workers = [
      makeWorker({
        status: 'running',
        modelName: 'claude-sonnet-4-6',
        branchName: 'multi-claude/pkt_001',
        worktreePath: '.multi-claude/worktrees/pkt_001',
      }),
    ];
    const output = renderWorkerSessions(workers);
    expect(output).toContain('model: claude-sonnet-4-6');
    expect(output).toContain('branch: multi-claude/pkt_001');
    expect(output).toContain('worktree: .multi-claude/worktrees/pkt_001');
  });

  it('shows error for failed workers', () => {
    const workers = [
      makeWorker({ status: 'failed', error: 'Compilation failed: missing import' }),
    ];
    const output = renderWorkerSessions(workers);
    expect(output).toContain('error: Compilation failed: missing import');
  });

  it('renders empty worker list gracefully', () => {
    const output = renderWorkerSessions([]);
    expect(output).toContain('WORKER SESSIONS');
    expect(output).toContain('(no workers)');
  });

  it('shows attempt number', () => {
    const workers = [
      makeWorker({ attemptNumber: 3, status: 'running' }),
    ];
    const output = renderWorkerSessions(workers);
    expect(output).toContain('attempt 3');
  });
});

describe('renderHooksAndGates', () => {
  it('shows pending approval count', () => {
    const hookFeed = makeHookFeed();
    const gates = [makeGate()];
    const output = renderHooksAndGates(hookFeed, gates);
    expect(output).toContain('Pending approvals: 1');
  });

  it('shows gate status with resolved and pending', () => {
    const hookFeed = makeHookFeed();
    const gates = [
      makeGate({ type: 'feature_approval', resolved: true, decision: 'approved', actor: 'mike' }),
      makeGate({ type: 'merge_approval', resolved: false, decision: null, actor: null }),
    ];
    const output = renderHooksAndGates(hookFeed, gates);
    expect(output).toContain('✓ feature_approval — approved by mike');
    expect(output).toContain('◌ merge_approval — pending');
  });

  it('shows recent hook decisions with timestamps', () => {
    const hookFeed = makeHookFeed();
    const output = renderHooksAndGates(hookFeed, []);
    expect(output).toContain('Recent decisions:');
    expect(output).toContain('packet.verified');
    expect(output).toContain('launch_workers');
    expect(output).toContain('rule_1_auto_launch');
  });

  it('shows pending events with pause symbol', () => {
    const hookFeed = makeHookFeed();
    const output = renderHooksAndGates(hookFeed, []);
    expect(output).toContain('⏸');
    expect(output).toContain('awaiting operator');
  });

  it('renders with no events gracefully', () => {
    const hookFeed = makeHookFeed({
      events: [],
      summary: makeSummary({ totalDecisions: 0, pendingApprovals: 0, autoExecuted: 0 }),
    });
    const output = renderHooksAndGates(hookFeed, []);
    expect(output).toContain('HOOKS & GATES');
    expect(output).toContain('Recent decisions: (none)');
    expect(output).toContain('Pending approvals: 0');
  });

  it('includes pane header', () => {
    const output = renderHooksAndGates(makeHookFeed(), []);
    expect(output).toContain('═══ HOOKS & GATES ═══');
  });
});

describe('renderFitnessAndEvidence', () => {
  it('shows grade and overall score', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('Grade: B (72.5/100)');
  });

  it('shows category scores', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('Quality:       28.5/40');
    expect(output).toContain('Lawfulness:    22/25');
    expect(output).toContain('Collaboration: 14/20');
    expect(output).toContain('Velocity:      8/15');
  });

  it('shows penalties', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('Penalties:');
    expect(output).toContain('-2');
    expect(output).toContain('1 amendment');
  });

  it('shows maturation summary', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('Maturation:');
    expect(output).toContain('2 integrated');
    expect(output).toContain('1 verified');
    expect(output).toContain('1 submitted');
    expect(output).toContain('2 none');
  });

  it('shows evidence items', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('Evidence (recent):');
    expect(output).toContain('[verification] pkt_001: verified');
    expect(output).toContain('All checks passed');
    expect(output).toContain('[submission] pkt_003: submitted');
    expect(output).toContain('Built state machine');
  });

  it('renders gracefully with no score', () => {
    const output = renderFitnessAndEvidence(makeFitnessView({ runScore: null }));
    expect(output).toContain('FITNESS & EVIDENCE');
    expect(output).toContain('(no score computed)');
  });

  it('renders gracefully with no evidence', () => {
    const output = renderFitnessAndEvidence(makeFitnessView({
      evidence: [],
      maturationSummary: { none: 0, submitted: 0, verified: 0, integrated: 0 },
    }));
    expect(output).toContain('FITNESS & EVIDENCE');
    expect(output).not.toContain('Evidence (recent):');
  });

  it('includes pane header', () => {
    const output = renderFitnessAndEvidence(makeFitnessView());
    expect(output).toContain('═══ FITNESS & EVIDENCE ═══');
  });
});

describe('renderConsole', () => {
  it('includes all 5 pane headers', () => {
    const output = renderConsole(
      makeRunModel(),
      makeHookFeed(),
      makeFitnessView(),
      'Approve merge gate',
    );
    expect(output).toContain('═══ RUN OVERVIEW ═══');
    expect(output).toContain('═══ PACKET GRAPH ═══');
    expect(output).toContain('═══ WORKER SESSIONS ═══');
    expect(output).toContain('═══ HOOKS & GATES ═══');
    expect(output).toContain('═══ FITNESS & EVIDENCE ═══');
  });

  it('panes appear in correct order', () => {
    const output = renderConsole(
      makeRunModel(),
      makeHookFeed(),
      makeFitnessView(),
      'Next step',
    );
    const positions = [
      output.indexOf('RUN OVERVIEW'),
      output.indexOf('PACKET GRAPH'),
      output.indexOf('WORKER SESSIONS'),
      output.indexOf('HOOKS & GATES'),
      output.indexOf('FITNESS & EVIDENCE'),
    ];
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('includes next action in output', () => {
    const output = renderConsole(
      makeRunModel(),
      makeHookFeed(),
      makeFitnessView(),
      'Approve merge gate for feature feat_xyz',
    );
    expect(output).toContain('▶ Next: Approve merge gate for feature feat_xyz');
  });
});

describe('empty data — no crashes', () => {
  it('renders with all-empty data', () => {
    const emptyOverview = makeOverview({
      runId: 'run_empty',
      featureId: 'feat_empty',
      featureTitle: '',
      status: 'pending',
      totalPackets: 0,
      packetsByStatus: {},
      mergedCount: 0,
      failedCount: 0,
      blockedCount: 0,
      inProgressCount: 0,
      workClass: null,
      predictedFit: null,
      predictedGradeRange: null,
    });

    const emptyRunModel: RunModel = {
      overview: emptyOverview,
      packets: [],
      workers: [],
      gates: [],
      queriedAt: '2026-03-19T12:35:00Z',
    };

    const emptyHookFeed: HookFeedResult = {
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
      queriedAt: '2026-03-19T12:35:00Z',
    };

    const emptyFitness: FitnessViewResult = {
      runScore: null,
      packets: [],
      evidence: [],
      maturationSummary: { none: 0, submitted: 0, verified: 0, integrated: 0 },
      queriedAt: '2026-03-19T12:35:00Z',
    };

    const output = renderConsole(emptyRunModel, emptyHookFeed, emptyFitness, '');
    expect(output).toContain('RUN OVERVIEW');
    expect(output).toContain('PACKET GRAPH');
    expect(output).toContain('(no packets)');
    expect(output).toContain('(no workers)');
    expect(output).toContain('(no score computed)');
    expect(typeof output).toBe('string');
  });
});
