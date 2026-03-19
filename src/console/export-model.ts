/**
 * Export Model Derivation — Phase 10D-102
 *
 * Derives a single export-ready model from handoff/outcome/approval truth.
 * This is the canonical projection — all renderers consume this, not raw truth.
 *
 * Rules:
 *   - No new semantics. Only projects existing truth.
 *   - Blockers must survive. Notes get severity classification.
 *   - Approval binding and invalidation must travel intact.
 *   - Never strengthen claims beyond source evidence.
 */

import type { RunHandoff } from '../types/handoff.js';
import type { PromotionCheckResult, ApprovalRecord } from '../types/approval.js';
import type { ApprovalInvalidation } from '../types/approval.js';
import type {
  ExportModel,
  ExportContribution,
  ExportBlocker,
  ExportNote,
  ExportEvidenceRef,
  NoteSeverity,
} from '../types/export.js';
import { nowISO } from '../lib/ids.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Derive a canonical export model from existing truth.
 */
export function deriveExportModel(
  handoff: RunHandoff,
  promotionCheck: PromotionCheckResult,
  approval: ApprovalRecord | null,
  invalidation: ApprovalInvalidation | null,
): ExportModel {
  return {
    // Identity
    runId: handoff.runId,
    featureId: handoff.featureId,
    featureTitle: handoff.featureTitle,

    // Verdicts
    handoffVerdict: handoff.verdict,
    outcomeStatus: handoff.outcomeStatus,
    promotionEligibility: promotionCheck.eligibility,
    approvalStatus: approval?.status ?? 'pending',
    acceptable: handoff.acceptable,
    acceptabilityReason: handoff.acceptabilityReason,

    // Summary
    summary: handoff.summary,
    attemptedGoal: handoff.attemptedGoal,

    // Contributions
    contributions: projectContributions(handoff),
    totalContributions: handoff.totalContributions,
    landedContributions: handoff.landedContributions,
    failedContributions: handoff.failedContributions,
    recoveredContributions: handoff.recoveredContributions,

    // Issues
    blockers: projectBlockers(handoff),
    notes: projectNotes(handoff, promotionCheck),

    // Interventions
    interventionOccurred: handoff.interventions.occurred,
    interventionCount: handoff.interventions.summary.totalActions,
    recoveryOccurred: handoff.recoveredContributions > 0,

    // Approval
    approver: approval?.approver ?? null,
    approvalDecidedAt: approval?.decidedAt ?? null,
    approvalReason: approval?.reason ?? null,
    approvalFingerprint: approval?.binding.handoffFingerprint ?? null,
    approvalValid: invalidation ? invalidation.valid : (approval ? true : null),
    invalidationReasons: invalidation?.reasons ?? [],
    invalidationDetails: invalidation?.details ?? [],

    // Follow-ups
    followUps: handoff.followUps.map(f => ({
      action: f.action,
      reason: f.reason,
      command: f.command,
    })),
    recommendedNextStep: promotionCheck.recommendedAction,

    // Evidence
    evidenceRefs: projectEvidenceRefs(handoff),
    evidenceFingerprint: promotionCheck.handoffFingerprint,

    // Provenance
    generatedAt: nowISO(),
    elapsedMs: handoff.elapsedMs,
  };
}

// ── Projection helpers ──────────────────────────────────────────────

function projectContributions(handoff: RunHandoff): ExportContribution[] {
  return handoff.contributions.map(c => ({
    packetId: c.packetId,
    title: c.title,
    role: c.role,
    status: c.status,
    contributed: c.contributesToResult,
    wasRetried: c.wasRetried,
    wasRecovered: c.wasRecovered,
    hadIntervention: c.hadIntervention,
  }));
}

function projectBlockers(handoff: RunHandoff): ExportBlocker[] {
  return handoff.outstandingIssues
    .filter(i => i.blocksReview)
    .map((i, idx) => ({
      id: i.id ?? `blocker-${idx}`,
      severity: 'review_blocking' as NoteSeverity,
      kind: i.kind,
      description: i.description,
      blocksReview: true,
      recommendedAction: i.recommendedAction,
    }));
}

function projectNotes(
  handoff: RunHandoff,
  promotionCheck: PromotionCheckResult,
): ExportNote[] {
  const notes: ExportNote[] = [];

  // Readiness notes
  for (const n of handoff.reviewReadiness.notes) {
    notes.push({
      severity: classifyNoteSeverity(n.kind),
      description: n.description,
    });
  }

  // Promotion notes
  for (const pn of promotionCheck.notes) {
    // Avoid duplicates
    if (!notes.some(n => n.description === pn)) {
      notes.push({
        severity: classifyPromotionNoteSeverity(pn),
        description: pn,
      });
    }
  }

  // Non-blocking outstanding issues
  for (const i of handoff.outstandingIssues) {
    if (!i.blocksReview) {
      notes.push({
        severity: i.severity === 'critical' ? 'material' : 'caution',
        description: i.description,
      });
    }
  }

  return notes;
}

function classifyNoteSeverity(kind: string): NoteSeverity {
  switch (kind) {
    case 'intervention_occurred':
    case 'recovery_occurred':
      return 'material';
    case 'scope_limitation':
    case 'no_file_evidence':
      return 'caution';
    default:
      return 'informational';
  }
}

function classifyPromotionNoteSeverity(note: string): NoteSeverity {
  if (note.includes('intervention')) return 'material';
  if (note.includes('no file-level') || note.includes('No file-level')) return 'caution';
  return 'informational';
}

function projectEvidenceRefs(handoff: RunHandoff): ExportEvidenceRef[] {
  const refs: ExportEvidenceRef[] = [];

  refs.push({
    type: 'outcome',
    label: 'Run outcome',
    command: `multi-claude console outcome --run ${handoff.runId} --json`,
  });

  refs.push({
    type: 'handoff',
    label: 'Handoff artifact',
    command: `multi-claude console handoff --run ${handoff.runId} --json`,
  });

  refs.push({
    type: 'approval',
    label: 'Approval status',
    command: `multi-claude console approval --run ${handoff.runId} --json`,
  });

  if (handoff.interventions.occurred) {
    refs.push({
      type: 'audit',
      label: 'Audit trail',
      command: `multi-claude console audit --run ${handoff.runId} --json`,
    });
  }

  return refs;
}
