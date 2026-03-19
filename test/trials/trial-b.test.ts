/**
 * Trial B — StudioFlow (Medium Coupling)
 *
 * Tests the full chain on a medium-coupling run with one retry
 * and gate approval. Proves that intervention doesn't collapse
 * handoff truth or block valid promotion.
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import type { ApprovalRecord } from '../../src/types/approval.js';
import { trialB_MediumCoupling, trialB_WithRecovery } from './trial-fixtures.js';

describe('Trial B — StudioFlow (Medium Coupling)', () => {
  // ── Base case: retry but all resolved ─────────────────────────

  describe('With retry (all resolved)', () => {
    const { model, hooks, audit } = trialB_MediumCoupling();

    describe('Outcome', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);

      it('classifies as assisted_success (retry occurred)', () => {
        expect(outcome.status).toBe('assisted_success');
      });

      it('all 6 packets resolved', () => {
        expect(outcome.resolvedCount + outcome.recoveredCount).toBe(6);
        expect(outcome.failedCount).toBe(0);
      });

      it('acceptable', () => {
        expect(outcome.acceptable).toBe(true);
      });

      it('follow-up is review (had intervention)', () => {
        expect(outcome.followUp.kind).toBe('review');
      });
    });

    describe('Handoff', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

      it('verdict is review_ready_with_notes (intervention occurred)', () => {
        expect(handoff.verdict).toBe('review_ready_with_notes');
      });

      it('6 total contributions', () => {
        expect(handoff.totalContributions).toBe(6);
      });

      it('interventions surfaced, not hidden', () => {
        expect(handoff.interventions.occurred).toBe(true);
        expect(handoff.interventions.summary.retries).toBeGreaterThan(0);
      });

      it('readiness has notes about intervention', () => {
        expect(handoff.reviewReadiness.notes.length).toBeGreaterThan(0);
      });

      it('no review-blocking issues', () => {
        expect(handoff.reviewBlockingIssues).toBe(0);
      });
    });

    describe('Promotion', () => {
      const outcome = deriveOutcomeFromModels(model, hooks, audit);
      const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
      const check = checkPromotion(handoff);

      it('is promotable_with_notes (not plain promotable)', () => {
        expect(check.eligibility).toBe('promotable_with_notes');
      });

      it('has notes about the intervention', () => {
        expect(check.notes.length).toBeGreaterThan(0);
      });

      it('still recommends approve command', () => {
        expect(check.recommendedAction).toContain('approve');
      });
    });
  });

  // ── With recovery + gate approval ─────────────────────────────

  describe('With recovery + gate approval', () => {
    const { model, hooks, audit } = trialB_WithRecovery();
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

    it('verdict is review_ready_with_notes', () => {
      expect(handoff.verdict).toBe('review_ready_with_notes');
    });

    it('interventions include retry + gate approval', () => {
      expect(handoff.interventions.summary.retries).toBeGreaterThan(0);
      expect(handoff.interventions.summary.gateApprovals).toBeGreaterThan(0);
    });

    it('promotable_with_notes — recovery does not block promotion', () => {
      const check = checkPromotion(handoff);
      expect(check.eligibility).toBe('promotable_with_notes');
    });
  });

  // ── Approval binding under medium coupling ────────────────────

  describe('Approval binding', () => {
    const { model, hooks, audit } = trialB_MediumCoupling();
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
    const check = checkPromotion(handoff);

    const approval: ApprovalRecord = {
      id: 'apr-trial-b',
      runId: model.runId,
      status: 'approved',
      approver: 'operator',
      reason: 'Canvas retry resolved, all contributions landed',
      binding: {
        runId: model.runId,
        handoffFingerprint: check.handoffFingerprint,
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

    it('valid against same handoff', () => {
      const validity = checkApprovalValidity(approval, handoff);
      expect(validity.valid).toBe(true);
    });

    it('invalidates if post-approval intervention occurs', () => {
      const mutated = {
        ...handoff,
        interventions: {
          ...handoff.interventions,
          significantActions: [
            ...handoff.interventions.significantActions,
            {
              action: 'retry_packet',
              targetType: 'packet' as const,
              targetId: 'sf7--builder-inspector-ui',
              description: 'Inspector UI broke after approval — retry needed',
              timestamp: '2026-03-19T11:00:00Z', // after approval
            },
          ],
        },
      };
      const validity = checkApprovalValidity(approval, mutated);
      expect(validity.valid).toBe(false);
      expect(validity.reasons).toContain('intervention_occurred');
    });
  });
});
