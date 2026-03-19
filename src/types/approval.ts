/**
 * Canonical approval types — Phase 10B.
 *
 * Approval is the lawful transition from "handoff exists" to "accepted downstream."
 *
 * Core principles:
 *   - Approval binds to a specific frozen evidence version (fingerprint), not "latest."
 *   - Promotion eligibility is deterministic from handoff truth.
 *   - Approval becomes stale when the bound truth materially changes.
 *   - Refusal reasons are first-class, not afterthoughts.
 *   - Approval and handoff verdict are separate concepts.
 *
 * Canonical source — no local redefinition.
 */

import type { HandoffVerdict } from './handoff.js';

// ── Promotion eligibility ──────────────────────────────────────────

/**
 * Whether the run is eligible for promotion.
 * Finite, disjoint. Each value carries operational meaning.
 *
 * - promotable: all promotion rules pass, approval is legal
 * - promotable_with_notes: eligible but caveats exist (review_ready_with_notes policy)
 * - not_promotable: one or more hard blockers prevent promotion
 * - ineligible: handoff is incomplete or blocked — promotion cannot be considered
 */
export type PromotionEligibility =
  | 'promotable'
  | 'promotable_with_notes'
  | 'not_promotable'
  | 'ineligible';

/** All known promotion eligibilities, for guard tests. */
export const PROMOTION_ELIGIBILITIES: ReadonlySet<PromotionEligibility> = new Set([
  'promotable', 'promotable_with_notes', 'not_promotable', 'ineligible',
]);

// ── Approval status ────────────────────────────────────────────────

/**
 * Current status of an approval decision.
 *
 * - pending: no decision recorded
 * - approved: explicitly approved by an authority
 * - rejected: explicitly rejected with reason
 * - invalidated: was approved but underlying truth changed materially
 */
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'invalidated';

/** All known approval statuses, for guard tests. */
export const APPROVAL_STATUSES: ReadonlySet<ApprovalStatus> = new Set([
  'pending', 'approved', 'rejected', 'invalidated',
]);

// ── Promotion blocker ──────────────────────────────────────────────

/**
 * A specific condition preventing promotion.
 * Must be exact and reproducible.
 */
export interface PromotionBlocker {
  kind: 'handoff_not_ready' | 'handoff_blocked' | 'handoff_incomplete'
    | 'review_blocker' | 'missing_evidence' | 'unacceptable_outcome'
    | 'no_handoff';
  description: string;
  targetId: string | null;
}

// ── Promotion check result ─────────────────────────────────────────

/**
 * The complete eligibility assessment for promotion.
 * Derived from handoff truth — never stored.
 */
export interface PromotionCheckResult {
  runId: string;
  eligibility: PromotionEligibility;
  reason: string;                       // one-sentence explanation
  blockers: PromotionBlocker[];         // what prevents promotion (empty if eligible)
  notes: string[];                      // caveats for the approver (even if eligible)
  handoffVerdict: HandoffVerdict;       // the handoff verdict this check is based on
  handoffFingerprint: string;           // SHA of derived handoff — binds to specific evidence
  recommendedAction: string | null;     // CLI command or human action
}

// ── Approval binding ───────────────────────────────────────────────

/**
 * What an approval is bound to. This is the version-lock.
 * If any of these change materially, the approval is invalidated.
 */
export interface ApprovalBinding {
  runId: string;
  handoffFingerprint: string;           // SHA of handoff artifact at approval time
  outcomeStatus: string;                // run outcome status at approval time
  verdict: HandoffVerdict;              // handoff verdict at approval time
  resolvedCount: number;                // packet counts at approval time
  failedCount: number;
  unresolvedCount: number;
  boundAt: string;                      // ISO timestamp when binding was created
}

// ── Approval record ────────────────────────────────────────────────

/**
 * A durable record of an approval decision.
 * Written when an operator approves or rejects.
 * Not derived — this is genuinely new truth.
 */
export interface ApprovalRecord {
  id: string;
  runId: string;
  status: ApprovalStatus;
  approver: string;                     // who made the decision
  reason: string;                       // why they approved/rejected
  binding: ApprovalBinding;             // what evidence this decision binds to
  decidedAt: string;                    // ISO timestamp
  invalidatedAt: string | null;         // set when invalidation detected
  invalidationReason: string | null;    // why invalidated
}

// ── Invalidation ───────────────────────────────────────────────────

/**
 * Reasons an approval becomes invalid.
 * Each is a material change to the truth the approval was bound to.
 */
export type InvalidationReason =
  | 'handoff_changed'         // handoff fingerprint differs from binding
  | 'outcome_changed'         // run outcome status changed
  | 'new_blocker'             // unresolved blocker appeared post-approval
  | 'intervention_occurred'   // material operator intervention after approval
  | 'evidence_missing'        // required evidence no longer available
  | 'verdict_changed';        // handoff verdict changed

/** All known invalidation reasons, for guard tests. */
export const INVALIDATION_REASONS: ReadonlySet<InvalidationReason> = new Set([
  'handoff_changed', 'outcome_changed', 'new_blocker',
  'intervention_occurred', 'evidence_missing', 'verdict_changed',
]);

// ── Approval invalidation ──────────────────────────────────────────

/**
 * Result of checking whether an existing approval is still valid.
 */
export interface ApprovalInvalidation {
  valid: boolean;                       // is the approval still valid?
  approvalId: string;
  reasons: InvalidationReason[];        // empty if valid
  details: string[];                    // human-readable explanation per reason
  currentFingerprint: string;           // current handoff fingerprint
  boundFingerprint: string;             // fingerprint the approval was bound to
}

// ── Promotion decision ─────────────────────────────────────────────

/**
 * What happened when promotion was attempted.
 * This is the CLI-facing result of an approve/reject action.
 */
export type PromotionDecision = 'approved' | 'rejected' | 'refused';

/** All known promotion decisions, for guard tests. */
export const PROMOTION_DECISIONS: ReadonlySet<PromotionDecision> = new Set([
  'approved', 'rejected', 'refused',
]);
