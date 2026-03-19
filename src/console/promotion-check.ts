/**
 * Promotion Check — Phase 10B-102
 *
 * Deterministic eligibility assessment for promotion.
 * Derived from handoff truth — never stored.
 *
 * Rules:
 *   - review_ready → promotable
 *   - review_ready_with_notes → promotable_with_notes (explicit policy: allowed with notes)
 *   - not_review_ready → not_promotable
 *   - incomplete → ineligible
 *   - blocked → ineligible
 *   - no handoff → ineligible
 *
 * Refusal reasons are exact, not generic.
 */

import { createHash } from 'node:crypto';
import type { RunHandoff } from '../types/handoff.js';
import type {
  PromotionCheckResult,
  PromotionBlocker,
  PromotionEligibility,
} from '../types/approval.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Assess promotion eligibility from a handoff artifact.
 */
export function checkPromotion(handoff: RunHandoff): PromotionCheckResult {
  const fingerprint = computeHandoffFingerprint(handoff);
  const blockers = collectPromotionBlockers(handoff);
  const eligibility = classifyEligibility(handoff, blockers);
  const notes = collectPromotionNotes(handoff);

  return {
    runId: handoff.runId,
    eligibility,
    reason: buildEligibilityReason(eligibility, blockers, notes),
    blockers,
    notes,
    handoffVerdict: handoff.verdict,
    handoffFingerprint: fingerprint,
    recommendedAction: recommendAction(eligibility, handoff),
  };
}

/**
 * Compute a stable fingerprint for a handoff artifact.
 * This is what approval binds to. If the handoff changes materially,
 * the fingerprint changes and approval becomes stale.
 */
export function computeHandoffFingerprint(handoff: RunHandoff): string {
  // Hash the material fields — not generatedAt (which changes every derivation)
  const material = {
    runId: handoff.runId,
    verdict: handoff.verdict,
    outcomeStatus: handoff.outcomeStatus,
    acceptable: handoff.acceptable,
    landedContributions: handoff.landedContributions,
    failedContributions: handoff.failedContributions,
    recoveredContributions: handoff.recoveredContributions,
    totalContributions: handoff.totalContributions,
    reviewBlockingIssues: handoff.reviewBlockingIssues,
    outstandingIssueIds: handoff.outstandingIssues.map(i => `${i.kind}:${i.id}`).sort(),
    interventionCount: handoff.interventions.summary.totalActions,
    followUpActions: handoff.followUps.map(f => f.action).sort(),
  };

  return createHash('sha256')
    .update(JSON.stringify(material))
    .digest('hex')
    .slice(0, 16); // 16-char hex is collision-safe for this use
}

// ── Eligibility classification ──────────────────────────────────────

function classifyEligibility(
  handoff: RunHandoff,
  blockers: PromotionBlocker[],
): PromotionEligibility {
  // Incomplete or blocked → ineligible (cannot even consider promotion)
  if (handoff.verdict === 'incomplete' || handoff.verdict === 'blocked') {
    return 'ineligible';
  }

  // Has promotion blockers → not promotable
  if (blockers.length > 0) {
    return 'not_promotable';
  }

  // review_ready_with_notes → promotable with notes (explicit policy)
  if (handoff.verdict === 'review_ready_with_notes') {
    return 'promotable_with_notes';
  }

  // review_ready → promotable
  if (handoff.verdict === 'review_ready') {
    return 'promotable';
  }

  // Fallback (should not reach here given finite verdicts)
  return 'not_promotable';
}

// ── Blocker collection ──────────────────────────────────────────────

function collectPromotionBlockers(handoff: RunHandoff): PromotionBlocker[] {
  const blockers: PromotionBlocker[] = [];

  // Handoff verdict itself blocks
  switch (handoff.verdict) {
    case 'not_review_ready':
      blockers.push({
        kind: 'handoff_not_ready',
        description: `Handoff verdict is not_review_ready: ${handoff.reviewReadiness.reason}`,
        targetId: handoff.runId,
      });
      break;

    case 'blocked':
      blockers.push({
        kind: 'handoff_blocked',
        description: `Handoff is blocked: ${handoff.reviewReadiness.reason}`,
        targetId: handoff.runId,
      });
      break;

    case 'incomplete':
      blockers.push({
        kind: 'handoff_incomplete',
        description: `Run is incomplete: ${handoff.reviewReadiness.reason}`,
        targetId: handoff.runId,
      });
      break;
  }

  // Review-blocking issues
  for (const issue of handoff.outstandingIssues) {
    if (issue.blocksReview) {
      blockers.push({
        kind: 'review_blocker',
        description: issue.description,
        targetId: issue.id,
      });
    }
  }

  // Unacceptable outcome (not caught by verdict alone)
  if (!handoff.acceptable && handoff.verdict !== 'incomplete' && handoff.verdict !== 'blocked') {
    blockers.push({
      kind: 'unacceptable_outcome',
      description: `Run outcome not acceptable: ${handoff.acceptabilityReason}`,
      targetId: handoff.runId,
    });
  }

  return blockers;
}

// ── Note collection ─────────────────────────────────────────────────

function collectPromotionNotes(handoff: RunHandoff): string[] {
  const notes: string[] = [];

  // Pass through readiness notes
  for (const note of handoff.reviewReadiness.notes) {
    notes.push(`[${note.kind}] ${note.description}`);
  }

  // Intervention history is always worth noting
  if (handoff.interventions.occurred) {
    const s = handoff.interventions.summary;
    notes.push(`Run required ${s.totalActions} operator intervention(s)`);
  }

  // No file evidence
  if (!handoff.hasChangeEvidence) {
    notes.push('No file-level change evidence available — manual scope verification recommended');
  }

  return notes;
}

// ── Reason builder ──────────────────────────────────────────────────

function buildEligibilityReason(
  eligibility: PromotionEligibility,
  blockers: PromotionBlocker[],
  notes: string[],
): string {
  switch (eligibility) {
    case 'promotable':
      return 'Run is eligible for promotion — all checks pass';

    case 'promotable_with_notes':
      return `Run is eligible for promotion with ${notes.length} note(s) — review caveats before approving`;

    case 'not_promotable':
      return `Run is not promotable: ${blockers.length} blocker(s) — ${blockers[0]?.description ?? 'unknown'}`;

    case 'ineligible':
      return `Run is ineligible for promotion — ${blockers[0]?.description ?? 'handoff is not ready'}`;
  }
}

// ── Action recommendation ───────────────────────────────────────────

function recommendAction(
  eligibility: PromotionEligibility,
  handoff: RunHandoff,
): string | null {
  switch (eligibility) {
    case 'promotable':
      return `multi-claude console approve --run ${handoff.runId}`;

    case 'promotable_with_notes':
      return `multi-claude console approve --run ${handoff.runId}`;

    case 'not_promotable':
      return `multi-claude console handoff --run ${handoff.runId}`;

    case 'ineligible':
      return handoff.followUps[0]?.command ?? `multi-claude console outcome --run ${handoff.runId}`;
  }
}
