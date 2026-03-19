/**
 * Canonical export types — Phase 10D.
 *
 * Export is a projection layer, not a semantic layer.
 * These types define the portable forms of already-existing truth.
 * No new semantics — only canonical projections.
 *
 * Three export lanes:
 *   - Reviewer (markdown): human-facing decision brief
 *   - Gate (JSON): CI/automation-facing verdict
 *   - Audit (JSON): structured evidence for archival/traceability
 *
 * Invariants:
 *   - Export must never strengthen or weaken internal truth
 *   - Blockers must survive export
 *   - Approval must remain evidence-bound
 *   - Invalidation must remain explicit
 *   - Machine outputs must be stable
 */

import type { HandoffVerdict } from './handoff.js';
import type { RunOutcomeStatus } from './outcome.js';
import type { PromotionEligibility, ApprovalStatus, InvalidationReason } from './approval.js';

// ── Export format and target ────────────────────────────────────────

/** Supported export output formats. */
export type ExportFormat = 'markdown' | 'json';

/** All known export formats, for guard tests. */
export const EXPORT_FORMATS: ReadonlySet<ExportFormat> = new Set([
  'markdown', 'json',
]);

/** What is being exported. */
export type ExportTarget = 'handoff' | 'approval' | 'gate';

/** All known export targets, for guard tests. */
export const EXPORT_TARGETS: ReadonlySet<ExportTarget> = new Set([
  'handoff', 'approval', 'gate',
]);

// ── Note severity (10C finding: enriched for export clarity) ────────

/**
 * Severity classification for notes and issues in exports.
 * Does NOT replace the canonical blocker model — sits alongside it.
 */
export type NoteSeverity =
  | 'informational'   // FYI — no action needed
  | 'caution'         // worth reviewing, not blocking
  | 'material'        // may affect decision, needs attention
  | 'review_blocking'; // blocks review/promotion

/** All known note severities, for guard tests. */
export const NOTE_SEVERITIES: ReadonlySet<NoteSeverity> = new Set([
  'informational', 'caution', 'material', 'review_blocking',
]);

// ── Export section ──────────────────────────────────────────────────

/**
 * A discrete section in a markdown export.
 * Ordered by decision flow, not implementation structure.
 */
export interface ExportSection {
  id: string;
  title: string;
  content: string;
  order: number;
}

// ── Export evidence reference ────────────────────────────────────────

export interface ExportEvidenceRef {
  type: 'outcome' | 'handoff' | 'approval' | 'audit' | 'recovery';
  label: string;
  command: string | null;  // CLI command to inspect source
}

// ── Gate verdict (CI-consumable) ────────────────────────────────────

/**
 * The machine-readable gate verdict for CI/automation consumption.
 * Stable fields — changes here are breaking changes for consumers.
 */
export interface ExportGateVerdict {
  schemaVersion: number;             // increment on breaking field changes
  runId: string;
  handoffVerdict: HandoffVerdict;
  promotionEligibility: PromotionEligibility;
  approvalStatus: ApprovalStatus;
  approvalFingerprint: string | null;
  approvalValid: boolean | null;     // null if no approval exists
  outcomeStatus: RunOutcomeStatus;
  acceptable: boolean;
  hasBlockers: boolean;
  blockerCount: number;
  blockerKinds: string[];
  hasNotes: boolean;
  noteCount: number;
  noteSeverities: NoteSeverity[];
  interventionOccurred: boolean;
  recoveryOccurred: boolean;
  recommendedNextStep: string | null;
  evidenceFingerprint: string | null; // handoff fingerprint
  generatedAt: string;
}

// ── Approval snapshot (machine-readable) ────────────────────────────

/**
 * The machine-readable approval state for downstream consumption.
 */
export interface ExportApprovalState {
  schemaVersion: number;
  runId: string;
  approvalStatus: ApprovalStatus;
  approver: string | null;
  decidedAt: string | null;
  reason: string | null;
  boundFingerprint: string | null;
  valid: boolean | null;
  invalidationReasons: InvalidationReason[];
  invalidationDetails: string[];
  promotionEligibility: PromotionEligibility;
  blockerCount: number;
  noteCount: number;
  generatedAt: string;
}

// ── Export contribution ─────────────────────────────────────────────

/**
 * A single contribution in export form.
 */
export interface ExportContribution {
  packetId: string;
  title: string;
  role: string;
  status: string;
  contributed: boolean;
  wasRetried: boolean;
  wasRecovered: boolean;
  hadIntervention: boolean;
}

// ── Export blocker ──────────────────────────────────────────────────

/**
 * A blocker in export form.
 */
export interface ExportBlocker {
  id: string;
  severity: NoteSeverity;
  kind: string;
  description: string;
  blocksReview: boolean;
  recommendedAction: string | null;
}

// ── Export note ──────────────────────────────────────────────────────

/**
 * A note/caveat in export form.
 */
export interface ExportNote {
  severity: NoteSeverity;
  description: string;
}

// ── Export model (the canonical projection) ─────────────────────────

/**
 * The complete export-ready model derived from handoff/outcome/approval truth.
 * This is the single source for all renderers.
 */
export interface ExportModel {
  // Identity
  runId: string;
  featureId: string;
  featureTitle: string;

  // Verdicts (projected from canonical)
  handoffVerdict: HandoffVerdict;
  outcomeStatus: RunOutcomeStatus;
  promotionEligibility: PromotionEligibility;
  approvalStatus: ApprovalStatus;
  acceptable: boolean;
  acceptabilityReason: string;

  // Summary
  summary: string;
  attemptedGoal: string;

  // Contributions
  contributions: ExportContribution[];
  totalContributions: number;
  landedContributions: number;
  failedContributions: number;
  recoveredContributions: number;

  // Issues
  blockers: ExportBlocker[];
  notes: ExportNote[];

  // Interventions
  interventionOccurred: boolean;
  interventionCount: number;
  recoveryOccurred: boolean;

  // Approval
  approver: string | null;
  approvalDecidedAt: string | null;
  approvalReason: string | null;
  approvalFingerprint: string | null;
  approvalValid: boolean | null;
  invalidationReasons: InvalidationReason[];
  invalidationDetails: string[];

  // Follow-ups
  followUps: Array<{ action: string; reason: string; command: string | null }>;
  recommendedNextStep: string | null;

  // Evidence
  evidenceRefs: ExportEvidenceRef[];
  evidenceFingerprint: string | null;

  // Provenance
  generatedAt: string;
  elapsedMs: number | null;
}

// ── Render options ──────────────────────────────────────────────────

export interface ExportRenderOptions {
  compact?: boolean;        // reduced sections (future use)
  includeEvidence?: boolean; // include evidence reference block
}

// ── Export schema version ───────────────────────────────────────────

/** Current export schema version. Increment on breaking field changes. */
export const EXPORT_SCHEMA_VERSION = 1;
