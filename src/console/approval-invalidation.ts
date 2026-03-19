/**
 * Approval Invalidation — Phase 10B-103
 *
 * Checks whether an existing approval is still valid by comparing
 * the bound evidence against current truth.
 *
 * Invalidation is real, not implied. When the truth changes materially,
 * the approval becomes stale and must be re-evaluated.
 *
 * Material changes (invalidate):
 *   - handoff fingerprint differs
 *   - outcome status changed
 *   - handoff verdict changed
 *   - new review-blocking issue appeared
 *   - material intervention occurred post-approval
 *   - bound evidence is no longer derivable
 *
 * Non-material changes (do NOT invalidate):
 *   - timestamp of derivation changed
 *   - additional non-blocking notes appeared
 *   - rendering format changed
 */

import type { ApprovalRecord, ApprovalInvalidation, InvalidationReason } from '../types/approval.js';
import type { RunHandoff } from '../types/handoff.js';
import { computeHandoffFingerprint } from './promotion-check.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Check whether an existing approval is still valid against current truth.
 */
export function checkApprovalValidity(
  approval: ApprovalRecord,
  currentHandoff: RunHandoff,
): ApprovalInvalidation {
  const currentFingerprint = computeHandoffFingerprint(currentHandoff);
  const reasons: InvalidationReason[] = [];
  const details: string[] = [];

  // Check fingerprint match
  if (currentFingerprint !== approval.binding.handoffFingerprint) {
    reasons.push('handoff_changed');
    details.push(
      `Handoff fingerprint changed: was ${approval.binding.handoffFingerprint}, now ${currentFingerprint}`,
    );
  }

  // Check outcome status
  if (currentHandoff.outcomeStatus !== approval.binding.outcomeStatus) {
    reasons.push('outcome_changed');
    details.push(
      `Outcome status changed: was ${approval.binding.outcomeStatus}, now ${currentHandoff.outcomeStatus}`,
    );
  }

  // Check verdict
  if (currentHandoff.verdict !== approval.binding.verdict) {
    reasons.push('verdict_changed');
    details.push(
      `Handoff verdict changed: was ${approval.binding.verdict}, now ${currentHandoff.verdict}`,
    );
  }

  // Check for new review-blocking issues
  const currentBlockingCount = currentHandoff.outstandingIssues.filter(i => i.blocksReview).length;
  if (currentBlockingCount > 0 && approval.binding.unresolvedCount === 0) {
    reasons.push('new_blocker');
    details.push(
      `${currentBlockingCount} new review-blocking issue(s) appeared post-approval`,
    );
  }

  // Check for material intervention post-approval
  const approvalTime = new Date(approval.decidedAt).getTime();
  const postApprovalInterventions = currentHandoff.interventions.significantActions.filter(
    a => new Date(a.timestamp).getTime() > approvalTime,
  );
  if (postApprovalInterventions.length > 0) {
    reasons.push('intervention_occurred');
    details.push(
      `${postApprovalInterventions.length} operator intervention(s) occurred after approval`,
    );
  }

  // Check failed count change (evidence regression)
  if (currentHandoff.failedContributions > approval.binding.failedCount) {
    if (!reasons.includes('handoff_changed')) {
      reasons.push('evidence_missing');
      details.push(
        `Failed contributions increased: was ${approval.binding.failedCount}, now ${currentHandoff.failedContributions}`,
      );
    }
  }

  return {
    valid: reasons.length === 0,
    approvalId: approval.id,
    reasons,
    details,
    currentFingerprint,
    boundFingerprint: approval.binding.handoffFingerprint,
  };
}
