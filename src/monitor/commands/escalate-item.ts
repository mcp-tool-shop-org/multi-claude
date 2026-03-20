/**
 * Monitor Command — Escalate Item.
 *
 * Operator routes item to higher review authority.
 */

import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import { escalateClaim } from '../../handoff/supervisor/supervisor-actions.js';
import type { EscalateItemRequest, MonitorCommandResponse } from '../types.js';

export function executeEscalateItem(
  supervisorStore: SupervisorStore,
  queueItemId: string,
  req: EscalateItemRequest,
): MonitorCommandResponse {
  const result = escalateClaim(supervisorStore, {
    queueItemId,
    actor: req.operatorId,
    target: req.target ?? 'escalated_review',
    reason: req.reason,
  });

  if (!result.ok) {
    return {
      ok: false,
      action: 'escalate',
      queueItemId,
      error: { code: result.code, message: result.error },
    };
  }

  return {
    ok: true,
    action: 'escalate',
    queueItemId,
  };
}
