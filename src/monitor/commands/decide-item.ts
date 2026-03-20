/**
 * Monitor Command — Decide Item (Phase 13C).
 *
 * Operator takes a bounded lawful decision on a claimed queue item.
 * Goes through canonical action binding: actOnQueueItem → bindDecisionAction.
 *
 * Law: the UI may emit decision intents. The brief's eligibility gates
 * what actions are legal. The binding verifies version validity.
 * The UI does not invent a judgment rubric.
 */

import type { HandoffStore } from '../../handoff/store/handoff-store.js';
import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { actOnQueueItem } from '../../handoff/queue/queue-actions.js';
import { nowISO } from '../../lib/ids.js';
import type { DecisionRequest, DecisionCommandResponse } from '../types.js';

const VALID_ACTIONS = new Set(['approve', 'reject', 'request-recovery', 'needs-review']);

export function executeDecision(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: DecisionRequest,
): DecisionCommandResponse {
  // Validate action is canonical
  if (!VALID_ACTIONS.has(req.action)) {
    return {
      ok: false,
      action: req.action,
      queueItemId,
      error: {
        code: 'invalid_action',
        message: `Action '${req.action}' is not a valid decision action. Valid: ${[...VALID_ACTIONS].join(', ')}`,
      },
    };
  }

  // Guard: operator must have active claim
  const now = nowISO();
  const activeClaim = supervisorStore.getActiveClaim(queueItemId);
  if (!activeClaim) {
    return {
      ok: false,
      action: req.action,
      queueItemId,
      error: {
        code: 'no_active_claim',
        message: 'Decision requires an active claim. Claim the item first.',
      },
    };
  }

  if (activeClaim.leaseExpiresAt <= now) {
    return {
      ok: false,
      action: req.action,
      queueItemId,
      error: {
        code: 'claim_expired',
        message: 'Your claim has expired. Re-claim the item to decide.',
      },
    };
  }

  if (activeClaim.claimedBy !== req.operatorId) {
    return {
      ok: false,
      action: req.action,
      queueItemId,
      error: {
        code: 'not_claimer',
        message: `Only '${activeClaim.claimedBy}' can decide on this item.`,
      },
    };
  }

  // Execute through canonical law
  const result = actOnQueueItem(handoffStore, queueStore, {
    queueItemId,
    action: req.action,
    actor: req.operatorId,
    reason: req.reason,
  });

  if (!result.ok) {
    return {
      ok: false,
      action: req.action,
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  // Complete the supervisor claim on terminal decisions
  if (result.newStatus !== 'in_review') {
    supervisorStore.updateClaimStatus(activeClaim.claimId, 'completed', `Decision: ${req.action}`);
    supervisorStore.insertEvent({
      claimId: activeClaim.claimId,
      queueItemId,
      kind: 'action_taken',
      fromStatus: 'active',
      toStatus: 'completed',
      actor: req.operatorId,
      reason: `Decision: ${req.action} — ${req.reason}`,
      createdAt: nowISO(),
    });
  }

  return {
    ok: true,
    action: req.action,
    queueItemId,
    actionId: result.actionId,
    newStatus: result.newStatus,
  };
}
