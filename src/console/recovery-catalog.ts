/**
 * Recovery Catalog — Phase 9E-102
 *
 * Maps known system states to recovery scenarios. This is explicit
 * and finite — every scenario here corresponds to a real blockage
 * class observed in the control plane.
 *
 * The catalog is pure: no DB access, no side effects.
 */

import type { RunModel } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { ActionAvailability } from '../types/actions.js';
import type { RecoveryScenarioId, RecoverySeverity } from '../types/recovery.js';

// ── Scenario descriptor ─────────────────────────────────────────────

export interface ScenarioMatch {
  scenario: RecoveryScenarioId;
  severity: RecoverySeverity;
  summary: string;
  dominantTargetType: 'run' | 'packet' | 'gate' | 'hook_decision';
  dominantTargetId: string;
}

// ── Scenario detection ──────────────────────────────────────────────

/**
 * Classify the current system state into a recovery scenario.
 * Returns null if no recovery is needed (healthy or terminal).
 *
 * Priority order (first match wins):
 *   1. Hook pending approval (critical — blocks policy execution)
 *   2. Resume blocked by gate (critical — run paused on approval)
 *   3. Failed packet retryable (actionable — retry is legal)
 *   4. Failed packet exhausted (actionable — needs manual intervention)
 *   5. Resume blocked by failure (actionable — must fix packets first)
 *   6. Run blocked by dependencies (actionable — upstream packets unresolved)
 *   7. Multi-issue triage (actionable — multiple blockers, pick dominant)
 *   8. No legal action (waiting — system working or external dependency)
 */
export function classifyScenario(
  runModel: RunModel,
  hookFeed: HookFeedResult,
  actions: ActionAvailability[],
  targetId?: string,
): ScenarioMatch | null {
  const ov = runModel.overview;

  // No recovery for terminal states
  if (ov.status === 'complete' || ov.status === 'stopped') return null;

  // If targeting a specific packet, classify at packet level
  if (targetId) {
    const packetMatch = classifyPacketScenario(targetId, runModel, actions);
    if (packetMatch) return packetMatch;
  }

  // 1. Hook pending approval
  const pendingHooks = hookFeed.events.filter(
    ev => ev.operatorDecision === 'pending' && ev.action !== null,
  );
  if (pendingHooks.length > 0) {
    const oldest = pendingHooks.sort(
      (a, b) => a.timestamp.localeCompare(b.timestamp),
    )[0]!;
    return {
      scenario: 'hook_pending_approval',
      severity: 'critical',
      summary: `${pendingHooks.length} hook decision(s) awaiting operator approval`,
      dominantTargetType: 'hook_decision',
      dominantTargetId: oldest.id,
    };
  }

  // 2. Resume blocked by gate
  if (ov.status === 'paused' && (ov.pauseGateType === 'merge_approval' || ov.pauseGateType === 'feature_approval')) {
    const gateType = ov.pauseGateType;
    const unresolvedGate = runModel.gates.find(g => g.type === gateType && !g.resolved);
    return {
      scenario: 'resume_blocked_by_gate',
      severity: 'critical',
      summary: `Run paused — ${gateType.replace('_', ' ')} required before resume`,
      dominantTargetType: 'gate',
      dominantTargetId: unresolvedGate
        ? `${unresolvedGate.scopeType}:${unresolvedGate.scopeId}:${unresolvedGate.type}`
        : `feature:${ov.featureId}:${gateType}`,
    };
  }

  // 3 & 4. Failed packets
  const failedPackets = runModel.packets.filter(p => p.status === 'failed');
  if (failedPackets.length > 0) {
    const retryActions = actions.filter(
      a => a.action === 'retry_packet' && a.available,
    );
    if (retryActions.length > 0) {
      return {
        scenario: 'failed_packet_retryable',
        severity: 'actionable',
        summary: `${failedPackets.length} failed packet(s), ${retryActions.length} retryable`,
        dominantTargetType: 'packet',
        dominantTargetId: retryActions[0]!.targetId,
      };
    }
    return {
      scenario: 'failed_packet_exhausted',
      severity: 'actionable',
      summary: `${failedPackets.length} failed packet(s), retry limit reached — manual intervention needed`,
      dominantTargetType: 'packet',
      dominantTargetId: failedPackets[0]!.packetId,
    };
  }

  // 5. Resume blocked by failure (paused but no specific gate — other reason)
  if (ov.status === 'paused') {
    const resumeAction = actions.find(a => a.action === 'resume_run');
    if (resumeAction && !resumeAction.available) {
      const failedPreconditions = resumeAction.preconditions.filter(p => !p.met);
      return {
        scenario: 'resume_blocked_by_failure',
        severity: 'actionable',
        summary: `Run paused but resume is illegal: ${failedPreconditions[0]?.detail ?? 'unknown reason'}`,
        dominantTargetType: 'run',
        dominantTargetId: ov.runId,
      };
    }
  }

  // 6. Blocked packets (dependencies unresolved)
  const blockedPackets = runModel.packets.filter(p => p.status === 'blocked');
  if (blockedPackets.length > 0) {
    return {
      scenario: 'run_blocked_dependencies',
      severity: 'actionable',
      summary: `${blockedPackets.length} packet(s) blocked on unresolved dependencies`,
      dominantTargetType: 'packet',
      dominantTargetId: blockedPackets[0]!.packetId,
    };
  }

  // 7. Multi-issue: run is in a non-terminal non-healthy state with multiple issues
  const issues = countIssues(runModel, hookFeed);
  if (issues > 1) {
    return {
      scenario: 'multi_issue_triage',
      severity: 'actionable',
      summary: `${issues} concurrent issues detected — triage needed`,
      dominantTargetType: 'run',
      dominantTargetId: ov.runId,
    };
  }

  // 8. No legal action — workers running, or system waiting
  const runningWorkers = runModel.workers.filter(w => w.status === 'running');
  if (runningWorkers.length > 0 || ov.status === 'running') {
    return {
      scenario: 'no_legal_action',
      severity: 'waiting',
      summary: runningWorkers.length > 0
        ? `${runningWorkers.length} worker(s) running — wait for completion`
        : 'Run is in progress — no operator action needed',
      dominantTargetType: 'run',
      dominantTargetId: ov.runId,
    };
  }

  // If we get here with a failed status, it's a run-level failure
  if (ov.status === 'failed') {
    return {
      scenario: 'multi_issue_triage',
      severity: 'actionable',
      summary: `Run failed — review failed packets and decide on recovery`,
      dominantTargetType: 'run',
      dominantTargetId: ov.runId,
    };
  }

  // No recovery needed
  return null;
}

// ── Packet-level classification ─────────────────────────────────────

function classifyPacketScenario(
  packetId: string,
  runModel: RunModel,
  actions: ActionAvailability[],
): ScenarioMatch | null {
  const packet = runModel.packets.find(p => p.packetId === packetId);
  if (!packet) return null;

  if (packet.status === 'failed') {
    const retryAction = actions.find(
      a => a.action === 'retry_packet' && a.targetId === packetId,
    );
    if (retryAction?.available) {
      return {
        scenario: 'failed_packet_retryable',
        severity: 'actionable',
        summary: `Packet ${packetId} failed — retry is legal`,
        dominantTargetType: 'packet',
        dominantTargetId: packetId,
      };
    }
    return {
      scenario: 'failed_packet_exhausted',
      severity: 'actionable',
      summary: `Packet ${packetId} failed — retry limit reached`,
      dominantTargetType: 'packet',
      dominantTargetId: packetId,
    };
  }

  if (packet.status === 'blocked') {
    return {
      scenario: 'run_blocked_dependencies',
      severity: 'actionable',
      summary: `Packet ${packetId} blocked on unresolved dependencies`,
      dominantTargetType: 'packet',
      dominantTargetId: packetId,
    };
  }

  return null;
}

// ── Internal helpers ────────────────────────────────────────────────

function countIssues(runModel: RunModel, hookFeed: HookFeedResult): number {
  let issues = 0;
  if (runModel.packets.some(p => p.status === 'failed')) issues++;
  if (runModel.packets.some(p => p.status === 'blocked')) issues++;
  if (hookFeed.events.some(e => e.operatorDecision === 'pending' && e.action !== null)) issues++;
  if (runModel.gates.some(g => !g.resolved)) issues++;
  return issues;
}
