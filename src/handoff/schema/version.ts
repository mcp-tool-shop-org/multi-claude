/**
 * Handoff Spine — Versioning and lineage types.
 */

import type { HandoffId, PacketVersion, ContentHash } from './packet.js';

// ── Lineage ───────────────────────────────────────────────────────

export type LineageRelation =
  | 'derived_from'
  | 'supersedes'
  | 'split_from'
  | 'recovery_from';

export interface HandoffLineageRecord {
  id?: number;
  handoffId: HandoffId;
  parentHandoffId?: string;
  relation: LineageRelation;
  createdAt: string;
}

// ── Invalidation ──────────────────────────────────────────────────

export type InvalidationReasonCode =
  | 'schema_drift'
  | 'execution_diverged'
  | 'approval_revoked'
  | 'superseded'
  | 'manual'
  | 'integrity_failure';

export interface HandoffInvalidationRecord {
  id?: number;
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  reasonCode: InvalidationReasonCode;
  reason: string;
  invalidatedAt: string;
}

// ── Approval binding ──────────────────────────────────────────────

export type HandoffApprovalType =
  | 'handoff_approval'
  | 'packet_truth_binding'
  | 'render_authorization';

export type HandoffApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked';

export interface HandoffApprovalRecord {
  id?: number;
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  approvalType: HandoffApprovalType;
  approvalStatus: HandoffApprovalStatus;
  approvedBy?: string;
  evidenceFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Version snapshot (DB row) ─────────────────────────────────────

export interface HandoffPacketVersionRow {
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  createdAt: string;
  summary: string;
  instructionsJson: string;
  decisionsJson: string;
  rejectedJson: string;
  openLoopsJson: string;
  artifactsJson: string;
  scopeJson: string;
  contentHash: ContentHash;
}
