/**
 * Next Action — computes the single most important operator action for a run.
 * Pure function: takes pre-queried RunModel + HookFeedResult, returns NextAction.
 */

import type { RunModel, PacketNode } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { NextAction } from '../types/actions.js';
import { RESOLVED_PACKET_STATUSES } from '../types/statuses.js';

/** Re-export for backward compatibility */
export type { NextAction } from '../types/actions.js';

// ── Decision logic ─────────────────────────────────────────────────────

/**
 * Compute the next lawful action for a run.
 * Priority order (first match wins):
 *   1. Run not found (null model)
 *   2. Run stopped / failed / complete
 *   3. Pending hook approvals
 *   4. Merge gate pending
 *   5. Feature approval pending
 *   6. Workers actively running
 *   7. Packets blocked
 *   8. Packets ready but not claimed
 *   9. Run paused (other reason)
 *  10. Default / unknown
 */
export function computeNextAction(
  runModel: RunModel | null,
  hookFeed: HookFeedResult,
): NextAction {
  // 1. No active run
  if (!runModel) {
    return {
      action: 'No active run found',
      command: 'multi-claude auto run --feature <id>',
      priority: 'info',
      reason: 'No run exists in the database. Start one to begin work.',
    };
  }

  const ov = runModel.overview;

  // 2. Terminal states
  if (ov.status === 'stopped') {
    return {
      action: 'Run was stopped. Review evidence and decide whether to restart.',
      command: null,
      priority: 'info',
      reason: `Run ${ov.runId} was stopped. Inspect logs and decide on next steps.`,
    };
  }
  if (ov.status === 'failed') {
    return {
      action: 'Run failed. Check failed packets and retry or fix.',
      command: `multi-claude auto status --run ${ov.runId}`,
      priority: 'normal',
      reason: `Run ${ov.runId} failed with ${ov.failedCount} failed packet(s).`,
    };
  }
  if (ov.status === 'complete') {
    return {
      action: 'Run complete. All packets merged.',
      command: null,
      priority: 'info',
      reason: `Run ${ov.runId} finished — ${ov.mergedCount}/${ov.totalPackets} packets merged.`,
    };
  }

  // 3. Pending hook approvals (oldest first)
  const pendingHooks = hookFeed.events
    .filter(ev => ev.operatorDecision === 'pending' && ev.action !== null)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (pendingHooks.length > 0) {
    const oldest = pendingHooks[0]!;
    return {
      action: `Resolve hook decision: ${oldest.action} for ${oldest.entityId}`,
      command: `multi-claude hooks resolve --decision ${oldest.id} --resolution confirmed`,
      priority: 'critical',
      reason: `${pendingHooks.length} pending hook approval(s). Oldest: "${oldest.action}" on ${oldest.entityId} (${oldest.event}).`,
    };
  }

  // 4. Merge gate pending
  if (ov.status === 'paused' && ov.pauseGateType === 'merge_approval') {
    return {
      action: `Approve merge gate for feature ${ov.featureId}`,
      command: `multi-claude approve --scope-type feature --scope-id ${ov.featureId} --type merge_approval --actor operator`,
      priority: 'critical',
      reason: `Run ${ov.runId} is paused waiting for merge approval on feature ${ov.featureId}.`,
    };
  }

  // 5. Feature approval pending
  if (ov.status === 'paused' && ov.pauseGateType === 'feature_approval') {
    return {
      action: `Approve feature gate for feature ${ov.featureId}`,
      command: `multi-claude approve --scope-type feature --scope-id ${ov.featureId} --type feature_approval --actor operator`,
      priority: 'critical',
      reason: `Run ${ov.runId} is paused waiting for feature approval on feature ${ov.featureId}.`,
    };
  }

  // 6. Workers actively running
  const runningWorkers = runModel.workers.filter(w => w.status === 'running');
  if (runningWorkers.length > 0) {
    const waves = Array.from(new Set(runningWorkers.map(w => w.wave)));
    const waveStr = waves.sort((a, b) => a - b).join(', ');
    const packetIds = runningWorkers.map(w => w.packetId).join(', ');
    return {
      action: `Wait — ${runningWorkers.length} worker(s) running in wave ${waveStr}`,
      command: null,
      priority: 'info',
      reason: `Active packets: ${packetIds}. Let workers finish before intervening.`,
    };
  }

  // 7. Packets blocked
  const blockedPackets = runModel.packets.filter(p => p.status === 'blocked');
  if (blockedPackets.length > 0) {
    return {
      action: `${blockedPackets.length} packet(s) blocked. Check dependencies.`,
      command: `multi-claude status feature ${ov.featureId}`,
      priority: 'normal',
      reason: `Blocked: ${blockedPackets.map(p => p.packetId).join(', ')}. Investigate unresolved dependencies.`,
    };
  }

  // 8. Packets ready but not claimed
  const readyPackets = runModel.packets.filter(p => isClaimable(p, runModel.packets));
  if (readyPackets.length > 0) {
    return {
      action: `${readyPackets.length} packet(s) ready to claim`,
      command: `multi-claude auto run --feature ${ov.featureId}`,
      priority: 'normal',
      reason: `Ready: ${readyPackets.map(p => p.packetId).join(', ')}. Resume the run to claim and dispatch.`,
    };
  }

  // 9. Run paused for other reason
  if (ov.status === 'paused') {
    const pauseDesc = ov.pauseReason ?? 'unknown reason';
    return {
      action: `Run paused: ${pauseDesc}`,
      command: `multi-claude auto resume --run ${ov.runId}`,
      priority: 'normal',
      reason: `Run ${ov.runId} is paused. Reason: ${pauseDesc}.`,
    };
  }

  // 10. Default / unknown
  return {
    action: 'Review run status',
    command: `multi-claude auto status --run ${ov.runId}`,
    priority: 'info',
    reason: `Run ${ov.runId} is in state "${ov.status}" — review the dashboard for details.`,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────

/** A packet is claimable when it has status 'ready', no owner,
 *  and all hard dependencies are in a resolved state. */
function isClaimable(packet: PacketNode, allPackets: PacketNode[]): boolean {
  if (packet.status !== 'ready') return false;
  if (packet.owner !== null) return false;

  const packetMap = new Map(allPackets.map(p => [p.packetId, p]));

  for (const dep of packet.dependencies) {
    if (dep.type !== 'hard') continue;
    const depPacket = packetMap.get(dep.packetId);
    const depStatus = depPacket?.status ?? dep.status;
    if (!RESOLVED_PACKET_STATUSES.has(depStatus)) return false;
  }

  return true;
}
