/**
 * Monitor Command — Requeue Item.
 *
 * Returns deferred/escalated/active item to pending for fresh claim.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { requeueClaim } from '../../handoff/supervisor/supervisor-actions.js';
import type { RequeueItemRequest, MonitorCommandResponse } from '../types.js';

export function executeRequeueItem(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: RequeueItemRequest,
): MonitorCommandResponse {
  const result = requeueClaim(queueStore, supervisorStore, {
    queueItemId,
    actor: req.operatorId,
    reason: req.reason ?? 'Requeued via monitor',
  });

  if (!result.ok) {
    return {
      ok: false,
      action: 'requeue',
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  return {
    ok: true,
    action: 'requeue',
    queueItemId,
  };
}
