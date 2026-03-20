/**
 * Action Eligibility Policy — Phase 13B.
 *
 * Computes which operator actions are allowed on a queue item
 * based on canonical state from law stores. The UI renders these
 * projections; it never guesses eligibility on its own.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { TERMINAL_STATUSES } from '../../handoff/queue/types.js';
import type { ActionEligibility } from '../types.js';
import { nowISO } from '../../lib/ids.js';

export interface EligibilityStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
}

/**
 * Compute action eligibility for a single queue item.
 * Returns allowed/disallowed with human-readable reasons.
 */
export function computeEligibility(
  stores: EligibilityStores,
  queueItemId: string,
): ActionEligibility {
  const { queueStore, supervisorStore } = stores;

  const disallowAll = (reason: string): ActionEligibility => ({
    claim: { allowed: false, reason },
    release: { allowed: false, reason },
    defer: { allowed: false, reason },
    requeue: { allowed: false, reason },
    escalate: { allowed: false, reason },
  });

  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return disallowAll('Item not found');

  if (TERMINAL_STATUSES.has(item.status)) {
    return disallowAll(`Item is in terminal state '${item.status}'`);
  }

  if (item.status === 'stale') {
    return disallowAll('Item is stale — re-derive before acting');
  }

  const now = nowISO();
  const activeClaim = supervisorStore.getActiveClaim(queueItemId);
  const deferredClaim = supervisorStore.getActiveOrDeferredClaim(queueItemId);

  // Determine effective claim state
  const hasActiveClaim = !!activeClaim && activeClaim.leaseExpiresAt > now;
  const hasDeferredClaim = !!deferredClaim && deferredClaim.status === 'deferred';
  const deferExpired = hasDeferredClaim && deferredClaim!.deferredUntil != null
    && deferredClaim!.deferredUntil <= now;

  // ── Claim eligibility ──
  let claim: ActionEligibility['claim'];
  if (hasActiveClaim) {
    claim = { allowed: false, reason: `Already claimed by '${activeClaim!.claimedBy}'` };
  } else if (hasDeferredClaim && !deferExpired) {
    claim = { allowed: false, reason: `Deferred until ${deferredClaim!.deferredUntil} by '${deferredClaim!.claimedBy}'` };
  } else {
    claim = { allowed: true };
  }

  // ── Release eligibility ──
  let release: ActionEligibility['release'];
  if (hasActiveClaim) {
    release = { allowed: true };
  } else {
    release = { allowed: false, reason: 'No active claim to release' };
  }

  // ── Defer eligibility ──
  let defer: ActionEligibility['defer'];
  if (hasActiveClaim) {
    defer = { allowed: true };
  } else {
    defer = { allowed: false, reason: 'No active claim to defer' };
  }

  // ── Escalate eligibility ──
  let escalate: ActionEligibility['escalate'];
  if (hasActiveClaim) {
    escalate = { allowed: true };
  } else {
    escalate = { allowed: false, reason: 'No active claim to escalate' };
  }

  // ── Requeue eligibility ──
  let requeue: ActionEligibility['requeue'];
  if (hasDeferredClaim) {
    requeue = { allowed: true };
  } else if (hasActiveClaim) {
    requeue = { allowed: true };
  } else {
    requeue = { allowed: false, reason: 'No active or deferred claim to requeue' };
  }

  return { claim, release, defer, requeue, escalate };
}
