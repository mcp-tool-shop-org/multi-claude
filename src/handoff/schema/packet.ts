/**
 * Handoff Spine — Canonical packet schema.
 *
 * The handoff packet is the authoritative, versioned state transfer
 * object for Multi-Claude control plane handoffs. It is stored durably,
 * retrieved by exact ID, and rendered into role-specific working contexts.
 *
 * This is NOT the same as RunHandoff (src/types/handoff.ts), which is
 * a derived, never-stored view of run readiness. The Handoff Spine packet
 * is stored, versioned, and immutable per version.
 */

// ── Branded types ─────────────────────────────────────────────────

export type HandoffId = string;
export type PacketVersion = number;
export type RendererVersion = string;
export type ContentHash = string;

// ── Scope ─────────────────────────────────────────────────────────

export type HandoffLane = 'worker' | 'reviewer' | 'approver' | 'recovery';

export interface HandoffScope {
  projectId: string;
  runId: string;
  sourcePacketId?: string;
  lane?: HandoffLane;
  packetId?: string;
  repoRoot?: string;
}

// ── Instruction layer ─────────────────────────────────────────────

/**
 * Explicit separation of instruction types.
 * Renderers MUST place these into distinct prompt regions.
 */
export interface HandoffInstructionLayer {
  authoritative: string[];
  constraints: string[];
  prohibitions: string[];
}

// ── Decisions ─────────────────────────────────────────────────────

export interface HandoffDecision {
  id: string;
  summary: string;
  rationale: string;
  evidenceRefs?: string[];
}

// ── Rejections ────────────────────────────────────────────────────

export interface HandoffRejection {
  id: string;
  summary: string;
  rationale: string;
}

// ── Open loops ────────────────────────────────────────────────────

export type OpenLoopPriority = 'high' | 'medium' | 'low';

export interface HandoffOpenLoop {
  id: string;
  summary: string;
  priority: OpenLoopPriority;
  ownerRole?: HandoffLane;
}

// ── Artifact references ───────────────────────────────────────────

export type ArtifactKind = 'file' | 'log' | 'diff' | 'report' | 'snapshot';

export interface HandoffArtifactRef {
  id: string;
  name: string;
  kind: ArtifactKind;
  version?: string;
  mediaType?: string;
  contentHash?: string;
  storageRef: string;
  sizeBytes?: number;
}

// ── Packet status ─────────────────────────────────────────────────

export type HandoffPacketStatus = 'active' | 'superseded' | 'invalidated';

// ── The canonical packet ──────────────────────────────────────────

export interface HandoffPacket {
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  createdAt: string;
  derivedFromRunId: string;
  scope: HandoffScope;

  summary: string;
  instructions: HandoffInstructionLayer;
  decisions: HandoffDecision[];
  rejected: HandoffRejection[];
  openLoops: HandoffOpenLoop[];
  artifacts: HandoffArtifactRef[];

  contentHash: ContentHash;
}

// ── Packet identity (DB row, not versioned content) ───────────────

export interface HandoffPacketRecord {
  handoffId: HandoffId;
  projectId: string;
  runId: string;
  currentVersion: PacketVersion;
  status: HandoffPacketStatus;
  createdAt: string;
  updatedAt: string;
}
