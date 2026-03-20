/**
 * Monitor Command — Defer Item.
 *
 * Operator defers handling; claim stays active but item excluded from next-item.
 */

import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { deferClaim } from '../../handoff/supervisor/supervisor-actions.js';
import type { DeferItemRequest, MonitorCommandResponse } from '../types.js';

export function executeDeferItem(
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: DeferItemRequest,
): MonitorCommandResponse {
  // Default defer: 15 minutes from now
  const until = req.until ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const result = deferClaim(supervisorStore, {
    queueItemId,
    actor: req.operatorId,
    deferredUntil: until,
    reason: req.reason,
  });

  if (!result.ok) {
    return {
      ok: false,
      action: 'defer',
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  return {
    ok: true,
    action: 'defer',
    queueItemId,
  };
}
