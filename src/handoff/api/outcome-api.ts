/**
 * Outcome Ledger — API.
 *
 * Read-only inspection for outcome state.
 */

import type { OutcomeStore } from '../outcome/outcome-store.js';
import type { QueueStore } from '../queue/queue-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { FlowStore } from '../flow/flow-store.js';
import type { InterventionStore } from '../intervention/intervention-store.js';
import type { PolicyStore } from '../policy/policy-store.js';
import type { Outcome, OutcomeEvent, ReplayTimeline } from '../outcome/types.js';
import { buildReplayTimeline } from '../outcome/outcome-actions.js';

// ── Inspect ──────────────────────────────────────────────────────────

export interface OutcomeInspectResult {
  ok: true;
  outcome: Outcome;
  events: OutcomeEvent[];
}

export interface OutcomeInspectError {
  ok: false;
  error: string;
}

export function outcomeInspect(
  outcomeStore: OutcomeStore,
  outcomeId: string,
): OutcomeInspectResult | OutcomeInspectError {
  const outcome = outcomeStore.getOutcome(outcomeId);
  if (!outcome) {
    return { ok: false, error: `Outcome '${outcomeId}' not found` };
  }
  return {
    ok: true,
    outcome,
    events: outcomeStore.getEvents(outcomeId),
  };
}

// ── Inspect by queue item ────────────────────────────────────────────

export function outcomeByQueueItem(
  outcomeStore: OutcomeStore,
  queueItemId: string,
): OutcomeInspectResult | OutcomeInspectError {
  const outcome = outcomeStore.getOutcomeByQueueItem(queueItemId);
  if (!outcome) {
    return { ok: false, error: `No outcome for queue item '${queueItemId}'` };
  }
  return {
    ok: true,
    outcome,
    events: outcomeStore.getEvents(outcome.outcomeId),
  };
}

// ── Replay ───────────────────────────────────────────────────────────

export interface ReplayResult {
  ok: true;
  timeline: ReplayTimeline;
}

export interface ReplayError {
  ok: false;
  error: string;
}

export function outcomeReplay(
  outcomeStore: OutcomeStore,
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  routingStore: RoutingStore,
  flowStore: FlowStore,
  interventionStore: InterventionStore,
  policyStore: PolicyStore,
  queueItemId: string,
): ReplayResult | ReplayError {
  const timeline = buildReplayTimeline(
    outcomeStore, queueStore, supervisorStore, routingStore,
    flowStore, interventionStore, policyStore, queueItemId,
  );
  if (!timeline) {
    return { ok: false, error: `Queue item '${queueItemId}' not found` };
  }
  return { ok: true, timeline };
}
