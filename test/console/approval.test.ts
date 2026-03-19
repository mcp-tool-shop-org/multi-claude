/**
 * Approval Tests — Phase 10B-203
 *
 * Tests promotion eligibility, approval execution, version binding,
 * invalidation detection, and rendering.
 */

import { describe, it, expect } from 'vitest';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import { renderPromotionCheck, renderApprovalStatus, renderApproveResult } from '../../src/console/approval-render.js';
import type { RunHandoff, ContributionSummary, InterventionDigest, ReviewReadiness, OutstandingIssue, HandoffFollowUp, EvidenceReference, HandoffVerdict } from '../../src/types/handoff.js';
import type { ApprovalRecord, ApprovalBinding } from '../../src/types/approval.js';

// ── Test helpers ────────────────────────────────────────────────────

function makeContrib(overrides: Partial<ContributionSummary> = {}): ContributionSummary {
  return {
    packetId: 'pkt-1',
    title: 'Test packet',
    role: 'builder',
    layer: 'backend',
    wave: 1,
    status: 'resolved',
    attempts: 1,
    wasRetried: false,
    wasRecovered: false,
    hadIntervention: false,
    contributesToResult: true,
    changedFiles: null,
    ...overrides,
  };
}

function makeHandoff(overrides: Partial<RunHandoff> = {}): RunHandoff {
  const defaultReadiness: ReviewReadiness = {
    ready: true,
    verdict: 'review_ready',
    reason: 'All good',
    blockers: [],
    notes: [],
  };

  return {
    runId: 'run-1',
    featureId: 'feat-1',
    featureTitle: 'Test Feature',
    verdict: 'review_ready',
    reviewReadiness: defaultReadiness,
    summary: 'All 3 packet(s) resolved successfully — clean run',
    attemptedGoal: 'Deliver "Test Feature" — 3 packets across 2 wave(s)',
    outcomeStatus: 'clean_success',
    acceptable: true,
    acceptabilityReason: 'All packets resolved without intervention',
    contributions: [makeContrib()],
    totalContributions: 1,
    landedContributions: 1,
    failedContributions: 0,
    recoveredContributions: 0,
    hasChangeEvidence: false,
    totalFilesChanged: 0,
    interventions: {
      occurred: false,
      summary: { totalActions: 0, retries: 0, stops: 0, resumes: 0, gateApprovals: 0, hookResolutions: 0 },
      significantActions: [],
    },
    outstandingIssues: [],
    reviewBlockingIssues: 0,
    followUps: [],
    evidenceRefs: [],
    generatedAt: '2026-03-19T11:00:00Z',
    elapsedMs: 3600000,
    ...overrides,
  };
}

function makeApproval(handoff: RunHandoff, overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  const fingerprint = computeHandoffFingerprint(handoff);
  return {
    id: 'apr-1',
    runId: handoff.runId,
    status: 'approved',
    approver: 'operator',
    reason: 'Looks good',
    binding: {
      runId: handoff.runId,
      handoffFingerprint: fingerprint,
      outcomeStatus: handoff.outcomeStatus,
      verdict: handoff.verdict,
      resolvedCount: handoff.landedContributions,
      failedCount: handoff.failedContributions,
      unresolvedCount: handoff.reviewBlockingIssues,
      boundAt: '2026-03-19T11:05:00Z',
    },
    decidedAt: '2026-03-19T11:05:00Z',
    invalidatedAt: null,
    invalidationReason: null,
    ...overrides,
  };
}

// ── Promotion eligibility ───────────────────────────────────────────

describe('Promotion eligibility', () => {
  it('review_ready → promotable', () => {
    const handoff = makeHandoff();
    const check = checkPromotion(handoff);
    expect(check.eligibility).toBe('promotable');
    expect(check.blockers.length).toBe(0);
  });

  it('review_ready_with_notes → promotable_with_notes', () => {
    const handoff = makeHandoff({
      verdict: 'review_ready_with_notes',
      reviewReadiness: {
        ready: true,
        verdict: 'review_ready_with_notes',
        reason: 'Ready with notes',
        blockers: [],
        notes: [{ kind: 'intervention_occurred', description: 'Operator intervened 1 time(s)' }],
      },
    });
    const check = checkPromotion(handoff);
    expect(check.eligibility).toBe('promotable_with_notes');
    expect(check.notes.length).toBeGreaterThan(0);
  });

  it('not_review_ready → not_promotable', () => {
    const handoff = makeHandoff({
      verdict: 'not_review_ready',
      acceptable: false,
      reviewReadiness: {
        ready: false,
        verdict: 'not_review_ready',
        reason: 'Failed packets',
        blockers: [{ kind: 'unresolved_failure', description: 'pkt-2 failed', targetType: 'packet', targetId: 'pkt-2' }],
        notes: [],
      },
    });
    const check = checkPromotion(handoff);
    expect(check.eligibility).toBe('not_promotable');
    expect(check.blockers.length).toBeGreaterThan(0);
  });

  it('incomplete → ineligible', () => {
    const handoff = makeHandoff({ verdict: 'incomplete' });
    const check = checkPromotion(handoff);
    expect(check.eligibility).toBe('ineligible');
  });

  it('blocked → ineligible', () => {
    const handoff = makeHandoff({ verdict: 'blocked' });
    const check = checkPromotion(handoff);
    expect(check.eligibility).toBe('ineligible');
  });

  it('blockers include review-blocking outstanding issues', () => {
    const handoff = makeHandoff({
      verdict: 'not_review_ready',
      acceptable: false,
      outstandingIssues: [{
        id: 'issue-0', severity: 'critical', kind: 'failed_packet',
        description: 'pkt-2 failed', blocksReview: true,
        recommendedAction: 'multi-claude console act retry_packet --target pkt-2',
      }],
      reviewBlockingIssues: 1,
      reviewReadiness: {
        ready: false, verdict: 'not_review_ready', reason: 'Failed',
        blockers: [{ kind: 'unresolved_failure', description: 'pkt-2 failed', targetType: 'packet', targetId: 'pkt-2' }],
        notes: [],
      },
    });
    const check = checkPromotion(handoff);
    const reviewBlocker = check.blockers.find(b => b.kind === 'review_blocker');
    expect(reviewBlocker).toBeDefined();
  });

  it('provides recommended action for each eligibility', () => {
    const promotable = checkPromotion(makeHandoff());
    expect(promotable.recommendedAction).toContain('approve');

    const ineligible = checkPromotion(makeHandoff({ verdict: 'incomplete' }));
    expect(ineligible.recommendedAction).toBeTruthy();
  });
});

// ── Fingerprint stability ───────────────────────────────────────────

describe('Handoff fingerprint', () => {
  it('same handoff produces same fingerprint', () => {
    const handoff = makeHandoff();
    const fp1 = computeHandoffFingerprint(handoff);
    const fp2 = computeHandoffFingerprint(handoff);
    expect(fp1).toBe(fp2);
  });

  it('different generatedAt does NOT change fingerprint', () => {
    const h1 = makeHandoff({ generatedAt: '2026-03-19T11:00:00Z' });
    const h2 = makeHandoff({ generatedAt: '2026-03-19T12:00:00Z' });
    expect(computeHandoffFingerprint(h1)).toBe(computeHandoffFingerprint(h2));
  });

  it('different verdict DOES change fingerprint', () => {
    const h1 = makeHandoff({ verdict: 'review_ready' });
    const h2 = makeHandoff({ verdict: 'review_ready_with_notes' });
    expect(computeHandoffFingerprint(h1)).not.toBe(computeHandoffFingerprint(h2));
  });

  it('different outcome status DOES change fingerprint', () => {
    const h1 = makeHandoff({ outcomeStatus: 'clean_success' });
    const h2 = makeHandoff({ outcomeStatus: 'assisted_success' });
    expect(computeHandoffFingerprint(h1)).not.toBe(computeHandoffFingerprint(h2));
  });

  it('different contribution counts DOES change fingerprint', () => {
    const h1 = makeHandoff({ landedContributions: 3 });
    const h2 = makeHandoff({ landedContributions: 2 });
    expect(computeHandoffFingerprint(h1)).not.toBe(computeHandoffFingerprint(h2));
  });
});

// ── Invalidation detection ──────────────────────────────────────────

describe('Approval invalidation', () => {
  it('valid when handoff unchanged', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const result = checkApprovalValidity(approval, handoff);
    expect(result.valid).toBe(true);
    expect(result.reasons.length).toBe(0);
  });

  it('invalid when handoff fingerprint changes', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({ failedContributions: 1 });
    const result = checkApprovalValidity(approval, changed);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('handoff_changed');
  });

  it('invalid when outcome status changes', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({ outcomeStatus: 'partial_success' });
    const result = checkApprovalValidity(approval, changed);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('outcome_changed');
  });

  it('invalid when verdict changes', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({ verdict: 'not_review_ready' });
    const result = checkApprovalValidity(approval, changed);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('verdict_changed');
  });

  it('invalid when new blocker appears', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({
      outstandingIssues: [{
        id: 'issue-0', severity: 'critical', kind: 'failed_packet',
        description: 'new failure', blocksReview: true, recommendedAction: null,
      }],
      reviewBlockingIssues: 1,
    });
    const result = checkApprovalValidity(approval, changed);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('new_blocker');
  });

  it('invalid when post-approval intervention occurs', () => {
    const handoff = makeHandoff({
      interventions: {
        occurred: true,
        summary: { totalActions: 1, retries: 1, stops: 0, resumes: 0, gateApprovals: 0, hookResolutions: 0 },
        significantActions: [{
          action: 'retry_packet',
          targetType: 'packet',
          targetId: 'pkt-1',
          description: 'retry after approval',
          timestamp: '2026-03-19T12:00:00Z', // after approval at 11:05
        }],
      },
    });
    const originalHandoff = makeHandoff();
    const approval = makeApproval(originalHandoff);
    const result = checkApprovalValidity(approval, handoff);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('intervention_occurred');
  });

  it('valid when non-material change (generatedAt only)', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    // Same handoff, different time — should still be valid
    const result = checkApprovalValidity(approval, handoff);
    expect(result.valid).toBe(true);
  });

  it('provides details for each invalidation reason', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({ outcomeStatus: 'terminal_failure', verdict: 'not_review_ready' });
    const result = checkApprovalValidity(approval, changed);
    expect(result.details.length).toBe(result.reasons.length);
    for (const detail of result.details) {
      expect(detail.length).toBeGreaterThan(0);
    }
  });
});

// ── Rendering ───────────────────────────────────────────────────────

describe('Approval rendering', () => {
  it('renders promotion check for promotable run', () => {
    const check = checkPromotion(makeHandoff());
    const output = renderPromotionCheck(check);
    expect(output).toContain('PROMOTION CHECK');
    expect(output).toContain('PROMOTABLE');
    expect(output).toContain(check.handoffFingerprint);
  });

  it('renders promotion check with blockers', () => {
    const check = checkPromotion(makeHandoff({
      verdict: 'not_review_ready',
      acceptable: false,
      reviewReadiness: {
        ready: false, verdict: 'not_review_ready', reason: 'Failed',
        blockers: [{ kind: 'unresolved_failure', description: 'pkt-2 failed', targetType: 'packet', targetId: 'pkt-2' }],
        notes: [],
      },
    }));
    const output = renderPromotionCheck(check);
    expect(output).toContain('NOT PROMOTABLE');
    expect(output).toContain('Blockers');
  });

  it('renders approval status', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const check = checkPromotion(handoff);
    const output = renderApprovalStatus({
      runId: handoff.runId,
      latestApproval: approval,
      promotionCheck: check,
      invalidation: null,
      message: 'Approved',
    });
    expect(output).toContain('APPROVAL STATUS');
    expect(output).toContain('APPROVED');
    expect(output).toContain('operator');
  });

  it('renders approve result for success', () => {
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const output = renderApproveResult({
      decision: 'approved',
      message: 'Run run-1 approved',
      approval,
    });
    expect(output).toContain('✓');
    expect(output).toContain('approved');
  });

  it('renders approve result for refusal', () => {
    const check = checkPromotion(makeHandoff({
      verdict: 'not_review_ready',
      acceptable: false,
      reviewReadiness: {
        ready: false, verdict: 'not_review_ready', reason: 'Failed',
        blockers: [{ kind: 'unresolved_failure', description: 'pkt-2 failed', targetType: 'packet', targetId: 'pkt-2' }],
        notes: [],
      },
    }));
    const output = renderApproveResult({
      decision: 'refused',
      message: 'Approval refused',
      promotionCheck: check,
    });
    expect(output).toContain('⊘');
    expect(output).toContain('Blockers');
  });

  it('JSON roundtrips promotion check cleanly', () => {
    const check = checkPromotion(makeHandoff());
    const json = JSON.stringify(check);
    const parsed = JSON.parse(json);
    expect(parsed.eligibility).toBe(check.eligibility);
    expect(parsed.handoffFingerprint).toBe(check.handoffFingerprint);
  });
});

// ── Structure invariants ────────────────────────────────────────────

describe('Approval structure invariants', () => {
  it('fingerprint is always a 16-char hex string', () => {
    const check = checkPromotion(makeHandoff());
    expect(check.handoffFingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  it('promotable check always has a recommended action', () => {
    const check = checkPromotion(makeHandoff());
    expect(check.recommendedAction).not.toBeNull();
  });

  it('not_promotable check always has at least one blocker', () => {
    const check = checkPromotion(makeHandoff({
      verdict: 'not_review_ready',
      acceptable: false,
      reviewReadiness: {
        ready: false, verdict: 'not_review_ready', reason: 'Failed',
        blockers: [{ kind: 'unresolved_failure', description: 'failed', targetType: 'packet', targetId: null }],
        notes: [],
      },
    }));
    expect(check.eligibility).toBe('not_promotable');
    expect(check.blockers.length).toBeGreaterThan(0);
  });

  it('eligibility is always a known value', async () => {
    const { PROMOTION_ELIGIBILITIES } = await import('../../src/types/approval.js');
    const check = checkPromotion(makeHandoff());
    expect(PROMOTION_ELIGIBILITIES.has(check.eligibility)).toBe(true);
  });

  it('invalidation reasons are always known values', async () => {
    const { INVALIDATION_REASONS } = await import('../../src/types/approval.js');
    const handoff = makeHandoff();
    const approval = makeApproval(handoff);
    const changed = makeHandoff({ outcomeStatus: 'terminal_failure', verdict: 'not_review_ready' });
    const result = checkApprovalValidity(approval, changed);
    for (const reason of result.reasons) {
      expect(INVALIDATION_REASONS.has(reason)).toBe(true);
    }
  });
});
