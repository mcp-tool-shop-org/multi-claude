/**
 * Canonical handoff types — Phase 10A.
 *
 * A handoff is a derived artifact that answers:
 *   "Is this run's result ready for a human to review, promote, or act on?"
 *
 * Handoff is stricter than outcome. A run may succeed operationally
 * (outcome: acceptable) but still not be review-ready (handoff: not_review_ready)
 * if contributions are unclear, interventions need inspection, or blockers remain.
 *
 * Derived from existing truth — never stored.
 * Canonical source — no local redefinition.
 */

import type { ActionTargetType } from './actions.js';
import type { RunOutcomeStatus, PacketOutcomeStatus, InterventionSummary, FollowUpKind } from './outcome.js';

// ── Handoff verdict ────────────────────────────────────────────────

/**
 * The canonical handoff classification. Finite, disjoint.
 *
 * - review_ready: all contributions accounted for, no blockers, safe to hand off
 * - review_ready_with_notes: acceptable but interventions/caveats require inspection
 * - not_review_ready: unacceptable outcome, unresolved blockers, or missing contributions
 * - incomplete: run did not finish — stopped, in progress, or paused
 * - blocked: run completed but critical dependency or gate failure remains open
 */
export type HandoffVerdict =
  | 'review_ready'
  | 'review_ready_with_notes'
  | 'not_review_ready'
  | 'incomplete'
  | 'blocked';

/** All known handoff verdicts, for guard tests. */
export const HANDOFF_VERDICTS: ReadonlySet<HandoffVerdict> = new Set([
  'review_ready', 'review_ready_with_notes', 'not_review_ready',
  'incomplete', 'blocked',
]);

// ── Review readiness ───────────────────────────────────────────────

/**
 * Explicit review-readiness assessment with structured reasoning.
 * Separate from outcome acceptability — a run can be acceptable
 * operationally but still need notes before review.
 */
export interface ReviewReadiness {
  ready: boolean;                     // is this safe to put in front of a reviewer?
  verdict: HandoffVerdict;
  reason: string;                     // one-sentence explanation
  blockers: ReadinessBlocker[];       // what prevents review-ready (empty if ready)
  notes: ReadinessNote[];             // what the reviewer should know (even if ready)
}

/**
 * A specific condition preventing review-readiness.
 */
export interface ReadinessBlocker {
  kind: 'unresolved_failure' | 'missing_contribution' | 'open_gate' | 'pending_hook' | 'unacceptable_outcome' | 'run_incomplete';
  description: string;
  targetType: ActionTargetType | 'run' | 'system';
  targetId: string | null;
}

/**
 * Something the reviewer should know, even when the run is review-ready.
 */
export interface ReadinessNote {
  kind: 'intervention_occurred' | 'recovery_occurred' | 'caveat' | 'scope_limitation';
  description: string;
}

// ── Contribution summary ───────────────────────────────────────────

/**
 * What a single packet contributed to the run result.
 * Grounded in execution truth, not prose.
 */
export interface ContributionSummary {
  packetId: string;
  title: string;
  role: string;
  layer: string;
  wave: number;
  status: PacketOutcomeStatus;
  attempts: number;
  wasRetried: boolean;
  wasRecovered: boolean;
  hadIntervention: boolean;           // operator acted on this packet
  contributesToResult: boolean;       // did this packet land in the final state?
  changedFiles: ChangeSummary | null; // null if file truth unavailable
}

/**
 * File-level change summary for a contribution.
 * Only populated when grounded evidence exists (reconcile/manifest).
 * Never fabricated.
 */
export interface ChangeSummary {
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  totalFiles: number;
  reconciled: boolean;                // was manifest reconciled against actual diff?
  reconcilePass: boolean | null;      // null if not reconciled
}

// ── Outstanding issues ─────────────────────────────────────────────

/**
 * An issue that remains open at handoff time.
 * More structured than UnresolvedItem — includes review impact.
 */
export interface OutstandingIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  kind: 'failed_packet' | 'blocked_packet' | 'pending_hook' | 'unresolved_gate' | 'pending_packet' | 'reconcile_warning' | 'scope_overflow';
  description: string;
  blocksReview: boolean;              // does this prevent review-ready verdict?
  recommendedAction: string | null;   // command or human action
}

// ── Follow-up recommendation ───────────────────────────────────────

/**
 * Actionable follow-up for the handoff receiver.
 * Every follow-up must point to a concrete action.
 */
export interface HandoffFollowUp {
  action: FollowUpKind | 'inspect' | 'merge' | 'promote';
  reason: string;
  urgency: 'immediate' | 'soon' | 'when_ready';
  command: string | null;             // CLI command, if applicable
  description: string;                // what to do in plain terms
}

// ── Intervention digest ────────────────────────────────────────────

/**
 * Compact summary of operator interventions for the handoff reader.
 * Derived from audit trail, not stored separately.
 */
export interface InterventionDigest {
  occurred: boolean;                  // any intervention at all?
  summary: InterventionSummary;       // reuse canonical summary from outcome
  significantActions: InterventionEvent[];  // the actions that affected the result
}

/**
 * A single significant intervention event.
 */
export interface InterventionEvent {
  action: string;
  targetType: string;
  targetId: string;
  description: string;
  timestamp: string;
}

// ── Evidence reference ─────────────────────────────────────────────

/**
 * Pointer to verifiable evidence supporting the handoff.
 * Never fabricated — only references truth the system can ground.
 */
export interface EvidenceReference {
  kind: 'audit_trail' | 'verification_result' | 'reconcile_result' | 'hook_decision' | 'gate_approval' | 'run_outcome';
  description: string;
  command: string | null;             // CLI command to inspect this evidence
}

// ── Run handoff ────────────────────────────────────────────────────

/**
 * The complete derived handoff artifact for a run.
 * This is the portable decision artifact for downstream review.
 */
export interface RunHandoff {
  // Identity
  runId: string;
  featureId: string;
  featureTitle: string;

  // Verdict
  verdict: HandoffVerdict;
  reviewReadiness: ReviewReadiness;

  // Run context
  summary: string;                    // one-sentence run description
  attemptedGoal: string;              // what the run set out to do
  outcomeStatus: RunOutcomeStatus;
  acceptable: boolean;
  acceptabilityReason: string;

  // Contributions
  contributions: ContributionSummary[];
  totalContributions: number;
  landedContributions: number;        // contributed to final result
  failedContributions: number;
  recoveredContributions: number;

  // Changes
  hasChangeEvidence: boolean;         // do we have file-level change truth?
  totalFilesChanged: number;          // 0 if no evidence

  // Interventions
  interventions: InterventionDigest;

  // Outstanding issues
  outstandingIssues: OutstandingIssue[];
  reviewBlockingIssues: number;       // issues where blocksReview = true

  // Follow-ups
  followUps: HandoffFollowUp[];

  // Evidence trail
  evidenceRefs: EvidenceReference[];

  // Provenance
  generatedAt: string;                // ISO timestamp
  elapsedMs: number | null;           // run duration
}
