/**
 * Decision Eligibility Policy — Phase 13C.
 *
 * Computes the decision affordance for a queue item.
 * Separates two distinct concerns:
 *   1. What the brief allows (canonical judgment law)
 *   2. What the operator/session state allows (supervision law)
 *
 * The brief's eligibility is authoritative for judgment.
 * The affordance gates whether the operator can act right now.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { TERMINAL_STATUSES } from '../../handoff/queue/types.js';
import type { DecisionAffordance } from '../types.js';
import { nowISO } from '../../lib/ids.js';

export interface DecisionEligibilityStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
}

/**
 * Compute operator-gated decision affordance for a queue item.
 * This does NOT recompute brief eligibility — that comes from the brief itself.
 */
export function computeDecisionAffordance(
  stores: DecisionEligibilityStores,
  queueItemId: string,
): DecisionAffordance {
  const { queueStore, supervisorStore } = stores;

  const item = queueStore.getQueueItem(queueItemId);
  if (!item) {
    return { decisionEnabled: false, disabledReason: 'Item not found', hasActiveClaim: false, claimedByOperator: false };
  }

  if (TERMINAL_STATUSES.has(item.status)) {
    return { decisionEnabled: false, disabledReason: `Item is in terminal state '${item.status}'`, hasActiveClaim: false, claimedByOperator: false };
  }

  if (item.status === 'stale') {
    return { decisionEnabled: false, disabledReason: 'Decision unavailable: brief is stale and must be refreshed through canonical flow', hasActiveClaim: false, claimedByOperator: false };
  }

  // Check brief exists
  const brief = item.briefId ? queueStore.getBrief(item.briefId) : null;
  if (!brief) {
    return { decisionEnabled: false, disabledReason: 'No decision brief available', hasActiveClaim: false, claimedByOperator: false };
  }

  if (brief.eligibility.allowedActions.length === 0) {
    return { decisionEnabled: false, disabledReason: 'Brief has no allowed actions', hasActiveClaim: false, claimedByOperator: false };
  }

  // Check claim state
  const now = nowISO();
  const activeClaim = supervisorStore.getActiveClaim(queueItemId);

  if (!activeClaim) {
    return { decisionEnabled: false, disabledReason: 'No active claim — claim the item first', hasActiveClaim: false, claimedByOperator: false };
  }

  if (activeClaim.leaseExpiresAt <= now) {
    return { decisionEnabled: false, disabledReason: 'Claim has expired — re-claim to decide', hasActiveClaim: false, claimedByOperator: false };
  }

  // Active claim exists and is valid
  // In 13C simple identity model, we report claimedByOperator as true
  // since the monitor operates as a single-operator workbench
  return {
    decisionEnabled: true,
    disabledReason: null,
    hasActiveClaim: true,
    claimedByOperator: true,
  };
}
