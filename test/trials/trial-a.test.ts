/**
 * Trial A — Claude Guardian (Low Coupling)
 *
 * Tests the full 9A–10B chain on a clean, low-coupling run.
 * This is the control trial: if this doesn't work, nothing works.
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import type { ApprovalRecord } from '../../src/types/approval.js';
import { trialA_CleanRun } from './trial-fixtures.js';

describe('Trial A — Claude Guardian (Low Coupling)', () => {
  const { model, hooks, audit } = trialA_CleanRun();

  // ── Outcome derivation ────────────────────────────────────────

  describe('Outcome', () => {
    const outcome = deriveOutcomeFromModels(model, hooks, audit);

    it('classifies as clean_success', () => {
      expect(outcome.status).toBe('clean_success');
    });

    it('all 5 packets resolved', () => {
      expect(outcome.resolvedCount).toBe(5);
      expect(outcome.failedCount).toBe(0);
      expect(outcome.recoveredCount).toBe(0);
    });

    it('no unresolved items', () => {
      expect(outcome.unresolvedItems.length).toBe(0);
    });

    it('no interventions', () => {
      expect(outcome.interventions.totalActions).toBe(0);
    });

    it('acceptable', () => {
      expect(outcome.acceptable).toBe(true);
    });

    it('follow-up is none', () => {
      expect(outcome.followUp.kind).toBe('none');
    });
  });

  // ── Handoff derivation ────────────────────────────────────────

  describe('Handoff', () => {
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);

    it('verdict is review_ready', () => {
      expect(handoff.verdict).toBe('review_ready');
    });

    it('5 landed contributions', () => {
      expect(handoff.landedContributions).toBe(5);
      expect(handoff.failedContributions).toBe(0);
    });

    it('no outstanding issues', () => {
      expect(handoff.outstandingIssues.length).toBe(0);
      expect(handoff.reviewBlockingIssues).toBe(0);
    });

    it('no interventions', () => {
      expect(handoff.interventions.occurred).toBe(false);
    });

    it('summary is meaningful', () => {
      expect(handoff.summary.length).toBeGreaterThan(10);
    });

    it('contributions list all packets with roles', () => {
      expect(handoff.contributions.length).toBe(5);
      const roles = new Set(handoff.contributions.map(c => c.role));
      expect(roles.has('builder')).toBe(true);
      expect(roles.has('verifier')).toBe(true);
    });
  });

  // ── Promotion check ───────────────────────────────────────────

  describe('Promotion', () => {
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
    const check = checkPromotion(handoff);

    it('is promotable', () => {
      expect(check.eligibility).toBe('promotable');
    });

    it('no blockers', () => {
      expect(check.blockers.length).toBe(0);
    });

    it('recommends approve command', () => {
      expect(check.recommendedAction).toContain('approve');
    });

    it('fingerprint is stable', () => {
      const fp1 = computeHandoffFingerprint(handoff);
      const fp2 = computeHandoffFingerprint(handoff);
      expect(fp1).toBe(fp2);
    });
  });

  // ── Approval binding + invalidation ───────────────────────────

  describe('Approval binding', () => {
    const outcome = deriveOutcomeFromModels(model, hooks, audit);
    const handoff = deriveHandoffFromModels(model, outcome, hooks, audit);
    const check = checkPromotion(handoff);

    const approval: ApprovalRecord = {
      id: 'apr-trial-a',
      runId: model.runId,
      status: 'approved',
      approver: 'operator',
      reason: 'Clean run, all packets landed',
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

    it('approval is valid against same handoff', () => {
      const validity = checkApprovalValidity(approval, handoff);
      expect(validity.valid).toBe(true);
      expect(validity.reasons.length).toBe(0);
    });

    it('approval remains valid with different generatedAt', () => {
      const laterHandoff = { ...handoff, generatedAt: '2026-03-19T12:00:00Z' };
      const validity = checkApprovalValidity(approval, laterHandoff);
      expect(validity.valid).toBe(true);
    });

    it('approval invalidates if a packet fails post-approval', () => {
      const degradedHandoff = {
        ...handoff,
        outcomeStatus: 'partial_success' as any,
        failedContributions: 1,
        landedContributions: 4,
        verdict: 'not_review_ready' as any,
      };
      const validity = checkApprovalValidity(approval, degradedHandoff);
      expect(validity.valid).toBe(false);
      expect(validity.reasons.length).toBeGreaterThan(0);
    });
  });
});
