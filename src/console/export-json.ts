/**
 * Export JSON Renderer — Phase 10D-202
 *
 * Machine-readable export for CI, automation, and archival.
 * Stable fields — changes are breaking changes for consumers.
 *
 * Two products:
 *   - Gate verdict: terse, stable, gate-consumable
 *   - Approval snapshot: evidence-bound approval state
 */

import type { ExportModel, ExportGateVerdict, ExportApprovalState } from '../types/export.js';
import { EXPORT_SCHEMA_VERSION } from '../types/export.js';
import { nowISO } from '../lib/ids.js';

// ── Gate verdict ────────────────────────────────────────────────────

/**
 * Produce a stable gate verdict for CI/automation consumption.
 */
export function renderGateVerdict(model: ExportModel): ExportGateVerdict {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    runId: model.runId,
    handoffVerdict: model.handoffVerdict,
    promotionEligibility: model.promotionEligibility,
    approvalStatus: model.approvalStatus,
    approvalFingerprint: model.approvalFingerprint,
    approvalValid: model.approvalValid,
    outcomeStatus: model.outcomeStatus,
    acceptable: model.acceptable,
    hasBlockers: model.blockers.length > 0,
    blockerCount: model.blockers.length,
    blockerKinds: [...new Set(model.blockers.map(b => b.kind))],
    hasNotes: model.notes.length > 0,
    noteCount: model.notes.length,
    noteSeverities: [...new Set(model.notes.map(n => n.severity))],
    interventionOccurred: model.interventionOccurred,
    recoveryOccurred: model.recoveryOccurred,
    recommendedNextStep: model.recommendedNextStep,
    evidenceFingerprint: model.evidenceFingerprint,
    generatedAt: nowISO(),
  };
}

// ── Approval snapshot ───────────────────────────────────────────────

/**
 * Produce a machine-readable approval state snapshot.
 */
export function renderApprovalSnapshot(model: ExportModel): ExportApprovalState {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    runId: model.runId,
    approvalStatus: model.approvalStatus,
    approver: model.approver,
    decidedAt: model.approvalDecidedAt,
    reason: model.approvalReason,
    boundFingerprint: model.approvalFingerprint,
    valid: model.approvalValid,
    invalidationReasons: model.invalidationReasons,
    invalidationDetails: model.invalidationDetails,
    promotionEligibility: model.promotionEligibility,
    blockerCount: model.blockers.length,
    noteCount: model.notes.length,
    generatedAt: nowISO(),
  };
}

// ── Full handoff JSON ───────────────────────────────────────────────

/**
 * Produce a complete handoff export as structured JSON.
 * This is the audit-lane artifact.
 */
export function renderHandoffJson(model: ExportModel): Record<string, unknown> {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    ...model,
    // Override generatedAt to be stable for this render
    generatedAt: nowISO(),
  };
}
