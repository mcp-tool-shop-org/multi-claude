/**
 * Decision Briefs — Baseline delta derivation.
 *
 * A packet should rarely be judged in isolation. The brief compares
 * the candidate against the most relevant trusted baseline:
 *   1. Last approved packet version
 *   2. Else last valid (non-invalidated) packet version
 *   3. Else no baseline, explicitly marked
 *
 * This answers the real review question:
 *   "what changed since the last thing we trusted?"
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket, HandoffId, PacketVersion } from '../schema/packet.js';
import type { BaselineDelta } from './types.js';

// ── Baseline resolution ─────────────────────────────────────────────

export interface ResolvedBaseline {
  /** The baseline packet (null = no baseline available) */
  packet: HandoffPacket | null;
  /** The baseline version (null = none) */
  version: PacketVersion | null;
  /** How the baseline was chosen */
  type: 'approved' | 'last_valid' | 'none';
}

/**
 * Find the most relevant trusted baseline for a given handoff.
 *
 * Priority:
 *   1. Last approved version (from handoff_approvals)
 *   2. Previous valid version (non-invalidated, before current)
 *   3. No baseline
 */
export function resolveBaseline(
  store: HandoffStore,
  handoffId: HandoffId,
  currentVersion: PacketVersion,
): ResolvedBaseline {
  // Try 1: last approved version
  const approvals = store.getApprovals(handoffId);
  const approved = approvals
    .filter(a => a.approvalStatus === 'approved' && a.packetVersion < currentVersion)
    .sort((a, b) => b.packetVersion - a.packetVersion);

  if (approved.length > 0) {
    const baselineVersion = approved[0]!.packetVersion;
    const packet = store.reconstructPacket(handoffId, baselineVersion);
    if (packet) {
      return { packet, version: baselineVersion, type: 'approved' };
    }
  }

  // Try 2: previous valid (non-invalidated) version
  const versions = store.listVersions(handoffId);
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i]!;
    if (v.packetVersion >= currentVersion) continue;
    if (!store.isVersionInvalidated(handoffId, v.packetVersion)) {
      const packet = store.reconstructPacket(handoffId, v.packetVersion);
      if (packet) {
        return { packet, version: v.packetVersion, type: 'last_valid' };
      }
    }
  }

  // No baseline available
  return { packet: null, version: null, type: 'none' };
}

// ── Delta computation ───────────────────────────────────────────────

/**
 * Compute the structured delta between a baseline packet and the current packet.
 * Returns null if no baseline is available.
 */
export function computeBaselineDelta(
  baseline: HandoffPacket,
  current: HandoffPacket,
  baselineType: 'approved' | 'last_valid',
): BaselineDelta {
  const deltaLines: string[] = [];

  // Summary change
  const summaryChanged = baseline.summary !== current.summary;
  if (summaryChanged) {
    deltaLines.push('Summary changed');
  }

  // Instructions change
  const instructionsChanged =
    JSON.stringify(baseline.instructions.authoritative) !== JSON.stringify(current.instructions.authoritative);
  const constraintsChanged =
    JSON.stringify(baseline.instructions.constraints) !== JSON.stringify(current.instructions.constraints);
  const prohibitionsChanged =
    JSON.stringify(baseline.instructions.prohibitions) !== JSON.stringify(current.instructions.prohibitions);

  if (instructionsChanged) deltaLines.push('Authoritative instructions changed');
  if (constraintsChanged) deltaLines.push('Constraints changed');
  if (prohibitionsChanged) deltaLines.push('Prohibitions changed');

  // Decisions diff
  const baselineDecisionIds = new Set(baseline.decisions.map(d => d.id));
  const currentDecisionIds = new Set(current.decisions.map(d => d.id));
  const decisionsAdded = current.decisions
    .filter(d => !baselineDecisionIds.has(d.id))
    .map(d => `${d.id}: ${d.summary}`);
  const decisionsRemoved = baseline.decisions
    .filter(d => !currentDecisionIds.has(d.id))
    .map(d => `${d.id}: ${d.summary}`);

  if (decisionsAdded.length > 0) deltaLines.push(`${decisionsAdded.length} decision(s) added`);
  if (decisionsRemoved.length > 0) deltaLines.push(`${decisionsRemoved.length} decision(s) removed`);

  // Open loops diff
  const baselineLoopIds = new Set(baseline.openLoops.map(l => l.id));
  const currentLoopIds = new Set(current.openLoops.map(l => l.id));
  const openLoopsAdded = current.openLoops
    .filter(l => !baselineLoopIds.has(l.id))
    .map(l => `${l.id}: ${l.summary}`);
  const openLoopsClosed = baseline.openLoops
    .filter(l => !currentLoopIds.has(l.id))
    .map(l => `${l.id}: ${l.summary}`);

  if (openLoopsAdded.length > 0) deltaLines.push(`${openLoopsAdded.length} open loop(s) added`);
  if (openLoopsClosed.length > 0) deltaLines.push(`${openLoopsClosed.length} open loop(s) closed`);

  // Artifacts diff
  const baselineArtifactIds = new Set(baseline.artifacts.map(a => a.id));
  const currentArtifactIds = new Set(current.artifacts.map(a => a.id));
  const artifactsAdded = current.artifacts
    .filter(a => !baselineArtifactIds.has(a.id))
    .map(a => `${a.id}: ${a.name}`);
  const artifactsRemoved = baseline.artifacts
    .filter(a => !currentArtifactIds.has(a.id))
    .map(a => `${a.id}: ${a.name}`);

  if (artifactsAdded.length > 0) deltaLines.push(`${artifactsAdded.length} artifact(s) added`);
  if (artifactsRemoved.length > 0) deltaLines.push(`${artifactsRemoved.length} artifact(s) removed`);

  if (deltaLines.length === 0) {
    deltaLines.push('No material changes detected');
  }

  return {
    baselineVersion: baseline.packetVersion,
    currentVersion: current.packetVersion,
    baselineType,
    summaryChanged,
    instructionsChanged,
    constraintsChanged,
    prohibitionsChanged,
    decisionsAdded,
    decisionsRemoved,
    openLoopsAdded,
    openLoopsClosed,
    artifactsAdded,
    artifactsRemoved,
    deltaLines,
  };
}
