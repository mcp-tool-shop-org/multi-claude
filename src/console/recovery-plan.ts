/**
 * Recovery Plan Derivation Engine — Phase 9E-103
 *
 * Consumes canonical control truth (run model, action availability,
 * hook feed, next action) and produces a RecoveryPlan.
 *
 * Key rule: Recovery plans are derived, not stored.
 * Key rule: Every step must unlock something.
 * Key rule: One dominant blocker per plan.
 */

import type { RunModel } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type {
  ActionAvailability,
  Precondition,
  NextAction,
} from '../types/actions.js';
import type {
  RecoveryPlan,
  RecoveryStep,
  RecoveryBlocker,
  RecoveryTerminalCondition,
  RecoveryResult,
} from '../types/recovery.js';
import { classifyScenario, type ScenarioMatch } from './recovery-catalog.js';
import { computeAllActions } from './action-availability.js';
import { computeNextAction } from './next-action.js';
import { MAX_RETRIES } from '../hooks/policy.js';
import { RESOLVED_PACKET_STATUSES } from '../types/statuses.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Derive a recovery plan for the current run state, or for a specific target.
 * Returns NoRecoveryNeeded if the run is healthy or terminal.
 */
export function deriveRecoveryPlan(
  runModel: RunModel,
  hookFeed: HookFeedResult,
  targetId?: string,
): RecoveryResult {
  const actions = computeAllActions(runModel, hookFeed);
  const nextAction = computeNextAction(runModel, hookFeed);
  const scenario = classifyScenario(runModel, hookFeed, actions, targetId);

  if (!scenario) {
    return {
      scenario: 'no_recovery_needed',
      targetId: targetId ?? runModel.overview.runId,
      reason: isTerminal(runModel)
        ? `Run is in terminal state: ${runModel.overview.status}`
        : 'Run is healthy — no recovery needed',
    };
  }

  return buildPlan(scenario, runModel, hookFeed, actions, nextAction);
}

// ── Plan builders by scenario ───────────────────────────────────────

function buildPlan(
  scenario: ScenarioMatch,
  runModel: RunModel,
  hookFeed: HookFeedResult,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  switch (scenario.scenario) {
    case 'failed_packet_retryable':
      return buildFailedPacketRetryable(scenario, runModel, actions, nextAction);
    case 'failed_packet_exhausted':
      return buildFailedPacketExhausted(scenario, runModel, actions, nextAction);
    case 'run_blocked_dependencies':
      return buildRunBlockedDependencies(scenario, runModel, actions, nextAction);
    case 'resume_blocked_by_gate':
      return buildResumeBlockedByGate(scenario, runModel, actions, nextAction);
    case 'resume_blocked_by_failure':
      return buildResumeBlockedByFailure(scenario, runModel, actions, nextAction);
    case 'hook_pending_approval':
      return buildHookPendingApproval(scenario, runModel, hookFeed, actions, nextAction);
    case 'no_legal_action':
      return buildNoLegalAction(scenario, runModel, nextAction);
    case 'multi_issue_triage':
      return buildMultiIssueTriage(scenario, runModel, hookFeed, actions, nextAction);
  }
}

// ── Scenario: failed_packet_retryable ───────────────────────────────

function buildFailedPacketRetryable(
  scenario: ScenarioMatch,
  runModel: RunModel,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const packetId = scenario.dominantTargetId;
  const packet = runModel.packets.find(p => p.packetId === packetId);
  const retryAction = actions.find(
    a => a.action === 'retry_packet' && a.targetId === packetId && a.available,
  );

  const steps: RecoveryStep[] = [];

  // Step 1: Diagnose (optional but honest)
  steps.push({
    id: 'diagnose',
    kind: 'diagnostic',
    title: `Review failure evidence for ${packetId}`,
    reason: 'Understand what failed before retrying',
    legalNow: true,
    action: null,
    targetType: 'packet',
    targetId: packetId,
    command: `multi-claude console packets`,
    preconditions: [],
    expectedUnlock: 'Informed retry decision',
    blockedReason: null,
  });

  // Step 2: Retry
  if (retryAction) {
    steps.push({
      id: 'retry',
      kind: 'operator_action',
      title: `Retry packet ${packetId}`,
      reason: `Attempt ${packet?.attemptNumber ?? '?'} of ${MAX_RETRIES} — retry is legal`,
      legalNow: true,
      action: 'retry_packet',
      targetType: 'packet',
      targetId: packetId,
      command: retryAction.command,
      preconditions: retryAction.preconditions,
      expectedUnlock: 'Packet returns to ready state and can be claimed by a worker',
      blockedReason: null,
    });
  }

  // Step 3: Wait for worker to complete
  steps.push({
    id: 'wait_worker',
    kind: 'wait',
    title: 'Wait for retry worker to complete',
    reason: 'After retry, a worker must claim and process the packet',
    legalNow: false,
    action: null,
    targetType: 'packet',
    targetId: packetId,
    command: null,
    preconditions: [{
      check: 'Packet has been retried',
      met: false,
      detail: 'Retry must be executed first',
    }],
    expectedUnlock: 'Packet reaches verified or failed state',
    blockedReason: 'Retry must be executed first',
  });

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `Packet ${packetId} failed, retry legal`,
    detail: `Failed packet ${packetId}`,
    failedPreconditions: [],
  }, {
    description: `Packet ${packetId} reaches a resolved state (verified, integrating, or merged)`,
    checkCommand: `multi-claude console packets`,
  });
}

// ── Scenario: failed_packet_exhausted ───────────────────────────────

function buildFailedPacketExhausted(
  scenario: ScenarioMatch,
  runModel: RunModel,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const packetId = scenario.dominantTargetId;
  const retryAction = actions.find(
    a => a.action === 'retry_packet' && a.targetId === packetId,
  );
  const failedPreconditions = retryAction?.preconditions.filter(p => !p.met) ?? [];

  const steps: RecoveryStep[] = [];

  steps.push({
    id: 'diagnose',
    kind: 'diagnostic',
    title: `Analyze repeated failure for ${packetId}`,
    reason: `Retry limit (${MAX_RETRIES}) reached — automatic retry is not available`,
    legalNow: true,
    action: null,
    targetType: 'packet',
    targetId: packetId,
    command: `multi-claude console packets`,
    preconditions: [],
    expectedUnlock: 'Understanding of root cause',
    blockedReason: null,
  });

  steps.push({
    id: 'manual_fix',
    kind: 'manual_fix',
    title: `Fix underlying issue for ${packetId}`,
    reason: 'Repeated failure suggests a structural problem that retries cannot solve',
    legalNow: true,
    action: null,
    targetType: 'packet',
    targetId: packetId,
    command: null,
    preconditions: [],
    expectedUnlock: 'Root cause resolved, packet can be manually reset or re-planned',
    blockedReason: null,
  });

  steps.push({
    id: 'stop_and_replan',
    kind: 'operator_action',
    title: 'Consider stopping the run and re-planning',
    reason: 'An exhausted packet may indicate a design problem in the packet graph',
    legalNow: actions.some(a => a.action === 'stop_run' && a.available),
    action: 'stop_run',
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: `multi-claude auto stop --run ${runModel.overview.runId}`,
    preconditions: actions.find(a => a.action === 'stop_run')?.preconditions ?? [],
    expectedUnlock: 'Clean slate for a new run with corrected packet design',
    blockedReason: actions.some(a => a.action === 'stop_run' && a.available)
      ? null
      : 'Run is not in a stoppable state',
  });

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `Packet ${packetId} exhausted all retries`,
    detail: failedPreconditions[0]?.detail ?? `Retry limit (${MAX_RETRIES}) reached`,
    failedPreconditions,
  }, {
    description: `Root cause fixed and packet ${packetId} reaches a resolved state, or run is stopped and re-planned`,
    checkCommand: `multi-claude console packets`,
  });
}

// ── Scenario: run_blocked_dependencies ──────────────────────────────

function buildRunBlockedDependencies(
  scenario: ScenarioMatch,
  runModel: RunModel,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const blockedPackets = runModel.packets.filter(p => p.status === 'blocked');
  const packetId = scenario.dominantTargetId;

  // Find the upstream blockers
  const packet = runModel.packets.find(p => p.packetId === packetId);
  const unresolvedDeps = packet?.dependencies.filter(
    d => d.type === 'hard' && !RESOLVED_PACKET_STATUSES.has(d.status),
  ) ?? [];

  const steps: RecoveryStep[] = [];

  steps.push({
    id: 'identify_blockers',
    kind: 'diagnostic',
    title: `Identify blocking dependencies for ${packetId}`,
    reason: `${unresolvedDeps.length} hard dependency/ies unresolved`,
    legalNow: true,
    action: null,
    targetType: 'packet',
    targetId: packetId,
    command: `multi-claude console packets`,
    preconditions: [],
    expectedUnlock: 'Clear picture of which upstream packets need resolution',
    blockedReason: null,
  });

  // For each unresolved dependency, add recovery guidance
  for (const dep of unresolvedDeps.slice(0, 3)) {
    const depPacket = runModel.packets.find(p => p.packetId === dep.packetId);
    if (depPacket?.status === 'failed') {
      const retryAvail = actions.find(
        a => a.action === 'retry_packet' && a.targetId === dep.packetId && a.available,
      );
      steps.push({
        id: `resolve_dep_${dep.packetId}`,
        kind: retryAvail ? 'operator_action' : 'manual_fix',
        title: `Resolve upstream packet ${dep.packetId} (status: ${depPacket.status})`,
        reason: `${packetId} is blocked until ${dep.packetId} reaches a resolved state`,
        legalNow: !!retryAvail,
        action: retryAvail ? 'retry_packet' : null,
        targetType: 'packet',
        targetId: dep.packetId,
        command: retryAvail?.command ?? null,
        preconditions: retryAvail?.preconditions ?? [],
        expectedUnlock: `Unblocks ${packetId} (and other dependents of ${dep.packetId})`,
        blockedReason: retryAvail ? null : `Packet ${dep.packetId} is ${depPacket.status}, retry not available`,
      });
    } else {
      steps.push({
        id: `wait_dep_${dep.packetId}`,
        kind: 'wait',
        title: `Wait for upstream packet ${dep.packetId} (status: ${dep.status})`,
        reason: `${packetId} is blocked until ${dep.packetId} completes`,
        legalNow: false,
        action: null,
        targetType: 'packet',
        targetId: dep.packetId,
        command: null,
        preconditions: [{
          check: `Upstream packet ${dep.packetId} is resolved`,
          met: false,
          detail: `Current status: ${dep.status}`,
        }],
        expectedUnlock: `Unblocks ${packetId}`,
        blockedReason: `Upstream packet ${dep.packetId} is not yet resolved (status: ${dep.status})`,
      });
    }
  }

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `${blockedPackets.length} packet(s) blocked on unresolved dependencies`,
    detail: `Dominant blocker: ${packetId} waiting on ${unresolvedDeps.map(d => d.packetId).join(', ')}`,
    failedPreconditions: [],
  }, {
    description: `All blocked packets unblocked — upstream dependencies reach resolved state`,
    checkCommand: `multi-claude console packets`,
  });
}

// ── Scenario: resume_blocked_by_gate ────────────────────────────────

function buildResumeBlockedByGate(
  scenario: ScenarioMatch,
  runModel: RunModel,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const gateTargetId = scenario.dominantTargetId;
  const gateType = runModel.overview.pauseGateType ?? 'unknown';
  const approveAction = actions.find(
    a => a.action === 'approve_gate' && a.available,
  );
  const resumeAction = actions.find(a => a.action === 'resume_run');

  const steps: RecoveryStep[] = [];

  // Step 1: Approve the gate
  steps.push({
    id: 'approve_gate',
    kind: 'operator_action',
    title: `Approve ${gateType.replace('_', ' ')} gate`,
    reason: `Run is paused waiting for ${gateType.replace('_', ' ')}`,
    legalNow: !!approveAction,
    action: 'approve_gate',
    targetType: 'gate',
    targetId: gateTargetId,
    command: approveAction?.command ?? null,
    preconditions: approveAction?.preconditions ?? [],
    expectedUnlock: 'Gate resolved — resume becomes legal',
    blockedReason: approveAction ? null : 'Gate approval action not available',
  });

  // Step 2: Resume the run
  steps.push({
    id: 'resume_run',
    kind: 'operator_action',
    title: `Resume run ${runModel.overview.runId}`,
    reason: 'After gate approval, the run can be resumed',
    legalNow: resumeAction?.available ?? false,
    action: 'resume_run',
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: resumeAction?.command ?? `multi-claude auto resume --run ${runModel.overview.runId}`,
    preconditions: resumeAction?.preconditions ?? [{
      check: `${gateType} gate is resolved`,
      met: false,
      detail: 'Gate must be approved first',
    }],
    expectedUnlock: 'Run continues execution from paused state',
    blockedReason: resumeAction?.available ? null : 'Gate must be approved first',
  });

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `Run paused on ${gateType.replace('_', ' ')} gate`,
    detail: `Gate ${gateTargetId} must be approved before run can resume`,
    failedPreconditions: resumeAction?.preconditions.filter(p => !p.met) ?? [],
  }, {
    description: `Gate approved and run resumed to running state`,
    checkCommand: `multi-claude console overview`,
  });
}

// ── Scenario: resume_blocked_by_failure ─────────────────────────────

function buildResumeBlockedByFailure(
  scenario: ScenarioMatch,
  runModel: RunModel,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const resumeAction = actions.find(a => a.action === 'resume_run');
  const failedPreconditions = resumeAction?.preconditions.filter(p => !p.met) ?? [];

  const steps: RecoveryStep[] = [];

  steps.push({
    id: 'diagnose_pause',
    kind: 'diagnostic',
    title: 'Diagnose why resume is illegal',
    reason: `Resume precondition(s) failed: ${failedPreconditions.map(p => p.detail).join('; ')}`,
    legalNow: true,
    action: null,
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: `multi-claude console actions`,
    preconditions: [],
    expectedUnlock: 'Understanding of what must be fixed before resume',
    blockedReason: null,
  });

  // If there are failed packets, add retry guidance
  const failedPackets = runModel.packets.filter(p => p.status === 'failed');
  for (const fp of failedPackets.slice(0, 3)) {
    const retryAvail = actions.find(
      a => a.action === 'retry_packet' && a.targetId === fp.packetId && a.available,
    );
    steps.push({
      id: `fix_${fp.packetId}`,
      kind: retryAvail ? 'operator_action' : 'manual_fix',
      title: `Resolve failed packet ${fp.packetId}`,
      reason: 'Outstanding failures may be blocking resume',
      legalNow: !!retryAvail,
      action: retryAvail ? 'retry_packet' : null,
      targetType: 'packet',
      targetId: fp.packetId,
      command: retryAvail?.command ?? null,
      preconditions: retryAvail?.preconditions ?? [],
      expectedUnlock: `Packet ${fp.packetId} resolved — may unblock resume`,
      blockedReason: retryAvail ? null : 'Retry not available for this packet',
    });
  }

  steps.push({
    id: 'resume_run',
    kind: 'operator_action',
    title: `Resume run ${runModel.overview.runId}`,
    reason: 'After resolving blocking issues, resume becomes legal',
    legalNow: false,
    action: 'resume_run',
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: `multi-claude auto resume --run ${runModel.overview.runId}`,
    preconditions: resumeAction?.preconditions ?? [],
    expectedUnlock: 'Run continues execution',
    blockedReason: failedPreconditions[0]?.detail ?? 'Resume preconditions not met',
  });

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: 'Run paused, resume blocked by outstanding issues',
    detail: failedPreconditions[0]?.detail ?? 'Resume preconditions not met',
    failedPreconditions,
  }, {
    description: `All blocking issues resolved and run resumed`,
    checkCommand: `multi-claude console overview`,
  });
}

// ── Scenario: hook_pending_approval ─────────────────────────────────

function buildHookPendingApproval(
  scenario: ScenarioMatch,
  runModel: RunModel,
  hookFeed: HookFeedResult,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const pendingHooks = hookFeed.events
    .filter(ev => ev.operatorDecision === 'pending' && ev.action !== null)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const steps: RecoveryStep[] = [];

  for (const hook of pendingHooks.slice(0, 5)) {
    const resolveAction = actions.find(
      a => a.action === 'resolve_hook' && a.targetId === hook.id && a.available,
    );
    steps.push({
      id: `resolve_${hook.id}`,
      kind: 'operator_action',
      title: `Resolve hook: ${hook.action} for ${hook.entityId}`,
      reason: `Policy decision "${hook.action}" on ${hook.event} awaiting operator approval`,
      legalNow: !!resolveAction,
      action: 'resolve_hook',
      targetType: 'hook_decision',
      targetId: hook.id,
      command: resolveAction?.command ?? `multi-claude hooks resolve --decision ${hook.id} --resolution confirmed`,
      preconditions: resolveAction?.preconditions ?? [],
      expectedUnlock: `Hook decision executed — unblocks downstream policy actions`,
      blockedReason: resolveAction ? null : 'Resolve action not available',
    });
  }

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `${pendingHooks.length} hook decision(s) awaiting approval`,
    detail: `Oldest: "${pendingHooks[0]?.action}" on ${pendingHooks[0]?.event} ${pendingHooks[0]?.entityId}`,
    failedPreconditions: [],
  }, {
    description: `All pending hook decisions resolved`,
    checkCommand: `multi-claude console hooks`,
  });
}

// ── Scenario: no_legal_action ───────────────────────────────────────

function buildNoLegalAction(
  scenario: ScenarioMatch,
  runModel: RunModel,
  nextAction: NextAction,
): RecoveryPlan {
  const runningWorkers = runModel.workers.filter(w => w.status === 'running');

  const steps: RecoveryStep[] = [];

  if (runningWorkers.length > 0) {
    steps.push({
      id: 'wait_workers',
      kind: 'wait',
      title: `Wait for ${runningWorkers.length} running worker(s)`,
      reason: 'Workers are actively processing packets',
      legalNow: false,
      action: null,
      targetType: 'run',
      targetId: runModel.overview.runId,
      command: null,
      preconditions: [{
        check: 'Workers have finished',
        met: false,
        detail: `${runningWorkers.length} worker(s) still running`,
      }],
      expectedUnlock: 'Worker results trigger next hook event and state transition',
      blockedReason: 'Workers still running',
    });
  }

  steps.push({
    id: 'monitor',
    kind: 'diagnostic',
    title: 'Monitor run progress',
    reason: 'No operator action is needed — the system is making progress',
    legalNow: true,
    action: null,
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: `multi-claude console watch`,
    preconditions: [],
    expectedUnlock: 'Early detection if something goes wrong',
    blockedReason: null,
  });

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: 'System is working — no operator action needed',
    detail: runningWorkers.length > 0
      ? `${runningWorkers.length} worker(s) running`
      : 'Run is in progress',
    failedPreconditions: [],
  }, {
    description: `Workers complete and next state transition occurs`,
    checkCommand: `multi-claude console next`,
  });
}

// ── Scenario: multi_issue_triage ────────────────────────────────────

function buildMultiIssueTriage(
  scenario: ScenarioMatch,
  runModel: RunModel,
  hookFeed: HookFeedResult,
  actions: ActionAvailability[],
  nextAction: NextAction,
): RecoveryPlan {
  const steps: RecoveryStep[] = [];

  // Step 1: Always start with a diagnostic
  steps.push({
    id: 'triage',
    kind: 'diagnostic',
    title: 'Triage run state — multiple issues detected',
    reason: 'Multiple blockers present — review to identify the dominant one',
    legalNow: true,
    action: null,
    targetType: 'run',
    targetId: runModel.overview.runId,
    command: `multi-claude console show`,
    preconditions: [],
    expectedUnlock: 'Clear understanding of which issue to address first',
    blockedReason: null,
  });

  // Add the most critical available actions
  const availableActions = actions.filter(a => a.available);

  // Hooks first (critical)
  const hookActions = availableActions.filter(a => a.action === 'resolve_hook');
  for (const ha of hookActions.slice(0, 2)) {
    steps.push({
      id: `resolve_hook_${ha.targetId}`,
      kind: 'operator_action',
      title: `Resolve hook decision ${ha.targetId}`,
      reason: 'Hook approvals block policy execution',
      legalNow: true,
      action: 'resolve_hook',
      targetType: 'hook_decision',
      targetId: ha.targetId,
      command: ha.command,
      preconditions: ha.preconditions,
      expectedUnlock: 'Unblocks downstream policy actions',
      blockedReason: null,
    });
  }

  // Then gate approvals
  const gateActions = availableActions.filter(a => a.action === 'approve_gate');
  for (const ga of gateActions.slice(0, 1)) {
    steps.push({
      id: `approve_gate_${ga.targetId}`,
      kind: 'operator_action',
      title: `Approve gate ${ga.targetId}`,
      reason: 'Unresolved gates block run progress',
      legalNow: true,
      action: 'approve_gate',
      targetType: 'gate',
      targetId: ga.targetId,
      command: ga.command,
      preconditions: ga.preconditions,
      expectedUnlock: 'Resume may become legal',
      blockedReason: null,
    });
  }

  // Then retries
  const retryActions = availableActions.filter(a => a.action === 'retry_packet');
  for (const ra of retryActions.slice(0, 2)) {
    steps.push({
      id: `retry_${ra.targetId}`,
      kind: 'operator_action',
      title: `Retry failed packet ${ra.targetId}`,
      reason: 'Failed packets may be blocking downstream progress',
      legalNow: true,
      action: 'retry_packet',
      targetType: 'packet',
      targetId: ra.targetId,
      command: ra.command,
      preconditions: ra.preconditions,
      expectedUnlock: 'Packet returns to ready state',
      blockedReason: null,
    });
  }

  // Collect all issues for the blocker summary
  const issues: string[] = [];
  const failedCount = runModel.packets.filter(p => p.status === 'failed').length;
  const blockedCount = runModel.packets.filter(p => p.status === 'blocked').length;
  const pendingHookCount = hookFeed.events.filter(e => e.operatorDecision === 'pending' && e.action !== null).length;
  const unresolvedGateCount = runModel.gates.filter(g => !g.resolved).length;
  if (failedCount > 0) issues.push(`${failedCount} failed packet(s)`);
  if (blockedCount > 0) issues.push(`${blockedCount} blocked packet(s)`);
  if (pendingHookCount > 0) issues.push(`${pendingHookCount} pending hook(s)`);
  if (unresolvedGateCount > 0) issues.push(`${unresolvedGateCount} unresolved gate(s)`);

  return assemblePlan(scenario, runModel, nextAction, steps, {
    summary: `Multiple issues: ${issues.join(', ')}`,
    detail: `${issues.length} issue categories — address available actions in priority order`,
    failedPreconditions: [],
  }, {
    description: 'All blocking issues resolved and run progressing normally',
    checkCommand: `multi-claude console show`,
  });
}

// ── Plan assembly ───────────────────────────────────────────────────

interface BlockerInput {
  summary: string;
  detail: string;
  failedPreconditions: Precondition[];
}

function assemblePlan(
  scenario: ScenarioMatch,
  runModel: RunModel,
  nextAction: NextAction,
  steps: RecoveryStep[],
  blockerInput: BlockerInput,
  terminalCondition: RecoveryTerminalCondition,
): RecoveryPlan {
  const currentStepIndex = steps.findIndex(s => s.legalNow);

  const blocker: RecoveryBlocker = {
    summary: blockerInput.summary,
    targetType: scenario.dominantTargetType === 'hook_decision'
      ? 'hook_decision'
      : scenario.dominantTargetType,
    targetId: scenario.dominantTargetId,
    failedPreconditions: blockerInput.failedPreconditions,
  };

  return {
    scenario: scenario.scenario,
    targetType: scenario.dominantTargetType === 'hook_decision' ? 'hook_decision' : scenario.dominantTargetType,
    targetId: scenario.dominantTargetId,
    summary: scenario.summary,
    severity: scenario.severity,
    blocker,
    steps,
    currentStepIndex,
    terminalCondition,
    derivedFrom: {
      runStatus: runModel.overview.status,
      nextAction: nextAction.action,
      refusalReasons: collectRefusalReasons(runModel),
      failedPreconditions: blockerInput.failedPreconditions.map(p => p.detail),
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function isTerminal(runModel: RunModel): boolean {
  return ['complete', 'stopped', 'failed'].includes(runModel.overview.status);
}

function collectRefusalReasons(runModel: RunModel): string[] {
  const reasons: string[] = [];
  if (runModel.overview.status === 'paused' && runModel.overview.pauseReason) {
    reasons.push(runModel.overview.pauseReason);
  }
  return reasons;
}
