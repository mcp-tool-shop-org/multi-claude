/**
 * Monitor Command — Claim Item.
 *
 * Operator takes a lease on a queue item through canonical supervisor action.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { claimQueueItem } from '../../handoff/supervisor/supervisor-actions.js';
import type { ClaimItemRequest, MonitorCommandResponse } from '../types.js';

export function executeClaimItem(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: ClaimItemRequest,
): MonitorCommandResponse {
  const result = claimQueueItem(queueStore, supervisorStore, {
    queueItemId,
    actor: req.operatorId,
  });

  if (!result.ok) {
    return {
      ok: false,
      action: 'claim',
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  return {
    ok: true,
    action: 'claim',
    queueItemId,
  };
}
