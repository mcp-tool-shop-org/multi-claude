/**
 * Monitor Command — Release Item.
 *
 * Operator gives up lease; item returns to pending.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { releaseClaim } from '../../handoff/supervisor/supervisor-actions.js';
import type { ReleaseItemRequest, MonitorCommandResponse } from '../types.js';

export function executeReleaseItem(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: ReleaseItemRequest,
): MonitorCommandResponse {
  const result = releaseClaim(queueStore, supervisorStore, {
    queueItemId,
    actor: req.operatorId,
    reason: req.reason ?? 'Released via monitor',
  });

  if (!result.ok) {
    return {
      ok: false,
      action: 'release',
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  return {
    ok: true,
    action: 'release',
    queueItemId,
  };
}
