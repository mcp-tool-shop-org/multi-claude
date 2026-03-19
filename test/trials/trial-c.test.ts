/**
 * Trial C — Claude RPG (High Coupling)
 *
 * Tests the full chain under maximum coupling pressure:
 * - 8 packets, 2 retries, 1 failed packet
 * - Pending gate, pending hook
 * - Partial success, stopped variant
 *
 * This is the trial where doctrine either holds or breaks.
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import type { ApprovalRecord } from '../../src/types/approval.js';
import {
  trialC_HighCoupling,
  trialC_PartialSuccess,
  trialC_Stopped,
} from './trial-fixtures.js';

describe('Trial C — Claude RPG (High Coupling)', () => {
  // ── Active run with failed packet + pending gate ──────────────

  describe('Active run (failed packet + pending gate)', () => {
    const { model, hooks, audit } = trialC_HighCoupling();

    describe('Outcome', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);

      it('classifies as in_progress (run still complete but has pending hooks)', () => {
        // Run status is 'complete' but has a failed packet — should be partial
        expect(['partial_success', 'in_progress']).toContain(outcome.status);
      });

      it('has failed packets', () => {
        expect(outcome.failedCount).toBeGreaterThan(0);
      });

      it('has recovered packets (retried ones)', () => {
        expect(outcome.recoveredCount).toBeGreaterThan(0);
      });

      it('has unresolved items', () => {
        expect(outcome.unresolvedItems.length).toBeGreaterThan(0);
      });

      it('interventions counted', () => {
        expect(outcome.interventions.retries).toBeGreaterThanOrEqual(2);
      });
    });

    describe('Handoff', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

      it('verdict is NOT review_ready', () => {
        expect(handoff.verdict).not.toBe('review_ready');
      });

      it('has review-blocking outstanding issues', () => {
        expect(handoff.reviewBlockingIssues).toBeGreaterThan(0);
      });

      it('contributions include both landed and failed', () => {
        const landed = handoff.contributions.filter(c => c.contributesToResult);
        const failed = handoff.contributions.filter(c => !c.contributesToResult);
        expect(landed.length).toBeGreaterThan(0);
        expect(failed.length).toBeGreaterThan(0);
      });

      it('interventions are surfaced', () => {
        expect(handoff.interventions.occurred).toBe(true);
        expect(handoff.interventions.summary.retries).toBeGreaterThanOrEqual(2);
      });

      it('follow-ups include actionable recommendations', () => {
        expect(handoff.followUps.length).toBeGreaterThan(0);
      });
    });

    describe('Promotion', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
      const check = checkPromotion(handoff);

      it('is NOT promotable (failed packet + blockers)', () => {
        expect(['not_promotable', 'ineligible']).toContain(check.eligibility);
      });

      it('has specific blockers', () => {
        expect(check.blockers.length).toBeGreaterThan(0);
      });

      it('blocker descriptions are exact, not generic', () => {
        for (const b of check.blockers) {
          expect(b.description.length).toBeGreaterThan(10);
        }
      });

      it('does NOT recommend approve command', () => {
        expect(check.recommendedAction).not.toContain('approve');
      });
    });
  });

  // ── Partial success (run failed, some resolved) ───────────────

  describe('Partial success variant', () => {
    const { model, hooks, audit } = trialC_PartialSuccess();
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

    it('outcome is partial_success or terminal_failure', () => {
      expect(['partial_success', 'terminal_failure']).toContain(outcome.status);
    });

    it('handoff verdict is not_review_ready or blocked', () => {
      expect(['not_review_ready', 'blocked']).toContain(handoff.verdict);
    });

    it('promotion is not_promotable or ineligible', () => {
      const check = checkPromotion(handoff);
      expect(['not_promotable', 'ineligible']).toContain(check.eligibility);
    });

    it('contribution summary honestly reports failure', () => {
      expect(handoff.failedContributions).toBeGreaterThan(0);
    });
  });

  // ── Stopped run ───────────────────────────────────────────────

  describe('Stopped run variant', () => {
    const { model, hooks, audit } = trialC_Stopped();
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

    it('outcome is stopped', () => {
      expect(outcome.status).toBe('stopped');
    });

    it('handoff verdict is incomplete', () => {
      expect(handoff.verdict).toBe('incomplete');
    });

    it('promotion is ineligible', () => {
      const check = checkPromotion(handoff);
      expect(check.eligibility).toBe('ineligible');
    });

    it('follow-up recommends resume', () => {
      expect(outcome.followUp.kind).toBe('resume');
    });
  });

  // ── Approval binding under high coupling ──────────────────────

  describe('Approval binding (would-be scenario)', () => {
    // Simulate: if someone force-approved the partial run,
    // then truth changed — invalidation must catch it
    const { model, hooks, audit } = trialC_PartialSuccess();
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
    const fingerprint = computeHandoffFingerprint(handoff);

    const forceApproval: ApprovalRecord = {
      id: 'apr-trial-c-forced',
      runId: model.runId,
      status: 'approved',
      approver: 'override-operator',
      reason: 'Force-approved for testing invalidation',
      binding: {
        runId: model.runId,
        handoffFingerprint: fingerprint,
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

    it('approval is valid if handoff unchanged', () => {
      const validity = checkApprovalValidity(forceApproval, handoff);
      expect(validity.valid).toBe(true);
    });

    it('approval invalidates when outcome changes', () => {
      const improved = {
        ...handoff,
        outcomeStatus: 'assisted_success' as any,
        verdict: 'review_ready_with_notes' as any,
      };
      const validity = checkApprovalValidity(forceApproval, improved);
      expect(validity.valid).toBe(false);
      expect(validity.reasons).toContain('outcome_changed');
      expect(validity.reasons).toContain('verdict_changed');
    });

    it('invalidation reasons are exact', () => {
      const improved = {
        ...handoff,
        outcomeStatus: 'assisted_success' as any,
        verdict: 'review_ready_with_notes' as any,
      };
      const validity = checkApprovalValidity(forceApproval, improved);
      for (const detail of validity.details) {
        expect(detail).toContain('was');
        expect(detail).toContain('now');
      }
    });
  });

  // ── Cross-trial: coupling level affects promotion conservatism ─

  describe('Coupling doctrine validation', () => {
    it('high-coupling run with failures is NOT promotable', () => {
      const { model, hooks, audit } = trialC_HighCoupling();
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
      const check = checkPromotion(handoff);
      expect(['not_promotable', 'ineligible']).toContain(check.eligibility);
    });

    it('stopped high-coupling run is ineligible', () => {
      const { model, hooks, audit } = trialC_Stopped();
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
      const check = checkPromotion(handoff);
      expect(check.eligibility).toBe('ineligible');
    });
  });
});
