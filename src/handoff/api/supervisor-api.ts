/**
 * Supervisor Loop — API layer.
 *
 * Re-exports core actions and provides enhanced inspect
 * that includes supervisor state.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { QueueItem } from '../queue/types.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { SupervisorClaim, SupervisorEvent } from '../supervisor/types.js';
import { renderReviewerBrief } from '../decision/reviewer-decision-renderer.js';
import { renderApproverBrief } from '../decision/approver-decision-renderer.js';
import type { DecisionBrief } from '../decision/types.js';

// ── Enhanced inspect with supervisor state ──────────────────────────

export interface SupervisedInspectResult {
  ok: true;
  item: QueueItem;
  brief: DecisionBrief;
  renderedText: string;
  queueEvents: ReturnType<QueueStore['getEvents']>;
  /** Current supervisor claim state */
  claim: SupervisorClaim | null;
  /** Supervisor event history for this item */
  supervisorEvents: SupervisorEvent[];
  /** Whether the current actor can claim/act */
  canClaim: boolean;
  canAct: boolean;
  claimStatus: 'unclaimed' | 'claimed' | 'expired' | 'deferred' | 'escalated';
}

export interface SupervisedInspectError {
  ok: false;
  error: string;
}

/**
 * Inspect a queue item with full supervisor state visibility.
 */
export function supervisedInspect(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  actor?: string,
): SupervisedInspectResult | SupervisedInspectError {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return { ok: false, error: `Queue item '${queueItemId}' not found` };

  const brief = queueStore.getBrief(item.briefId);
  if (!brief) return { ok: false, error: `Brief '${item.briefId}' not found` };

  const renderedText = brief.role === 'reviewer'
    ? renderReviewerBrief(brief)
    : renderApproverBrief(brief);

  const queueEvents = queueStore.getEvents(queueItemId);
  const claim = supervisorStore.getActiveOrDeferredClaim(queueItemId);
  const supervisorEvents = supervisorStore.getEventsByQueueItem(queueItemId);

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let claimStatus: SupervisedInspectResult['claimStatus'] = 'unclaimed';
  let canClaim = true;
  let canAct = false;

  if (claim) {
    if (claim.status === 'active') {
      if (claim.leaseExpiresAt <= now) {
        claimStatus = 'expired';
        canClaim = true;
      } else {
        claimStatus = 'claimed';
        canClaim = false;
        canAct = actor ? claim.claimedBy === actor : false;
      }
    } else if (claim.status === 'deferred') {
      if (claim.deferredUntil && claim.deferredUntil <= now) {
        claimStatus = 'unclaimed';
        canClaim = true;
      } else {
        claimStatus = 'deferred';
        canClaim = false;
      }
    } else if (claim.status === 'escalated') {
      claimStatus = 'escalated';
      canClaim = false;
    }
  }

  // Cannot claim/act on terminal or stale items
  if (item.status === 'stale' || ['approved', 'rejected', 'recovery_requested', 'cleared'].includes(item.status)) {
    canClaim = false;
    canAct = false;
  }

  return {
    ok: true,
    item,
    brief,
    renderedText,
    queueEvents,
    claim,
    supervisorEvents,
    canClaim,
    canAct,
    claimStatus,
  };
}

// ── Re-exports ──────────────────────────────────────────────────────

export {
  claimQueueItem,
  releaseClaim,
  deferClaim,
  escalateClaim,
  requeueClaim,
  resolveNextItem,
  sweepExpiredLeases,
  interruptStaleClaims,
} from '../supervisor/supervisor-actions.js';

export type {
  ClaimResult,
  SupervisorError,
  NextItemResult,
  NextItemEmpty,
} from '../supervisor/supervisor-actions.js';
