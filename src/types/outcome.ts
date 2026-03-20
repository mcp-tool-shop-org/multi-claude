/**
 * Canonical run outcome types — Phase 9F.
 *
 * Outcome is derived from DB truth, never stored. It answers:
 * what completed, what failed, what was recovered, what remains
 * unresolved, whether the run is acceptable, and what comes next.
 *
 * See Phase 9F contract: docs/trials/9F-000-CONTRACT-FREEZE.md
 */

import type { ActionTargetType } from './actions.js';

// ── Outcome status ──────────────────────────────────────────────────

/**
 * The canonical outcome classification for a concluded run.
 * Each value represents a distinct closure class, not a vague label.
 */
export type RunOutcomeStatus =
  | 'clean_success'       // all packets resolved, no intervention
  | 'assisted_success'    // all packets resolved, operator intervened
  | 'partial_success'     // some packets resolved, some failed/unresolved
  | 'terminal_failure'    // run failed — unrecoverable without re-planning
  | 'stopped'             // operator stopped the run — may be resumable
  | 'in_progress';        // run has not concluded

/** All known outcome statuses, for guard tests. */
export const RUN_OUTCOME_STATUSES: ReadonlySet<RunOutcomeStatus> = new Set([
  'clean_success', 'assisted_success', 'partial_success',
  'terminal_failure', 'stopped', 'in_progress',
]);

// ── Packet-level outcome ────────────────────────────────────────────

/**
 * What happened to a single packet by the time the run ends.
 */
export type PacketOutcomeStatus =
  | 'resolved'       // verified, integrating, or merged
  | 'failed'         // failed and not recovered
  | 'recovered'      // failed then retried successfully
  | 'blocked'        // still blocked on dependencies
  | 'pending'        // never started or still in progress
  | 'skipped';       // not attempted (run stopped before reaching it)

export interface PacketOutcome {
  packetId: string;
  title: string;
  status: PacketOutcomeStatus;
  wave: number;
  attempts: number;
  wasRetried: boolean;          // true if packet was retried at least once
  finalState: string;           // raw packet status from DB
}

// ── Unresolved items ────────────────────────────────────────────────

/**
 * Something that remains unresolved at run conclusion.
 * Explicit, not hidden — the operator sees exactly what is dangling.
 */
export interface UnresolvedItem {
  type: 'failed_packet' | 'blocked_packet' | 'pending_hook' | 'unresolved_gate' | 'pending_packet';
  targetType: ActionTargetType | 'system';
  targetId: string;
  description: string;
}

// ── Intervention summary ────────────────────────────────────────────

/**
 * Aggregate of operator interventions during the run.
 * Derived from the audit trail.
 */
export interface InterventionSummary {
  totalActions: number;
  retries: number;
  stops: number;
  resumes: number;
  gateApprovals: number;
  hookResolutions: number;
}

// ── Follow-up recommendation ────────────────────────────────────────

/**
 * What the operator should do after reviewing the outcome.
 */
export type FollowUpKind =
  | 'none'            // run succeeded cleanly, nothing to do
  | 'review'          // success with caveats, worth reviewing
  | 'recover'         // partial failure, recovery path available
  | 'replan'          // terminal failure, needs new run plan
  | 'resume';         // stopped run, can be resumed

export interface FollowUp {
  kind: FollowUpKind;
  title: string;
  reason: string;
  command: string | null;  // CLI command, if applicable
}

// ── Run outcome ─────────────────────────────────────────────────────

/**
 * The complete derived outcome for a concluded (or in-progress) run.
 */
export interface RunOutcome {
  runId: string;
  featureId: string;
  featureTitle: string;
  status: RunOutcomeStatus;
  summary: string;                      // one-sentence human-readable outcome

  // Packet-level breakdown
  packets: PacketOutcome[];
  resolvedCount: number;
  failedCount: number;
  recoveredCount: number;
  unresolvedCount: number;
  totalPackets: number;

  // What remains
  unresolvedItems: UnresolvedItem[];

  // Intervention history
  interventions: InterventionSummary;

  // Acceptability
  acceptable: boolean;                  // is this outcome good enough?
  acceptabilityReason: string;          // why or why not

  // What to do next
  followUp: FollowUp;

  // Provenance
  derivedAt: string;                    // ISO timestamp
  runStatus: string;                    // raw run status from DB
  elapsedMs: number | null;             // total run duration
}
