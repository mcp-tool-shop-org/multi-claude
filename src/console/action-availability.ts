/**
 * Action Availability — determines which operator actions are legal for a
 * given run state, with explicit preconditions and refusal reasons.
 *
 * Pure-function module: no DB access, no side effects.
 */

import type { RunModel } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { Precondition, ActionAvailability } from '../types/actions.js';
import { MAX_RETRIES } from '../hooks/policy.js';

/** Re-export for backward compatibility */
export type { Precondition, ActionAvailability } from '../types/actions.js';

// ── Individual action computers ─────────────────────────────────────

function computeStopRun(runModel: RunModel): ActionAvailability {
  const preconditions: Precondition[] = [];
  const runId = runModel.overview.runId;
  const status = runModel.overview.status;

  preconditions.push({
    check: 'Run exists',
    met: true,
    detail: `Run ${runId}`,
  });

  const isStoppable = status === 'running' || status === 'paused';
  preconditions.push({
    check: 'Run is in a stoppable state (running or paused)',
    met: isStoppable,
    detail: isStoppable
      ? `Run status is '${status}'`
      : `Run is already in terminal state '${status}'`,
  });

  const available = preconditions.every(p => p.met);
  return {
    action: 'stop_run',
    available,
    reason: available
      ? `Run ${runId} can be stopped (status: ${status})`
      : `Cannot stop run: ${preconditions.find(p => !p.met)!.detail}`,
    command: available ? `multi-claude auto stop --run ${runId}` : null,
    preconditions,
    targetId: runId,
    targetType: 'run',
  };
}

function computeRetryPacket(
  packetId: string,
  runModel: RunModel,
): ActionAvailability {
  const preconditions: Precondition[] = [];
  const packet = runModel.packets.find(p => p.packetId === packetId);

  const exists = !!packet;
  preconditions.push({
    check: 'Packet exists and belongs to this run',
    met: exists,
    detail: exists
      ? `Packet ${packetId} found`
      : `Packet ${packetId} not found in run`,
  });

  if (!exists) {
    return {
      action: 'retry_packet',
      available: false,
      reason: `Packet ${packetId} not found in run`,
      command: null,
      preconditions,
      targetId: packetId,
      targetType: 'packet',
    };
  }

  const isFailed = packet.status === 'failed';
  preconditions.push({
    check: 'Packet status is failed',
    met: isFailed,
    detail: isFailed
      ? `Packet status is 'failed'`
      : `Packet status is '${packet.status}', not 'failed'`,
  });

  const underLimit = packet.attemptNumber < MAX_RETRIES;
  preconditions.push({
    check: `Retry count is below limit (${MAX_RETRIES})`,
    met: underLimit,
    detail: underLimit
      ? `Attempt ${packet.attemptNumber} of ${MAX_RETRIES} — retries remaining`
      : `Attempt ${packet.attemptNumber} of ${MAX_RETRIES} — retry limit reached`,
  });

  const available = preconditions.every(p => p.met);
  return {
    action: 'retry_packet',
    available,
    reason: available
      ? `Packet ${packetId} can be retried (attempt ${packet.attemptNumber} of ${MAX_RETRIES})`
      : `Cannot retry packet: ${preconditions.find(p => !p.met)!.detail}`,
    command: available
      ? `multi-claude claim ${packetId} --actor operator --session retry-${packetId}`
      : null,
    preconditions,
    targetId: packetId,
    targetType: 'packet',
  };
}

function computeResumeRun(runModel: RunModel): ActionAvailability {
  const preconditions: Precondition[] = [];
  const runId = runModel.overview.runId;
  const status = runModel.overview.status;
  const pauseGateType = runModel.overview.pauseGateType;

  const isPaused = status === 'paused';
  preconditions.push({
    check: 'Run is paused',
    met: isPaused,
    detail: isPaused
      ? `Run status is 'paused'`
      : `Run is '${status}', not 'paused'`,
  });

  // Gate-specific checks when paused
  if (isPaused && pauseGateType) {
    if (pauseGateType === 'merge_approval') {
      const mergeGate = runModel.gates.find(g => g.type === 'merge_approval' && g.resolved);
      const gateResolved = !!mergeGate;
      preconditions.push({
        check: 'Merge approval gate is resolved',
        met: gateResolved,
        detail: gateResolved
          ? `Merge approval resolved by ${mergeGate!.actor}`
          : 'Merge approval gate is unresolved — approve before resuming',
      });
    } else if (pauseGateType === 'feature_approval') {
      const featureGate = runModel.gates.find(g => g.type === 'feature_approval' && g.resolved);
      const gateResolved = !!featureGate;
      preconditions.push({
        check: 'Feature approval gate is resolved',
        met: gateResolved,
        detail: gateResolved
          ? `Feature approval resolved by ${featureGate!.actor}`
          : 'Feature approval gate is unresolved — approve before resuming',
      });
    }
    // Generic pause: no additional gate checks
  }

  const available = preconditions.every(p => p.met);
  return {
    action: 'resume_run',
    available,
    reason: available
      ? `Run ${runId} can be resumed`
      : `Cannot resume run: ${preconditions.find(p => !p.met)!.detail}`,
    command: available ? `multi-claude auto resume --run ${runId}` : null,
    preconditions,
    targetId: runId,
    targetType: 'run',
  };
}

function computeApproveGate(
  gate: { type: string; scopeType: string; scopeId: string; resolved: boolean; decision: string | null; actor: string | null },
): ActionAvailability {
  const preconditions: Precondition[] = [];
  const gateId = `${gate.scopeType}:${gate.scopeId}:${gate.type}`;

  preconditions.push({
    check: 'Gate exists',
    met: true,
    detail: `Gate ${gate.type} for ${gate.scopeType} ${gate.scopeId}`,
  });

  const notResolved = !gate.resolved;
  preconditions.push({
    check: 'Gate is not already resolved',
    met: notResolved,
    detail: notResolved
      ? `Gate is pending — awaiting approval`
      : `Gate already resolved: ${gate.decision} by ${gate.actor}`,
  });

  const available = preconditions.every(p => p.met);
  return {
    action: 'approve_gate',
    available,
    reason: available
      ? `Gate ${gate.type} can be approved`
      : `Cannot approve gate: ${preconditions.find(p => !p.met)!.detail}`,
    command: available
      ? `multi-claude approve --scope-type ${gate.scopeType} --scope-id ${gate.scopeId} --type ${gate.type} --actor operator`
      : null,
    preconditions,
    targetId: gateId,
    targetType: 'gate',
  };
}

function computeResolveHook(
  hookEvent: { id: string; operatorDecision: string; action: string | null },
): ActionAvailability {
  const preconditions: Precondition[] = [];
  const decisionId = hookEvent.id;

  preconditions.push({
    check: 'Hook decision exists',
    met: true,
    detail: `Decision ${decisionId}`,
  });

  const isPending = hookEvent.operatorDecision === 'pending';
  preconditions.push({
    check: 'Hook decision is pending',
    met: isPending,
    detail: isPending
      ? `Decision is pending — awaiting operator resolution`
      : `Decision already resolved: ${hookEvent.operatorDecision}`,
  });

  const hasAction = hookEvent.action !== null;
  preconditions.push({
    check: 'Hook decision has a proposed action',
    met: hasAction,
    detail: hasAction
      ? `Proposed action: ${hookEvent.action}`
      : 'No action proposed — nothing to resolve',
  });

  const available = preconditions.every(p => p.met);
  return {
    action: 'resolve_hook',
    available,
    reason: available
      ? `Hook decision ${decisionId} can be resolved`
      : `Cannot resolve hook: ${preconditions.find(p => !p.met)!.detail}`,
    command: available
      ? `multi-claude hooks resolve --decision ${decisionId} --resolution confirmed`
      : null,
    preconditions,
    targetId: decisionId,
    targetType: 'hook_decision',
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Compute availability for ALL actions in the current run state.
 * Returns available actions first, then unavailable.
 */
export function computeAllActions(
  runModel: RunModel,
  hookFeed: HookFeedResult,
): ActionAvailability[] {
  const actions: ActionAvailability[] = [];

  // 1. stop_run — one entry for the run
  actions.push(computeStopRun(runModel));

  // 2. retry_packet — one entry per failed packet (or all packets to surface refusal)
  const failedPackets = runModel.packets.filter(p => p.status === 'failed');
  for (const packet of failedPackets) {
    actions.push(computeRetryPacket(packet.packetId, runModel));
  }

  // 3. resume_run — one entry for the run
  actions.push(computeResumeRun(runModel));

  // 4. approve_gate — one entry per unresolved gate
  for (const gate of runModel.gates) {
    if (!gate.resolved) {
      actions.push(computeApproveGate(gate));
    }
  }

  // 5. resolve_hook — one entry per pending hook decision
  for (const event of hookFeed.events) {
    if (event.operatorDecision === 'pending') {
      actions.push(computeResolveHook(event));
    }
  }

  // Sort: available first, then unavailable
  actions.sort((a, b) => {
    if (a.available === b.available) return 0;
    return a.available ? -1 : 1;
  });

  return actions;
}

/**
 * Compute availability for a specific action targeting a specific entity.
 */
export function computeActionAvailability(
  action: string,
  targetId: string,
  runModel: RunModel,
  hookFeed: HookFeedResult,
): ActionAvailability {
  switch (action) {
    case 'stop_run':
      return computeStopRun(runModel);

    case 'retry_packet':
      return computeRetryPacket(targetId, runModel);

    case 'resume_run':
      return computeResumeRun(runModel);

    case 'approve_gate': {
      // Parse targetId format: scopeType:scopeId:gateType
      const gate = runModel.gates.find(g => {
        const gateId = `${g.scopeType}:${g.scopeId}:${g.type}`;
        return gateId === targetId;
      });
      if (!gate) {
        return {
          action: 'approve_gate',
          available: false,
          reason: `Gate not found: ${targetId}`,
          command: null,
          preconditions: [{
            check: 'Gate exists',
            met: false,
            detail: `No gate matching ${targetId}`,
          }],
          targetId,
          targetType: 'gate',
        };
      }
      return computeApproveGate(gate);
    }

    case 'resolve_hook': {
      const hookEvent = hookFeed.events.find(e => e.id === targetId);
      if (!hookEvent) {
        return {
          action: 'resolve_hook',
          available: false,
          reason: `Hook decision not found: ${targetId}`,
          command: null,
          preconditions: [{
            check: 'Hook decision exists',
            met: false,
            detail: `No hook decision matching ${targetId}`,
          }],
          targetId,
          targetType: 'hook_decision',
        };
      }
      return computeResolveHook(hookEvent);
    }

    default:
      return {
        action,
        available: false,
        reason: `Unknown action: ${action}`,
        command: null,
        preconditions: [{
          check: 'Action is recognized',
          met: false,
          detail: `'${action}' is not a known action`,
        }],
        targetId,
        targetType: 'run',
      };
  }
}
