/**
 * Decision Queue — API layer.
 *
 * Provides the primary entry points for queue operations:
 *   - enqueue: create brief → derive queue item → persist
 *   - list: deterministic ordered queue
 *   - inspect: full brief + delta + evidence for a queue item
 *   - act: take action from queue item
 *   - refresh: propagate staleness across active items
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { DecisionRole } from '../decision/types.js';
import type { ModelAdapterName } from './render-handoff.js';
import type { QueueItem } from '../queue/types.js';
import { QueueStore } from '../queue/queue-store.js';
import { createDecisionBrief } from './create-decision-brief.js';
import { enqueueDecisionBrief } from '../queue/derive-queue-item.js';
import { renderReviewerBrief } from '../decision/reviewer-decision-renderer.js';
import { renderApproverBrief } from '../decision/approver-decision-renderer.js';
import type { DecisionBrief } from '../decision/types.js';

// ── Enqueue ──────────────────────────────────────────────────────────

export interface EnqueueResult {
  ok: true;
  queueItem: QueueItem;
  brief: DecisionBrief;
}

export interface EnqueueError {
  ok: false;
  error: string;
}

/**
 * Create a decision brief and enqueue it for review/approval.
 */
export function enqueueHandoff(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
  input: {
    handoffId: string;
    role: DecisionRole;
    model?: ModelAdapterName;
    actor: string;
    consumerRunId?: string;
  },
): EnqueueResult | EnqueueError {
  const briefResult = createDecisionBrief(handoffStore, {
    handoffId: input.handoffId,
    role: input.role,
    model: input.model,
    consumerRunId: input.consumerRunId,
  });

  if (!briefResult.ok) {
    return { ok: false, error: briefResult.error };
  }

  const item = enqueueDecisionBrief(queueStore, briefResult.brief, input.actor);

  return { ok: true, queueItem: item, brief: briefResult.brief };
}

// ── List ─────────────────────────────────────────────────────────────

/**
 * List the queue in deterministic priority order.
 */
export function listQueue(
  queueStore: QueueStore,
  opts?: { role?: DecisionRole; activeOnly?: boolean },
): QueueItem[] {
  return queueStore.listQueue(opts);
}

// ── Inspect ──────────────────────────────────────────────────────────

export interface InspectResult {
  ok: true;
  item: QueueItem;
  brief: DecisionBrief;
  renderedText: string;
  events: ReturnType<QueueStore['getEvents']>;
}

export interface InspectError {
  ok: false;
  error: string;
}

/**
 * Inspect a queue item — shows brief, rendered text, and event history.
 */
export function inspectQueueItem(
  queueStore: QueueStore,
  queueItemId: string,
): InspectResult | InspectError {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return { ok: false, error: `Queue item '${queueItemId}' not found` };

  const brief = queueStore.getBrief(item.briefId);
  if (!brief) return { ok: false, error: `Brief '${item.briefId}' not found` };

  const renderedText = brief.role === 'reviewer'
    ? renderReviewerBrief(brief)
    : renderApproverBrief(brief);

  const events = queueStore.getEvents(queueItemId);

  return { ok: true, item, brief, renderedText, events };
}

/**
 * Inspect by handoff ID — finds active queue items for the handoff.
 */
export function inspectByHandoff(
  queueStore: QueueStore,
  handoffId: string,
): InspectResult | InspectError {
  const items = queueStore.findByHandoffId(handoffId);
  if (items.length === 0) {
    return { ok: false, error: `No active queue items for handoff '${handoffId}'` };
  }
  return inspectQueueItem(queueStore, items[0]!.queueItemId);
}

// ── Act ──────────────────────────────────────────────────────────────

export { actOnQueueItem } from '../queue/queue-actions.js';

// ── Refresh ──────────────────────────────────────────────────────────

export { propagateStaleness, propagateInvalidation, requeueStaleItem } from '../queue/queue-actions.js';
