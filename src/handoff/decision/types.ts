/**
 * Decision Briefs — Phase 3 canonical types.
 *
 * A decision brief is a deterministic judgment frame derived from
 * canonical packet state, approval law, invalidation state, and
 * evidence coverage. It is structured first, human-legible second.
 *
 * Law: the brief is derived, not invented. The model may help phrase
 * or compress, but judgment rails come from deterministic state.
 */

import type { HandoffId, PacketVersion } from '../schema/packet.js';

// ── Decision brief ──────────────────────────────────────────────────

export type DecisionRole = 'reviewer' | 'approver';

export type DecisionAction =
  | 'approve'
  | 'reject'
  | 'request-recovery'
  | 'needs-review';

export type BlockerSeverity = 'high' | 'medium' | 'low';

export interface DecisionBlocker {
  /** Machine-readable blocker code */
  code: string;
  severity: BlockerSeverity;
  /** Human-readable one-line summary */
  summary: string;
}

export interface EvidenceCoverage {
  /** Content hash of the rendered output used for this brief */
  fingerprint: string;
  /** Artifacts that policy requires for this packet type */
  requiredArtifacts: string[];
  /** Artifacts actually present in the packet */
  presentArtifacts: string[];
  /** Artifacts required but missing */
  missingArtifacts: string[];
}

export interface ActionEligibility {
  /** Actions that are legally available given current state */
  allowedActions: DecisionAction[];
  /** The strongest recommended action */
  recommendedAction: DecisionAction;
  /** Why this action is recommended (deterministic reasons, not opinions) */
  rationale: string[];
}

export interface DecisionBrief {
  /** Unique brief ID */
  briefId: string;
  /** Handoff packet this brief is derived from */
  handoffId: HandoffId;
  /** Exact packet version this brief covers */
  packetVersion: PacketVersion;
  /** Baseline version compared against (null = no baseline available) */
  baselinePacketVersion: PacketVersion | null;
  /** Schema version of this brief format */
  briefVersion: string;
  /** When this brief was derived */
  createdAt: string;
  /** Who this brief is for */
  role: DecisionRole;

  /** One-line summary of the packet state */
  summary: string;
  /** What changed relative to baseline (empty if no baseline) */
  deltaSummary: string[];

  /** Hard/soft blockers preventing action */
  blockers: DecisionBlocker[];
  /** Evidence coverage assessment */
  evidenceCoverage: EvidenceCoverage;
  /** What actions are eligible and recommended */
  eligibility: ActionEligibility;

  /** Identified risks (deterministic, from state) */
  risks: string[];
  /** Unresolved items from the packet */
  openLoops: string[];
  /** References to evidence/artifacts for reviewer inspection */
  decisionRefs: string[];
}

// ── Delta ───────────────────────────────────────────────────────────

export interface BaselineDelta {
  /** Baseline version compared against */
  baselineVersion: PacketVersion;
  /** Current version being judged */
  currentVersion: PacketVersion;
  /** Whether the baseline was explicitly approved or just last-valid */
  baselineType: 'approved' | 'last_valid' | 'none';

  /** Changed fields between baseline and current */
  summaryChanged: boolean;
  instructionsChanged: boolean;
  constraintsChanged: boolean;
  prohibitionsChanged: boolean;

  /** Decisions added/removed/changed */
  decisionsAdded: string[];
  decisionsRemoved: string[];

  /** Open loops added/removed */
  openLoopsAdded: string[];
  openLoopsClosed: string[];

  /** Artifacts added/removed */
  artifactsAdded: string[];
  artifactsRemoved: string[];

  /** Human-readable delta lines */
  deltaLines: string[];
}

// ── Decision action record ──────────────────────────────────────────

/**
 * A bound decision action. This is the trace from brief → action.
 * Stored durably — not derived.
 */
export interface DecisionActionRecord {
  /** Unique action ID */
  actionId: string;
  /** Brief this action was taken from */
  briefId: string;
  /** Handoff ID */
  handoffId: HandoffId;
  /** Packet version the action was taken against */
  packetVersion: PacketVersion;
  /** Render event that produced the brief's context */
  renderEventId: number | undefined;
  /** Evidence fingerprint at action time */
  evidenceFingerprint: string;
  /** Brief version used */
  briefVersion: string;
  /** What action was taken */
  action: DecisionAction;
  /** Who took the action */
  actor: string;
  /** Why (human reason) */
  reason: string;
  /** When */
  decidedAt: string;
}

// ── Brief version constant ──────────────────────────────────────────

export const BRIEF_VERSION = '1.0.0';
