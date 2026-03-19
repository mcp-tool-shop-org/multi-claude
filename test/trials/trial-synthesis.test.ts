/**
 * Trial Synthesis — Phase 10C-203
 *
 * Cross-trial validation that proves doctrine patterns hold
 * across coupling levels.
 *
 * Key questions:
 *   - Does promotion conservatism scale with coupling?
 *   - Does invalidation fire proportionally?
 *   - Does handoff completeness survive coupling pressure?
 *   - Is the recovery-to-approval path usable?
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import { renderOutcome } from '../../src/console/outcome-render.js';
import { renderHandoff } from '../../src/console/handoff-render.js';
import { renderPromotionCheck } from '../../src/console/approval-render.js';
import type { ApprovalRecord } from '../../src/types/approval.js';
import {
  trialA_CleanRun,
  trialB_MediumCoupling,
  trialB_WithRecovery,
  trialC_HighCoupling,
  trialC_PartialSuccess,
  trialC_Stopped,
} from './trial-fixtures.js';

// ── Helpers ─────────────────────────────────────────────────────────

function deriveAll(fixture: ReturnType<typeof trialA_CleanRun>) {
  const outcome = deriveOutcomeFromModels(fixture.model, fixture.hooks, fixture.audit);
  const handoff = deriveHandoffFromModels(fixture.model, outcome, fixture.hooks, fixture.audit);
  const promotion = checkPromotion(handoff);
  return { outcome, handoff, promotion };
}

function makeApproval(handoff: ReturnType<typeof deriveAll>['handoff'], promotion: ReturnType<typeof deriveAll>['promotion']): ApprovalRecord {
  return {
    id: 'apr-synth',
    runId: handoff.runId,
    status: 'approved',
    approver: 'operator',
    reason: 'Synthesized approval',
    binding: {
      runId: handoff.runId,
      handoffFingerprint: promotion.handoffFingerprint,
      outcomeStatus: handoff.outcomeStatus,
      verdict: handoff.verdict,
      resolvedCount: handoff.landedContributions,
      failedCount: handoff.failedContributions,
      unresolvedCount: handoff.reviewBlockingIssues,
      boundAt: '2026-03-19T10:35:00Z',
    },
    decidedAt: '2026-03-19T10:35:00Z',
    invalidatedAt: null,
    invalidationReason: null,
  };
}

// ── Doctrine: Promotion conservatism scales with coupling ───────

describe('Promotion conservatism vs coupling', () => {
  it('low coupling clean run → promotable', () => {
    const { promotion } = deriveAll(trialA_CleanRun());
    expect(promotion.eligibility).toBe('promotable');
  });

  it('medium coupling with retry → promotable_with_notes', () => {
    const { promotion } = deriveAll(trialB_MediumCoupling());
    expect(promotion.eligibility).toBe('promotable_with_notes');
  });

  it('high coupling with failure → not_promotable or ineligible', () => {
    const { promotion } = deriveAll(trialC_HighCoupling());
    expect(['not_promotable', 'ineligible']).toContain(promotion.eligibility);
  });

  it('blocker count increases with coupling severity', () => {
    const a = deriveAll(trialA_CleanRun());
    const b = deriveAll(trialB_MediumCoupling());
    const c = deriveAll(trialC_HighCoupling());
    expect(a.promotion.blockers.length).toBeLessThanOrEqual(b.promotion.notes.length);
    expect(c.promotion.blockers.length).toBeGreaterThan(a.promotion.blockers.length);
  });
});

// ── Doctrine: Handoff completeness under pressure ───────────────

describe('Handoff completeness across coupling levels', () => {
  it('all trials produce non-empty summaries', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling()]) {
      const { handoff } = deriveAll(fixture);
      expect(handoff.summary.length).toBeGreaterThan(10);
    }
  });

  it('all trials produce contribution lists matching packet count', () => {
    const a = deriveAll(trialA_CleanRun());
    const b = deriveAll(trialB_MediumCoupling());
    const c = deriveAll(trialC_HighCoupling());
    expect(a.handoff.contributions.length).toBe(5);
    expect(b.handoff.contributions.length).toBe(6);
    expect(c.handoff.contributions.length).toBe(8);
  });

  it('failed contributions are honestly flagged', () => {
    const { handoff } = deriveAll(trialC_HighCoupling());
    const nonContributing = handoff.contributions.filter(c => !c.contributesToResult);
    expect(nonContributing.length).toBeGreaterThan(0);
  });

  it('intervention digest scales with actual intervention count', () => {
    const a = deriveAll(trialA_CleanRun());
    const b = deriveAll(trialB_MediumCoupling());
    const c = deriveAll(trialC_HighCoupling());
    expect(a.handoff.interventions.summary.totalActions).toBe(0);
    expect(b.handoff.interventions.summary.totalActions).toBeGreaterThan(0);
    expect(c.handoff.interventions.summary.totalActions).toBeGreaterThan(b.handoff.interventions.summary.totalActions);
  });
});

// ── Doctrine: Invalidation fires proportionally ─────────────────

describe('Invalidation proportionality', () => {
  it('non-material change does not invalidate (any trial)', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling()]) {
      const { handoff, promotion } = deriveAll(fixture);
      const approval = makeApproval(handoff, promotion);
      // Same handoff, different generatedAt
      const laterHandoff = { ...handoff, generatedAt: '2026-03-20T00:00:00Z' };
      const validity = checkApprovalValidity(approval, laterHandoff);
      expect(validity.valid).toBe(true);
    }
  });

  it('outcome status change invalidates (any trial)', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling()]) {
      const { handoff, promotion } = deriveAll(fixture);
      const approval = makeApproval(handoff, promotion);
      const degraded = { ...handoff, outcomeStatus: 'terminal_failure' as any };
      const validity = checkApprovalValidity(approval, degraded);
      expect(validity.valid).toBe(false);
      expect(validity.reasons).toContain('outcome_changed');
    }
  });

  it('verdict change invalidates', () => {
    const { handoff, promotion } = deriveAll(trialA_CleanRun());
    const approval = makeApproval(handoff, promotion);
    const changed = { ...handoff, verdict: 'not_review_ready' as any };
    const validity = checkApprovalValidity(approval, changed);
    expect(validity.valid).toBe(false);
    expect(validity.reasons).toContain('verdict_changed');
  });
});

// ── Doctrine: Recovery-to-approval path ─────────────────────────

describe('Recovery-to-approval path', () => {
  it('medium-coupling recovery run can still be promoted', () => {
    const { promotion } = deriveAll(trialB_WithRecovery());
    expect(['promotable', 'promotable_with_notes']).toContain(promotion.eligibility);
  });

  it('high-coupling partial failure cannot be promoted', () => {
    const { promotion } = deriveAll(trialC_PartialSuccess());
    expect(['not_promotable', 'ineligible']).toContain(promotion.eligibility);
  });

  it('stopped run cannot be promoted', () => {
    const { promotion } = deriveAll(trialC_Stopped());
    expect(promotion.eligibility).toBe('ineligible');
  });
});

// ── Doctrine: Rendering stability across coupling ───────────────

describe('Rendering stability', () => {
  it('all outcomes render without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const { outcome } = deriveAll(fixture);
      const output = renderOutcome(outcome);
      expect(output).toContain('OUTCOME');
      expect(output.length).toBeGreaterThan(50);
    }
  });

  it('all handoffs render without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const { handoff } = deriveAll(fixture);
      const output = renderHandoff(handoff);
      expect(output).toContain('HANDOFF');
      expect(output.length).toBeGreaterThan(50);
    }
  });

  it('all promotion checks render without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const { promotion } = deriveAll(fixture);
      const output = renderPromotionCheck(promotion);
      expect(output).toContain('PROMOTION CHECK');
      expect(output.length).toBeGreaterThan(50);
    }
  });

  it('JSON roundtrips cleanly for all trials', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling()]) {
      const { outcome, handoff, promotion } = deriveAll(fixture);
      // Round-trip each
      expect(JSON.parse(JSON.stringify(outcome)).status).toBe(outcome.status);
      expect(JSON.parse(JSON.stringify(handoff)).verdict).toBe(handoff.verdict);
      expect(JSON.parse(JSON.stringify(promotion)).eligibility).toBe(promotion.eligibility);
    }
  });
});

// ── Fingerprint doctrine ────────────────────────────────────────

describe('Fingerprint doctrine across trials', () => {
  it('different trials produce different fingerprints', () => {
    const fps = [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling()]
      .map(f => deriveAll(f))
      .map(d => d.promotion.handoffFingerprint);

    const unique = new Set(fps);
    expect(unique.size).toBe(3);
  });

  it('same trial always produces same fingerprint', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling()]) {
      const d1 = deriveAll(fixture);
      const d2 = deriveAll(fixture);
      expect(d1.promotion.handoffFingerprint).toBe(d2.promotion.handoffFingerprint);
    }
  });
});
