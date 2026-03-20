/**
 * Decision Queue — Queue actions and transitions.
 *
 * Handles:
 *   - Taking actions from queue items (approve/reject/recovery)
 *   - Queue state transitions
 *   - Staleness detection and propagation
 *   - Invalidation propagation into queue state
 *
 * Law: actions on queue items must go through the brief's action binding.
 * The queue is an operational surface, not an alternate approval path.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId } from '../schema/packet.js';
import type { DecisionAction } from '../decision/types.js';
import { bindDecisionAction } from '../decision/bind-decision-action.js';
import type { QueueStore } from './queue-store.js';
import type { QueueItem, QueueItemStatus } from './types.js';
import { TERMINAL_STATUSES } from './types.js';
import { deriveQueueItem } from './derive-queue-item.js';
import { deriveDecisionBrief } from '../decision/derive-decision-brief.js';
import { nowISO } from '../../lib/ids.js';

// ── Queue action ────────────────────────────────────────────────────

export interface QueueActionInput {
  queueItemId: string;
  action: DecisionAction;
  actor: string;
  reason: string;
}

export interface QueueActionResult {
  ok: true;
  queueItemId: string;
  action: DecisionAction;
  actionId: string;
  newStatus: QueueItemStatus;
}

export interface QueueActionError {
  ok: false;
  error: string;
  code: 'item_not_found' | 'item_terminal' | 'brief_not_found' | 'action_failed' | 'item_stale';
}

/**
 * Take an action on a queue item.
 *
 * Flow:
 *   1. Load queue item
 *   2. Check not terminal/stale
 *   3. Load brief
 *   4. Bind action through decision law
 *   5. Transition queue state
 *   6. Record event
 */
export function actOnQueueItem(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
  input: QueueActionInput,
): QueueActionResult | QueueActionError {
  const item = queueStore.getQueueItem(input.queueItemId);
  if (!item) {
    return { ok: false, error: `Queue item '${input.queueItemId}' not found`, code: 'item_not_found' };
  }

  // Cannot act on terminal items
  if (TERMINAL_STATUSES.has(item.status)) {
    return { ok: false, error: `Queue item is in terminal state '${item.status}'`, code: 'item_terminal' };
  }

  // Cannot act on stale items
  if (item.status === 'stale') {
    return { ok: false, error: 'Queue item is stale — re-derive before acting', code: 'item_stale' };
  }

  // Load the brief
  const brief = queueStore.getBrief(item.briefId);
  if (!brief) {
    return { ok: false, error: `Brief '${item.briefId}' not found`, code: 'brief_not_found' };
  }

  // Bind action through decision law
  const bindResult = bindDecisionAction(handoffStore, {
    brief,
    action: input.action,
    actor: input.actor,
    reason: input.reason,
  });

  if (!bindResult.ok) {
    return { ok: false, error: bindResult.error, code: 'action_failed' };
  }

  // Determine new queue status from action
  const newStatus = actionToStatus(input.action);
  const oldStatus = item.status;

  // Update queue state
  queueStore.updateStatus(input.queueItemId, newStatus);

  // Record event
  queueStore.insertEvent({
    queueItemId: input.queueItemId,
    kind: 'action_bound',
    fromStatus: oldStatus,
    toStatus: newStatus,
    actor: input.actor,
    reason: input.reason,
    actionId: bindResult.record.actionId,
    createdAt: nowISO(),
  });

  return {
    ok: true,
    queueItemId: input.queueItemId,
    action: input.action,
    actionId: bindResult.record.actionId,
    newStatus,
  };
}

function actionToStatus(action: DecisionAction): QueueItemStatus {
  switch (action) {
    case 'approve': return 'approved';
    case 'reject': return 'rejected';
    case 'request-recovery': return 'recovery_requested';
    case 'needs-review': return 'in_review';
  }
}

// ── Staleness propagation ───────────────────────────────────────────

/**
 * Check all active queue items for staleness.
 *
 * An item becomes stale when:
 *   - Its packet version has been invalidated
 *   - A newer version exists that changes the brief materially
 *
 * Returns the number of items marked stale.
 */
export function propagateStaleness(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
): number {
  const activeItems = queueStore.listQueue({ activeOnly: true });
  let staleCount = 0;

  for (const item of activeItems) {
    if (item.status === 'stale') continue;

    const handoffId = item.handoffId as HandoffId;

    // Check if version is invalidated
    if (handoffStore.isVersionInvalidated(handoffId, item.packetVersion)) {
      markStale(queueStore, item, 'system', `Version ${item.packetVersion} invalidated`);
      staleCount++;
      continue;
    }

    // Check if a newer version exists
    const record = handoffStore.getPacket(handoffId);
    if (record && record.currentVersion > item.packetVersion) {
      markStale(queueStore, item, 'system', `Newer version ${record.currentVersion} available (item is v${item.packetVersion})`);
      staleCount++;
      continue;
    }
  }

  return staleCount;
}

/**
 * Propagate invalidation for a specific handoff into the queue.
 */
export function propagateInvalidation(
  queueStore: QueueStore,
  handoffId: string,
  packetVersion: number,
  reason: string,
): number {
  const items = queueStore.findByHandoffId(handoffId);
  let affected = 0;

  for (const item of items) {
    if (item.packetVersion === packetVersion && !TERMINAL_STATUSES.has(item.status) && item.status !== 'stale') {
      markStale(queueStore, item, 'system', `Invalidation: ${reason}`);
      affected++;
    }
  }

  return affected;
}

function markStale(queueStore: QueueStore, item: QueueItem, actor: string, reason: string): void {
  const oldStatus = item.status;
  queueStore.updateStatus(item.queueItemId, 'stale');

  queueStore.insertEvent({
    queueItemId: item.queueItemId,
    kind: 'stale_detected',
    fromStatus: oldStatus,
    toStatus: 'stale',
    actor,
    reason,
    createdAt: nowISO(),
  });
}

// ── Re-derivation ───────────────────────────────────────────────────

/**
 * Re-derive a stale queue item. Creates a new brief and queue item
 * from the current packet state, then clears the old item.
 */
export interface RequeueResult {
  ok: true;
  oldItemId: string;
  newItem: QueueItem;
}

export interface RequeueError {
  ok: false;
  error: string;
}

export function requeueStaleItem(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
  queueItemId: string,
  actor: string,
): RequeueResult | RequeueError {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return { ok: false, error: `Queue item '${queueItemId}' not found` };
  if (item.status !== 'stale') return { ok: false, error: `Item is not stale (status: ${item.status})` };

  const handoffId = item.handoffId as HandoffId;

  // Reconstruct current valid packet
  const packet = handoffStore.reconstructPacket(handoffId);
  if (!packet) return { ok: false, error: `Cannot reconstruct packet for '${handoffId}'` };

  // Re-derive brief
  const briefResult = deriveDecisionBrief({
    store: handoffStore,
    packet,
    role: item.role,
    fingerprint: item.evidenceFingerprint,
  });

  if (!briefResult.ok) return { ok: false, error: briefResult.error };

  // Persist and enqueue
  queueStore.insertBrief(briefResult.brief);

  const newItem = deriveQueueItem(briefResult.brief);
  queueStore.insertQueueItem(newItem);

  // Clear old item
  queueStore.updateStatus(queueItemId, 'cleared');
  queueStore.insertEvent({
    queueItemId,
    kind: 'status_changed',
    fromStatus: 'stale',
    toStatus: 'cleared',
    actor,
    reason: `Re-derived as ${newItem.queueItemId}`,
    createdAt: nowISO(),
  });

  // Record creation event for new item
  queueStore.insertEvent({
    queueItemId: newItem.queueItemId,
    kind: 'created',
    toStatus: 'pending',
    toPriority: newItem.priorityClass,
    actor,
    reason: `Re-derived from stale item ${queueItemId}`,
    createdAt: newItem.createdAt,
  });

  return { ok: true, oldItemId: queueItemId, newItem };
}
