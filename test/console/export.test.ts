/**
 * Export Tests — Phase 10D-203
 *
 * Tests export derivation, markdown rendering, JSON rendering,
 * and the core invariants (blockers survive, invalidation explicit,
 * approval bound, no strengthening beyond source).
 */

import { describe, it, expect } from 'vitest';
import { deriveOutcomeFromModels } from '../../src/console/run-outcome.js';
import { deriveHandoffFromModels } from '../../src/console/run-handoff.js';
import { checkPromotion, computeHandoffFingerprint } from '../../src/console/promotion-check.js';
import { checkApprovalValidity } from '../../src/console/approval-invalidation.js';
import { deriveExportModel } from '../../src/console/export-model.js';
import { renderMarkdownHandoff, renderMarkdownApproval } from '../../src/console/export-markdown.js';
import { renderGateVerdict, renderApprovalSnapshot, renderHandoffJson } from '../../src/console/export-json.js';
import type { ApprovalRecord, ApprovalInvalidation } from '../../src/types/approval.js';
import type { ExportModel } from '../../src/types/export.js';
import {
  trialA_CleanRun,
  trialB_MediumCoupling,
  trialC_HighCoupling,
  trialC_Stopped,
} from '../trials/trial-fixtures.js';

// ── Helpers ─────────────────────────────────────────────────────────

function deriveAll(fixture: ReturnType<typeof trialA_CleanRun>) {
  const outcome = deriveOutcomeFromModels(fixture.model, fixture.hooks, fixture.audit);
  const handoff = deriveHandoffFromModels(fixture.model, outcome, fixture.hooks, fixture.audit);
  const promotion = checkPromotion(handoff);
  return { outcome, handoff, promotion };
}

function makeExportModel(
  fixture: ReturnType<typeof trialA_CleanRun>,
  approval: ApprovalRecord | null = null,
  invalidation: ApprovalInvalidation | null = null,
): ExportModel {
  const { handoff, promotion } = deriveAll(fixture);
  return deriveExportModel(handoff, promotion, approval, invalidation);
}

function makeApprovalRecord(fixture: ReturnType<typeof trialA_CleanRun>): ApprovalRecord {
  const { handoff, promotion } = deriveAll(fixture);
  return {
    id: 'apr-test',
    runId: handoff.runId,
    status: 'approved',
    approver: 'test-operator',
    reason: 'Approved for testing',
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

// ── Export model derivation ─────────────────────────────────────────

describe('Export model derivation', () => {
  it('projects handoff verdict faithfully', () => {
    const modelA = makeExportModel(trialA_CleanRun());
    expect(modelA.handoffVerdict).toBe('review_ready');

    const modelB = makeExportModel(trialB_MediumCoupling());
    expect(modelB.handoffVerdict).toBe('review_ready_with_notes');
  });

  it('projects promotion eligibility faithfully', () => {
    const modelA = makeExportModel(trialA_CleanRun());
    expect(modelA.promotionEligibility).toBe('promotable');

    const modelC = makeExportModel(trialC_HighCoupling());
    expect(['not_promotable', 'ineligible']).toContain(modelC.promotionEligibility);
  });

  it('projects contributions matching packet count', () => {
    const modelA = makeExportModel(trialA_CleanRun());
    expect(modelA.contributions.length).toBe(5);

    const modelC = makeExportModel(trialC_HighCoupling());
    expect(modelC.contributions.length).toBe(8);
  });

  it('projects blockers for high-coupling failure', () => {
    const model = makeExportModel(trialC_HighCoupling());
    expect(model.blockers.length).toBeGreaterThan(0);
    for (const b of model.blockers) {
      expect(b.blocksReview).toBe(true);
      expect(b.severity).toBe('review_blocking');
    }
  });

  it('projects approval state when present', () => {
    const approval = makeApprovalRecord(trialA_CleanRun());
    const model = makeExportModel(trialA_CleanRun(), approval);
    expect(model.approvalStatus).toBe('approved');
    expect(model.approver).toBe('test-operator');
    expect(model.approvalFingerprint).toBeTruthy();
  });

  it('projects pending approval when no approval exists', () => {
    const model = makeExportModel(trialA_CleanRun());
    expect(model.approvalStatus).toBe('pending');
    expect(model.approver).toBeNull();
  });

  it('projects invalidation state', () => {
    const fixture = trialA_CleanRun();
    const approval = makeApprovalRecord(fixture);
    const { handoff } = deriveAll(fixture);
    // Simulate invalidation
    const invalidation: ApprovalInvalidation = {
      valid: false,
      approvalId: approval.id,
      reasons: ['outcome_changed'],
      details: ['Outcome status changed: was clean_success, now terminal_failure'],
      currentFingerprint: 'changed',
      boundFingerprint: approval.binding.handoffFingerprint,
    };
    const model = deriveExportModel(handoff, checkPromotion(handoff), approval, invalidation);
    expect(model.approvalValid).toBe(false);
    expect(model.invalidationReasons).toContain('outcome_changed');
  });
});

// ── Invariant 1: Export never strengthens/weakens truth ─────────────

describe('Export fidelity invariant', () => {
  it('review_ready_with_notes does NOT export as plain review_ready', () => {
    const model = makeExportModel(trialB_MediumCoupling());
    expect(model.handoffVerdict).toBe('review_ready_with_notes');
    expect(model.notes.length).toBeGreaterThan(0);
  });

  it('failed contributions are flagged, not hidden', () => {
    const model = makeExportModel(trialC_HighCoupling());
    const failed = model.contributions.filter(c => !c.contributed);
    expect(failed.length).toBeGreaterThan(0);
  });
});

// ── Invariant 2: Blockers survive export ────────────────────────────

describe('Blocker survival invariant', () => {
  it('blockers appear in markdown', () => {
    const model = makeExportModel(trialC_HighCoupling());
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Blockers');
    for (const b of model.blockers) {
      expect(md).toContain(b.description);
    }
  });

  it('blockers appear in gate verdict', () => {
    const model = makeExportModel(trialC_HighCoupling());
    const gate = renderGateVerdict(model);
    expect(gate.hasBlockers).toBe(true);
    expect(gate.blockerCount).toBeGreaterThan(0);
    expect(gate.blockerKinds.length).toBeGreaterThan(0);
  });
});

// ── Invariant 3: Approval remains evidence-bound ────────────────────

describe('Approval binding invariant', () => {
  it('gate verdict carries approval fingerprint', () => {
    const approval = makeApprovalRecord(trialA_CleanRun());
    const model = makeExportModel(trialA_CleanRun(), approval);
    const gate = renderGateVerdict(model);
    expect(gate.approvalFingerprint).toBe(approval.binding.handoffFingerprint);
  });

  it('approval snapshot carries bound fingerprint', () => {
    const approval = makeApprovalRecord(trialA_CleanRun());
    const model = makeExportModel(trialA_CleanRun(), approval);
    const snapshot = renderApprovalSnapshot(model);
    expect(snapshot.boundFingerprint).toBe(approval.binding.handoffFingerprint);
  });
});

// ── Invariant 4: Invalidation remains explicit ──────────────────────

describe('Invalidation explicitness invariant', () => {
  it('invalidated approval never exports as plain "approved" in markdown', () => {
    const fixture = trialA_CleanRun();
    const approval = makeApprovalRecord(fixture);
    const { handoff } = deriveAll(fixture);
    const invalidation: ApprovalInvalidation = {
      valid: false,
      approvalId: approval.id,
      reasons: ['outcome_changed'],
      details: ['Outcome changed'],
      currentFingerprint: 'changed',
      boundFingerprint: approval.binding.handoffFingerprint,
    };
    approval.status = 'invalidated';
    const model = deriveExportModel(handoff, checkPromotion(handoff), approval, invalidation);
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('INVALIDATED');
    expect(md).toContain('invalidated');
  });

  it('invalidated approval never exports as valid=true in JSON', () => {
    const fixture = trialA_CleanRun();
    const approval = makeApprovalRecord(fixture);
    const { handoff } = deriveAll(fixture);
    const invalidation: ApprovalInvalidation = {
      valid: false,
      approvalId: approval.id,
      reasons: ['outcome_changed'],
      details: ['Outcome changed'],
      currentFingerprint: 'changed',
      boundFingerprint: approval.binding.handoffFingerprint,
    };
    approval.status = 'invalidated';
    const model = deriveExportModel(handoff, checkPromotion(handoff), approval, invalidation);
    const gate = renderGateVerdict(model);
    expect(gate.approvalValid).toBe(false);

    const snapshot = renderApprovalSnapshot(model);
    expect(snapshot.valid).toBe(false);
    expect(snapshot.invalidationReasons.length).toBeGreaterThan(0);
  });
});

// ── Invariant 5: Machine output stability ───────────────────────────

describe('Machine output stability', () => {
  it('gate verdict has schemaVersion', () => {
    const model = makeExportModel(trialA_CleanRun());
    const gate = renderGateVerdict(model);
    expect(gate.schemaVersion).toBe(1);
  });

  it('approval snapshot has schemaVersion', () => {
    const model = makeExportModel(trialA_CleanRun());
    const snapshot = renderApprovalSnapshot(model);
    expect(snapshot.schemaVersion).toBe(1);
  });

  it('gate verdict JSON is deterministic for same input', () => {
    const model = makeExportModel(trialA_CleanRun());
    const gate1 = renderGateVerdict(model);
    const gate2 = renderGateVerdict(model);
    // All fields except generatedAt should match
    expect(gate1.runId).toBe(gate2.runId);
    expect(gate1.handoffVerdict).toBe(gate2.handoffVerdict);
    expect(gate1.promotionEligibility).toBe(gate2.promotionEligibility);
    expect(gate1.approvalStatus).toBe(gate2.approvalStatus);
    expect(gate1.blockerCount).toBe(gate2.blockerCount);
  });

  it('gate verdict contains all required CI fields', () => {
    const model = makeExportModel(trialA_CleanRun());
    const gate = renderGateVerdict(model);
    const requiredFields = [
      'schemaVersion', 'runId', 'handoffVerdict', 'promotionEligibility',
      'approvalStatus', 'outcomeStatus', 'acceptable', 'hasBlockers',
      'blockerCount', 'recommendedNextStep', 'generatedAt',
    ];
    for (const field of requiredFields) {
      expect(gate).toHaveProperty(field);
    }
  });
});

// ── Invariant 6: Human output grounded ──────────────────────────────

describe('Human output grounding', () => {
  it('markdown contains verdict section', () => {
    const model = makeExportModel(trialA_CleanRun());
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Handoff:');
    expect(md).toContain('REVIEW READY');
  });

  it('markdown contains contribution table', () => {
    const model = makeExportModel(trialA_CleanRun());
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Contributions');
    expect(md).toContain('| Packet');
  });

  it('markdown surfaces interventions for medium-coupling run', () => {
    const model = makeExportModel(trialB_MediumCoupling());
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Interventions');
    expect(md).toContain('operator intervention');
  });

  it('markdown contains evidence references', () => {
    const model = makeExportModel(trialA_CleanRun());
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Evidence References');
    expect(md).toContain('console outcome');
  });

  it('markdown approval section renders correctly', () => {
    const approval = makeApprovalRecord(trialA_CleanRun());
    const model = makeExportModel(trialA_CleanRun(), approval);
    const md = renderMarkdownHandoff(model);
    expect(md).toContain('Approval');
    expect(md).toContain('APPROVED');
    expect(md).toContain('test-operator');
  });

  it('markdown approval summary works standalone', () => {
    const approval = makeApprovalRecord(trialA_CleanRun());
    const model = makeExportModel(trialA_CleanRun(), approval);
    const md = renderMarkdownApproval(model);
    expect(md).toContain('Approval Summary');
    expect(md).toContain('APPROVED');
  });
});

// ── Rendering across coupling levels ────────────────────────────────

describe('Rendering across coupling levels', () => {
  it('all trials render markdown without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const model = makeExportModel(fixture);
      const md = renderMarkdownHandoff(model);
      expect(md.length).toBeGreaterThan(100);
      expect(md).toContain('Handoff:');
    }
  });

  it('all trials render gate verdict without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const model = makeExportModel(fixture);
      const gate = renderGateVerdict(model);
      expect(gate.schemaVersion).toBe(1);
      expect(gate.runId).toBeTruthy();
    }
  });

  it('all trials render handoff JSON without errors', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling(), trialC_Stopped()]) {
      const model = makeExportModel(fixture);
      const json = renderHandoffJson(model);
      expect(json).toHaveProperty('schemaVersion', 1);
      expect(json).toHaveProperty('runId');
    }
  });

  it('JSON roundtrips cleanly for all exports', () => {
    for (const fixture of [trialA_CleanRun(), trialB_MediumCoupling(), trialC_HighCoupling()]) {
      const model = makeExportModel(fixture);
      const gate = renderGateVerdict(model);
      const parsed = JSON.parse(JSON.stringify(gate));
      expect(parsed.handoffVerdict).toBe(gate.handoffVerdict);
      expect(parsed.promotionEligibility).toBe(gate.promotionEligibility);
    }
  });
});
