/**
 * Monitor Command Client — Phase 13B/13C.
 *
 * Thin POST client for operator intent commands.
 * No business logic — just call endpoint, return result.
 */

import type { MonitorCommandResponse, DecisionCommandResponse, DecisionAction } from '../types';

const BASE = '';

async function postCommand(
  url: string,
  body: Record<string, unknown>,
): Promise<MonitorCommandResponse> {
  const res = await fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function claimItem(queueItemId: string, operatorId: string) {
  return postCommand(`/api/monitor/queue/${queueItemId}/claim`, { operatorId });
}

export function releaseItem(queueItemId: string, operatorId: string, reason?: string) {
  return postCommand(`/api/monitor/queue/${queueItemId}/release`, { operatorId, reason });
}

export function deferItem(queueItemId: string, operatorId: string, reason: string, until?: string) {
  return postCommand(`/api/monitor/queue/${queueItemId}/defer`, { operatorId, reason, until });
}

export function requeueItem(queueItemId: string, operatorId: string, reason?: string) {
  return postCommand(`/api/monitor/queue/${queueItemId}/requeue`, { operatorId, reason });
}

export function escalateItem(queueItemId: string, operatorId: string, reason: string, target?: string) {
  return postCommand(`/api/monitor/queue/${queueItemId}/escalate`, { operatorId, reason, target });
}

// ── Decision commands (Phase 13C) ──────────────────────────────────

export async function decideItem(
  queueItemId: string,
  operatorId: string,
  action: DecisionAction,
  reason: string,
): Promise<DecisionCommandResponse> {
  const res = await fetch(`/api/monitor/queue/${queueItemId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operatorId, action, reason }),
  });
  return res.json();
}
