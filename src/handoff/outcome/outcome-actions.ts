/**
 * Outcome Ledger — Actions.
 *
 * Handles:
 *   - Opening outcomes when items enter the queue
 *   - Closing outcomes when items reach terminal state
 *   - Deriving resolution class from lifecycle events
 *   - Computing effectiveness counters from audit trails
 *   - Building deterministic replay timelines
 *   - Binding outcomes to exact policy/action lineage
 *
 * Law: outcomes are honest snapshots of what the control plane
 * actually produced — no inference, no rewriting.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { FlowStore } from '../flow/flow-store.js';
import type { InterventionStore } from '../intervention/intervention-store.js';
import type { PolicyStore } from '../policy/policy-store.js';
import type { OutcomeStore } from './outcome-store.js';
import type {
  Outcome,
  ResolutionTerminal,
  ResolutionQuality,
  CloseOutcomeInput,
  ReplayEntry,
  ReplayTimeline,
} from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Open outcome ─────────────────────────────────────────────────────

export interface OpenOutcomeResult {
  ok: true;
  outcome: Outcome;
}

export interface OpenOutcomeError {
  ok: false;
  error: string;
  code: 'already_exists' | 'queue_item_not_found';
}

/**
 * Open an outcome when a queue item is created.
 * Idempotent — returns existing outcome if already open.
 */
export function openOutcome(
  outcomeStore: OutcomeStore,
  queueStore: QueueStore,
  input: {
    queueItemId: string;
    actor: string;
  },
): OpenOutcomeResult | OpenOutcomeError {
  const existing = outcomeStore.getOutcomeByQueueItem(input.queueItemId);
  if (existing) {
    return { ok: true, outcome: existing };
  }

  const item = queueStore.getQueueItem(input.queueItemId);
  if (!item) {
    return { ok: false, error: `Queue item '${input.queueItemId}' not found`, code: 'queue_item_not_found' };
  }

  const now = nowISO();
  const outcome: Outcome = {
    outcomeId: generateId('oc'),
    queueItemId: item.queueItemId,
    handoffId: item.handoffId,
    packetVersion: item.packetVersion,
    briefId: item.briefId,
    status: 'open',
    finalAction: null,
    finalStatus: null,
    resolutionTerminal: null,
    resolutionQuality: null,
    policySetId: null,
    policyVersion: null,
    closedBy: null,
    openedAt: item.createdAt,
    closedAt: null,
    durationMs: null,
    claimCount: 0,
    deferCount: 0,
    rerouteCount: 0,
    escalationCount: 0,
    overflowCount: 0,
    interventionCount: 0,
    recoveryCycleCount: 0,
    claimChurnCount: 0,
    policyChangedDuringLifecycle: false,
  };

  outcomeStore.insertOutcome(outcome);
  outcomeStore.insertEvent({
    outcomeId: outcome.outcomeId,
    kind: 'opened',
    detail: `Outcome opened for queue item ${item.queueItemId}`,
    actor: input.actor,
    createdAt: now,
  });

  return { ok: true, outcome };
}

// ── Close outcome ────────────────────────────────────────────────────

export interface CloseOutcomeResult {
  ok: true;
  outcome: Outcome;
}

export interface CloseOutcomeError {
  ok: false;
  error: string;
  code: 'not_found' | 'already_closed' | 'queue_item_not_found';
}

/**
 * Close an outcome when a queue item reaches terminal state.
 * Idempotent — already-closed outcomes return error.
 */
export function closeOutcome(
  outcomeStore: OutcomeStore,
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  routingStore: RoutingStore,
  flowStore: FlowStore,
  interventionStore: InterventionStore,
  policyStore: PolicyStore,
  input: CloseOutcomeInput,
): CloseOutcomeResult | CloseOutcomeError {
  const existing = outcomeStore.getOutcomeByQueueItem(input.queueItemId);
  if (!existing) {
    return { ok: false, error: `No outcome found for queue item '${input.queueItemId}'`, code: 'not_found' };
  }

  if (existing.status === 'closed') {
    return { ok: false, error: `Outcome '${existing.outcomeId}' is already closed`, code: 'already_closed' };
  }

  const item = queueStore.getQueueItem(input.queueItemId);
  if (!item) {
    return { ok: false, error: `Queue item '${input.queueItemId}' not found`, code: 'queue_item_not_found' };
  }

  const now = nowISO();

  // Compute effectiveness counters from event trails
  const counters = computeEffectivenessCounters(
    queueStore, supervisorStore, routingStore, flowStore, interventionStore,
    input.queueItemId,
  );

  // Resolve active policy at closure time
  const activePolicy = policyStore.getActivePolicy('global');

  // Check if policy changed during lifecycle
  const policyChanged = detectPolicyChangeDuringLifecycle(
    policyStore, existing.openedAt, now,
  );

  // Derive resolution quality
  const quality = deriveResolutionQuality(
    input.resolutionTerminal, counters,
  );

  const closedAt = now;
  const openedDate = new Date(existing.openedAt);
  const closedDate = new Date(closedAt);
  const durationMs = closedDate.getTime() - openedDate.getTime();

  outcomeStore.closeOutcome(existing.outcomeId, {
    finalAction: input.finalAction,
    finalStatus: input.finalStatus,
    resolutionTerminal: input.resolutionTerminal,
    resolutionQuality: quality,
    policySetId: activePolicy?.policySetId ?? null,
    policyVersion: activePolicy?.policyVersion ?? null,
    closedBy: input.closedBy,
    closedAt,
    durationMs,
    ...counters,
    policyChangedDuringLifecycle: policyChanged,
  });

  outcomeStore.insertEvent({
    outcomeId: existing.outcomeId,
    kind: 'closed',
    detail: `Closed: ${input.resolutionTerminal} (${quality}) by ${input.closedBy}`,
    actor: input.closedBy,
    createdAt: now,
  });

  const closed = outcomeStore.getOutcome(existing.outcomeId)!;
  return { ok: true, outcome: closed };
}

// ── Effectiveness counters ───────────────────────────────────────────

export interface EffectivenessCounters {
  claimCount: number;
  deferCount: number;
  rerouteCount: number;
  escalationCount: number;
  overflowCount: number;
  interventionCount: number;
  recoveryCycleCount: number;
  claimChurnCount: number;
}

export function computeEffectivenessCounters(
  _queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  routingStore: RoutingStore,
  flowStore: FlowStore,
  interventionStore: InterventionStore,
  queueItemId: string,
): EffectivenessCounters {
  // Supervisor events for this queue item
  const supervisorEvents = supervisorStore.getEventsByQueueItem(queueItemId);
  const claimCount = supervisorEvents.filter(e => e.kind === 'claimed' || e.kind === 'reclaimed').length;
  const deferCount = supervisorEvents.filter(e => e.kind === 'deferred').length;
  const escalationCount = supervisorEvents.filter(e => e.kind === 'escalated').length;
  const claimChurnCount = supervisorEvents.filter(e => e.kind === 'lease_expired').length;
  const recoveryCycleCount = supervisorEvents.filter(e => e.kind === 'requeued').length;

  // Routing events for this queue item
  const routingEvents = routingStore.getEvents(queueItemId);
  const rerouteCount = routingEvents.filter(e => e.kind === 'rerouted').length;

  // Flow events — count overflow for this queue item
  const flowEvents = flowStore.getEvents({});
  const overflowCount = flowEvents.filter(e =>
    e.kind === 'overflow_entered' && e.queueItemId === queueItemId
  ).length;

  // Intervention events — count interventions on related lanes
  const route = routingStore.getActiveRoute(queueItemId);
  let interventionCount = 0;
  if (route) {
    const interventionEvents = interventionStore.getEvents({ lane: route.lane });
    interventionCount = interventionEvents.filter(e => e.kind === 'intervention_started').length;
  }

  return {
    claimCount,
    deferCount,
    rerouteCount,
    escalationCount,
    overflowCount,
    interventionCount,
    recoveryCycleCount,
    claimChurnCount,
  };
}

// ── Resolution quality derivation ────────────────────────────────────

export function deriveResolutionQuality(
  terminal: ResolutionTerminal,
  counters: EffectivenessCounters,
): ResolutionQuality {
  // Intervention-assisted takes priority
  if (counters.interventionCount > 0) {
    return 'intervention_assisted';
  }

  // Recovery-heavy if recovery cycles occurred
  if (counters.recoveryCycleCount > 0 || terminal === 'recovered') {
    return 'recovery_heavy';
  }

  // Churn-heavy if multiple claims or deferrals or reroutes
  if (counters.claimChurnCount > 0 || counters.claimCount > 2 || counters.deferCount > 1 || counters.rerouteCount > 1) {
    return 'churn_heavy';
  }

  // Clean resolution
  return 'clean';
}

// ── Policy change detection ──────────────────────────────────────────

function detectPolicyChangeDuringLifecycle(
  policyStore: PolicyStore,
  openedAt: string,
  closedAt: string,
): boolean {
  const events = policyStore.getEvents({});
  return events.some(e =>
    (e.kind === 'activated' || e.kind === 'rolled_back') &&
    e.createdAt >= openedAt && e.createdAt <= closedAt
  );
}

// ── Replay timeline ──────────────────────────────────────────────────

/**
 * Build a deterministic replay timeline for a queue item.
 * Read-only — does not infer events that were not recorded.
 */
export function buildReplayTimeline(
  outcomeStore: OutcomeStore,
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  routingStore: RoutingStore,
  flowStore: FlowStore,
  interventionStore: InterventionStore,
  policyStore: PolicyStore,
  queueItemId: string,
): ReplayTimeline | null {
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return null;

  const entries: ReplayEntry[] = [];

  // 1. Queue entry
  entries.push({
    timestamp: item.createdAt,
    kind: 'queue_entry',
    detail: `Queued as ${item.role} with priority ${item.priorityClass}`,
    actor: null,
  });

  // 2. Queue events
  const queueEvents = queueStore.getEvents(queueItemId);
  for (const e of queueEvents) {
    if (e.kind === 'stale_detected') {
      entries.push({
        timestamp: e.createdAt,
        kind: 'stale_detected',
        detail: e.reason,
        actor: e.actor,
      });
    } else if (e.kind === 'invalidation_propagated') {
      entries.push({
        timestamp: e.createdAt,
        kind: 'invalidation',
        detail: e.reason,
        actor: e.actor,
      });
    } else if (e.kind === 'action_bound') {
      entries.push({
        timestamp: e.createdAt,
        kind: 'action_taken',
        detail: `Action: ${e.toStatus ?? e.reason}`,
        actor: e.actor,
      });
    }
  }

  // 3. Supervisor events (claims, releases, deferrals, etc.)
  const supervisorEvents = supervisorStore.getEventsByQueueItem(queueItemId);
  for (const e of supervisorEvents) {
    const kindMap: Record<string, ReplayEntry['kind'] | undefined> = {
      claimed: 'claim',
      reclaimed: 'claim',
      released: 'release',
      deferred: 'defer',
      escalated: 'escalate',
      requeued: 'requeue',
      lease_expired: 'lease_expired',
      action_taken: 'action_taken',
    };
    const replayKind = kindMap[e.kind];
    if (replayKind) {
      entries.push({
        timestamp: e.createdAt,
        kind: replayKind,
        detail: `${e.kind}: ${e.reason}`,
        actor: e.actor,
      });
    }
  }

  // 4. Routing events
  const routingEvents = routingStore.getEvents(queueItemId);
  for (const e of routingEvents) {
    if (e.kind === 'rerouted') {
      entries.push({
        timestamp: e.createdAt,
        kind: 'reroute',
        detail: `Rerouted: ${e.fromLane ?? '?'} → ${e.toLane} — ${e.reason}`,
        actor: e.actor,
        metadata: { fromLane: e.fromLane, toLane: e.toLane },
      });
    }
  }

  // 5. Flow events related to this item (match by queueItemId field)
  const flowEvents = flowStore.getEvents({});
  for (const e of flowEvents) {
    if (e.queueItemId === queueItemId) {
      if (e.kind === 'overflow_entered') {
        entries.push({
          timestamp: e.createdAt,
          kind: 'overflow_entry',
          detail: `Overflow: ${e.lane} — ${e.reason}`,
          actor: null,
        });
      } else if (e.kind === 'overflow_exited') {
        entries.push({
          timestamp: e.createdAt,
          kind: 'overflow_resurface',
          detail: `Resurfaced: ${e.lane}`,
          actor: null,
        });
      } else if (e.kind === 'admission_denied') {
        entries.push({
          timestamp: e.createdAt,
          kind: 'flow_denial',
          detail: `Admission denied: ${e.lane} — ${e.reason}`,
          actor: null,
        });
      }
    }
  }

  // 6. Intervention events on the route's lane
  const route = routingStore.getActiveRoute(queueItemId);
  if (route) {
    const interventionEvents = interventionStore.getEvents({ lane: route.lane });
    for (const e of interventionEvents) {
      if (e.kind === 'intervention_started' && e.createdAt >= item.createdAt) {
        entries.push({
          timestamp: e.createdAt,
          kind: 'intervention_start',
          detail: `Intervention: ${e.action} on ${e.lane} — ${e.reason}`,
          actor: e.actor,
        });
      } else if (e.kind === 'intervention_resolved' && e.createdAt >= item.createdAt) {
        entries.push({
          timestamp: e.createdAt,
          kind: 'intervention_resolve',
          detail: `Intervention resolved: ${e.lane} — ${e.reason}`,
          actor: e.actor,
        });
      }
    }
  }

  // 7. Policy changes during lifecycle
  const outcome = outcomeStore.getOutcomeByQueueItem(queueItemId);
  const closedAt = outcome?.closedAt ?? nowISO();
  const policyEvents = policyStore.getEvents({});
  for (const e of policyEvents) {
    if ((e.kind === 'activated' || e.kind === 'rolled_back') &&
        e.createdAt >= item.createdAt && e.createdAt <= closedAt) {
      entries.push({
        timestamp: e.createdAt,
        kind: 'policy_change',
        detail: `Policy ${e.kind}: ${e.policySetId} — ${e.reason}`,
        actor: e.actor,
      });
    }
  }

  // Sort chronologically
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Generate summary
  const summary = generateReplaySummary(item, entries, outcome);

  return {
    queueItemId,
    handoffId: item.handoffId,
    outcomeId: outcome?.outcomeId ?? null,
    entries,
    summary,
  };
}

function generateReplaySummary(
  item: { queueItemId: string; role: string; priorityClass: string; status: string },
  entries: ReplayEntry[],
  outcome: Outcome | undefined | null,
): string {
  const parts: string[] = [];

  parts.push(`Item ${item.queueItemId} (${item.role}, ${item.priorityClass})`);

  if (outcome?.status === 'closed') {
    parts.push(`resolved as ${outcome.resolutionTerminal} (${outcome.resolutionQuality})`);
    if (outcome.durationMs !== null) {
      const mins = Math.round(outcome.durationMs / 60000);
      parts.push(`in ${mins}m`);
    }

    const churnParts: string[] = [];
    if (outcome.claimCount > 1) churnParts.push(`${outcome.claimCount} claims`);
    if (outcome.deferCount > 0) churnParts.push(`${outcome.deferCount} defers`);
    if (outcome.rerouteCount > 0) churnParts.push(`${outcome.rerouteCount} reroutes`);
    if (outcome.interventionCount > 0) churnParts.push(`${outcome.interventionCount} interventions`);
    if (churnParts.length > 0) {
      parts.push(`with ${churnParts.join(', ')}`);
    }
  } else {
    parts.push(`currently ${item.status}`);
    parts.push(`${entries.length} events recorded`);
  }

  return parts.join(' — ');
}

// ── Map terminal status to resolution ────────────────────────────────

/**
 * Map queue item final status to resolution terminal.
 * Used when the caller doesn't specify an explicit resolution.
 */
export function deriveResolutionTerminal(finalStatus: string): ResolutionTerminal {
  switch (finalStatus) {
    case 'approved': return 'approved';
    case 'rejected': return 'rejected';
    case 'recovery_requested': return 'recovered';
    case 'cleared': return 'superseded';
    default: return 'abandoned';
  }
}
