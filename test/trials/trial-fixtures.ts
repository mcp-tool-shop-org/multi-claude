/**
 * Trial Fixtures — Phase 10C
 *
 * Realistic run models for each trial profile, matching the actual
 * RunModel / HookFeedResult / AuditEntry shapes from the codebase.
 */

import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from '../../src/console/run-model.js';
import type { HookFeedResult, HookFeedEvent } from '../../src/console/hook-feed.js';
import type { AuditEntry } from '../../src/types/actions.js';

// ── Shared helpers ──────────────────────────────────────────────────

function makeOverview(overrides: Partial<RunOverview> = {}): RunOverview {
  return {
    runId: 'run-trial',
    featureId: 'feat-trial',
    featureTitle: 'Trial Feature',
    status: 'complete',
    startedAt: '2026-03-19T10:00:00Z',
    completedAt: '2026-03-19T10:30:00Z',
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

function makePacket(
  packetId: string,
  title: string,
  role: string,
  wave: number,
  status: string,
  overrides: Partial<PacketNode> = {},
): PacketNode {
  return {
    packetId,
    title,
    layer: role === 'verifier' ? 'verification' : role === 'integrator' ? 'integration' : 'backend',
    role,
    status,
    wave,
    goal: title,
    owner: null,
    attemptNumber: 1,
    dependencies: [],
    dependents: [],
    ...overrides,
  };
}

function makeWorker(packetId: string, role: string, status: string): WorkerSession {
  return {
    workerId: `worker-${packetId}`,
    packetId,
    wave: 1,
    status,
    startedAt: '2026-03-19T10:02:00Z',
    completedAt: status === 'done' ? '2026-03-19T10:15:00Z' : null,
    elapsedMs: status === 'done' ? 780000 : null,
    worktreePath: null,
    branchName: null,
    attemptNumber: 1,
    error: null,
    modelName: 'claude-sonnet',
    role,
    endReason: status === 'done' ? 'success' : null,
  };
}

function makeGate(name: string, resolved: boolean = true): GateStatus {
  return {
    type: 'auto',
    scopeType: 'wave',
    scopeId: name,
    resolved,
    decision: resolved ? 'approved' : null,
    actor: resolved ? 'system' : null,
    resolvedAt: resolved ? '2026-03-19T10:20:00Z' : null,
  };
}

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
    queriedAt: '2026-03-19T10:35:00Z',
  };
}

function makeAuditEntry(
  action: string,
  targetType: string,
  targetId: string,
  success: boolean,
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    id: `audit-${action}-${targetId}`,
    timestamp: '2026-03-19T10:20:00Z',
    actor: 'operator',
    action,
    targetType,
    targetId,
    beforeState: 'unknown',
    afterState: success ? 'complete' : 'failed',
    reason: `Trial ${action}`,
    command: `multi-claude console act ${action} --target ${targetId}`,
    success,
    error: null,
    ...overrides,
  };
}

function makeRunModel(overrides: Partial<RunModel> & { overviewOverrides?: Partial<RunOverview> } = {}): RunModel {
  const { overviewOverrides, ...rest } = overrides;
  return {
    overview: makeOverview(overviewOverrides),
    packets: [],
    workers: [],
    gates: [],
    queriedAt: '2026-03-19T10:35:00Z',
    ...rest,
  };
}

// ── Trial A: Claude Guardian (Low Coupling) ─────────────────────────

export function trialA_CleanRun(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const packets = [
    makePacket('guardian--builder-core-logger', 'Core logger abstraction', 'builder', 1, 'merged'),
    makePacket('guardian--builder-cli-wiring', 'CLI handler wiring', 'builder', 1, 'merged'),
    makePacket('guardian--builder-daemon-integration', 'Daemon + watch integration', 'builder', 2, 'merged'),
    makePacket('guardian--builder-mcp-budget', 'MCP server + budget integration', 'builder', 2, 'merged'),
    makePacket('guardian--verifier-checklist', 'Verification checklist', 'verifier', 3, 'merged'),
  ];

  const model = makeRunModel({
    overviewOverrides: {
      runId: 'run-10c-a',
      featureId: 'feat-guardian-logging',
      featureTitle: 'Enhanced Logging & Observability',
      status: 'complete',
      totalPackets: 5,
      totalWaves: 3,
      currentWave: 3,
      packetsByStatus: { merged: 5 },
      mergedCount: 5,
    },
    packets,
    workers: packets.map(p => makeWorker(p.packetId, p.role, 'done')),
    gates: [
      makeGate('wave-1-complete'),
      makeGate('wave-2-complete'),
      makeGate('verification-complete'),
    ],
  });

  return { model, hooks: emptyHookFeed(), audit: [] };
}

// ── Trial B: StudioFlow (Medium Coupling) ───────────────────────────

export function trialB_MediumCoupling(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const packets = [
    makePacket('sf7--builder-domain-types', 'Domain gradient/stroke types', 'builder', 1, 'merged'),
    makePacket('sf7--builder-state-commands', 'State commands + mutations', 'builder', 1, 'merged'),
    makePacket('sf7--builder-canvas-render', 'Canvas rendering', 'builder', 2, 'merged', { attemptNumber: 2 }),
    makePacket('sf7--builder-inspector-ui', 'Inspector UI controls', 'builder', 2, 'merged'),
    makePacket('sf7--verifier-checklist', 'Verification checklist', 'verifier', 3, 'merged'),
    makePacket('sf7--integrator-merge', 'Integration + barrel exports', 'integrator', 3, 'merged'),
  ];

  const model = makeRunModel({
    overviewOverrides: {
      runId: 'run-10c-b',
      featureId: 'feat-sf-gradient-stroke',
      featureTitle: 'Gradient + Stroke Styling',
      status: 'complete',
      totalPackets: 6,
      totalWaves: 3,
      currentWave: 3,
      packetsByStatus: { merged: 6 },
      mergedCount: 6,
    },
    packets,
    workers: packets.map(p => makeWorker(p.packetId, p.role, 'done')),
    gates: [
      makeGate('wave-1-complete'),
      makeGate('wave-2-complete'),
      makeGate('integration-gate'),
    ],
  });

  // Canvas render packet was retried
  const audit: AuditEntry[] = [
    makeAuditEntry('retry_packet', 'packet', 'sf7--builder-canvas-render', true, {
      timestamp: '2026-03-19T10:12:00Z',
      beforeState: 'failed',
      afterState: 'ready',
      reason: 'Canvas gradient rendering failed on SVG path API mismatch — retry with corrected prompt',
    }),
  ];

  return { model, hooks: emptyHookFeed(), audit };
}

export function trialB_WithRecovery(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const base = trialB_MediumCoupling();

  base.audit.push(
    makeAuditEntry('approve_gate', 'gate', 'gate-integration-gate', true, {
      timestamp: '2026-03-19T10:22:00Z',
      beforeState: 'pending',
      afterState: 'passed',
      reason: 'Reviewed CSS merge — workspace.css conflicts resolved manually',
    }),
  );

  return base;
}

// ── Trial C: Claude RPG (High Coupling) ─────────────────────────────

export function trialC_HighCoupling(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const packets = [
    makePacket('rpg--builder-chronicle-schema', 'Chronicle schema extension', 'builder', 1, 'merged'),
    makePacket('rpg--builder-profile-milestones', 'Profile milestone wiring', 'builder', 1, 'merged'),
    makePacket('rpg--builder-dialogue-context', 'Dialogue context enrichment', 'builder', 2, 'merged', { attemptNumber: 2 }),
    makePacket('rpg--builder-immersion-hooks', 'Immersion runtime hooks', 'builder', 2, 'merged'),
    makePacket('rpg--builder-director-render', 'Director mode rendering', 'builder', 2, 'failed'),
    makePacket('rpg--builder-session-serial', 'Session serialization', 'builder', 3, 'merged'),
    makePacket('rpg--builder-turn-loop', 'Turn loop integration', 'builder', 3, 'merged', { attemptNumber: 2 }),
    makePacket('rpg--verifier-full', 'Full verification', 'verifier', 4, 'merged'),
  ];

  const model = makeRunModel({
    overviewOverrides: {
      runId: 'run-10c-c',
      featureId: 'feat-rpg-relic-companions',
      featureTitle: 'Equipment Relic Companion Bonuses',
      status: 'complete',
      totalPackets: 8,
      totalWaves: 4,
      currentWave: 4,
      packetsByStatus: { merged: 7, failed: 1 },
      mergedCount: 7,
      failedCount: 1,
    },
    packets,
    workers: packets.map(p => makeWorker(p.packetId, p.role, 'done')),
    gates: [
      makeGate('wave-1-complete'),
      makeGate('wave-2-complete'),
      makeGate('wave-3-gate', false), // pending gate
    ],
  });

  const audit: AuditEntry[] = [
    makeAuditEntry('retry_packet', 'packet', 'rpg--builder-dialogue-context', true, {
      timestamp: '2026-03-19T10:08:00Z',
      beforeState: 'failed',
      afterState: 'ready',
      reason: 'Dialogue context tried to mutate game-state directly instead of through event system',
    }),
    makeAuditEntry('retry_packet', 'packet', 'rpg--builder-turn-loop', true, {
      timestamp: '2026-03-19T10:18:00Z',
      beforeState: 'failed',
      afterState: 'ready',
      reason: 'Turn loop integration had stale import — session schema changed in parallel packet',
    }),
    makeAuditEntry('retry_packet', 'packet', 'rpg--builder-director-render', false, {
      timestamp: '2026-03-19T10:22:00Z',
      beforeState: 'failed',
      afterState: 'failed',
      reason: 'Director render depends on consequence chain API not yet available',
      error: 'Packet retry failed — dependency not met',
    }),
  ];

  const hooks: HookFeedResult = {
    events: [{
      id: 'hf-1',
      timestamp: '2026-03-19T10:25:00Z',
      event: 'wave.claimable',
      entityId: 'wave-3',
      featureId: 'feat-rpg-relic-companions',
      ruleMatched: 'gate-on-failure',
      action: 'pause_human_gate',
      packets: [],
      mode: 'advisory',
      operatorDecision: 'pending',
      executed: false,
      reason: 'Wave 3 gate requires human approval — failed packet in wave 2',
      conditions: null,
    }],
    summary: {
      totalDecisions: 1,
      pendingApprovals: 1,
      autoExecuted: 0,
      confirmedByOperator: 0,
      rejectedByOperator: 0,
      byEvent: { 'wave.claimable': 1 },
      byAction: { pause_human_gate: 1 },
      byRule: { 'gate-on-failure': 1 },
    },
    queriedAt: '2026-03-19T10:35:00Z',
  };

  return { model, hooks, audit };
}

export function trialC_PartialSuccess(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const base = trialC_HighCoupling();
  // Close the pending gate, resolve hooks
  base.model.gates[2] = makeGate('wave-3-gate', true);
  base.hooks = emptyHookFeed();
  // Run status = failed (has a failed packet)
  base.model.overview = { ...base.model.overview, status: 'failed' };
  return base;
}

export function trialC_Stopped(): { model: RunModel; hooks: HookFeedResult; audit: AuditEntry[] } {
  const base = trialC_HighCoupling();
  base.model.overview = { ...base.model.overview, status: 'stopped' };
  base.hooks = emptyHookFeed();

  base.audit.push(
    makeAuditEntry('stop_run', 'run', 'run-10c-c', true, {
      timestamp: '2026-03-19T10:28:00Z',
      beforeState: 'running',
      afterState: 'stopped',
      reason: 'Director render packet unrecoverable — stopping to replan',
    }),
  );

  return base;
}
