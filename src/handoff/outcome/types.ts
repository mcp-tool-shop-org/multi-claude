/**
 * Outcome Ledger — Phase 10 canonical types.
 *
 * Outcomes close the loop from policy-governed action to durable,
 * replayable result records. Every closed item gets an immutable
 * outcome that records what the laws actually produced.
 *
 * Law: an outcome is the system's honest assessment of whether
 * its own rules led to resolution, churn, overload, or failure.
 */

// ── Resolution class ─────────────────────────────────────────────────

/**
 * Terminal resolution: how did this item actually end?
 */
export type ResolutionTerminal =
  | 'approved'
  | 'rejected'
  | 'recovered'
  | 'abandoned'
  | 'expired'
  | 'invalidated'
  | 'superseded';

/**
 * Resolution quality: was the path clean or rough?
 */
export type ResolutionQuality =
  | 'clean'                // straight-through, no drama
  | 'churn_heavy'          // multiple claim/release cycles
  | 'recovery_heavy'       // required recovery path
  | 'intervention_assisted' // intervention was required
  | 'policy_blocked';       // policy change blocked or altered path

// ── Outcome status ───────────────────────────────────────────────────

export type OutcomeStatus = 'open' | 'closed';

// ── Outcome ──────────────────────────────────────────────────────────

export interface Outcome {
  outcomeId: string;
  queueItemId: string;
  handoffId: string;
  packetVersion: number;
  briefId: string;

  status: OutcomeStatus;

  /** Terminal action that closed this outcome */
  finalAction: string | null;
  /** Terminal queue status at closure */
  finalStatus: string | null;
  /** How did this resolve? */
  resolutionTerminal: ResolutionTerminal | null;
  /** Was the path clean or rough? */
  resolutionQuality: ResolutionQuality | null;

  /** Policy version bound at closure */
  policySetId: string | null;
  policyVersion: number | null;

  /** Actor or system that produced the terminal action */
  closedBy: string | null;

  // ── Timing ──────────────────────────────────────────────────────

  openedAt: string;
  closedAt: string | null;
  durationMs: number | null;

  // ── Effectiveness counters ──────────────────────────────────────

  claimCount: number;
  deferCount: number;
  rerouteCount: number;
  escalationCount: number;
  overflowCount: number;
  interventionCount: number;
  recoveryCycleCount: number;
  claimChurnCount: number;

  /** Whether the active policy changed during this item's lifecycle */
  policyChangedDuringLifecycle: boolean;
}

// ── Outcome event ────────────────────────────────────────────────────

export type OutcomeEventKind =
  | 'opened'
  | 'closed'
  | 'snapshot_updated';

export interface OutcomeEvent {
  outcomeId: string;
  kind: OutcomeEventKind;
  detail: string;
  actor: string;
  createdAt: string;
}

// ── Replay timeline ──────────────────────────────────────────────────

export type ReplayEntryKind =
  | 'queue_entry'
  | 'claim'
  | 'release'
  | 'defer'
  | 'escalate'
  | 'requeue'
  | 'lease_expired'
  | 'reroute'
  | 'flow_denial'
  | 'overflow_entry'
  | 'overflow_resurface'
  | 'intervention_start'
  | 'intervention_resolve'
  | 'policy_change'
  | 'action_taken'
  | 'stale_detected'
  | 'invalidation';

export interface ReplayEntry {
  timestamp: string;
  kind: ReplayEntryKind;
  detail: string;
  actor: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReplayTimeline {
  queueItemId: string;
  handoffId: string;
  outcomeId: string | null;
  entries: ReplayEntry[];
  summary: string;
}

// ── Closure input ────────────────────────────────────────────────────

export interface CloseOutcomeInput {
  queueItemId: string;
  finalAction: string;
  finalStatus: string;
  resolutionTerminal: ResolutionTerminal;
  closedBy: string;
}
