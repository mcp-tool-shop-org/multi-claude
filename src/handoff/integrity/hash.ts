/**
 * Handoff Spine — Packet hashing.
 *
 * Deterministic hash of packet content for integrity verification.
 * The hash covers the semantic content fields, not metadata like timestamps.
 * Artifact refs are included (by ref, not by body content).
 */

import { createHash } from 'node:crypto';
import type { HandoffPacket } from '../schema/packet.js';

/**
 * Fields included in the content hash, in canonical order.
 * This is the integrity boundary — changing any of these changes the hash.
 */
interface HashableContent {
  summary: string;
  instructions: HandoffPacket['instructions'];
  decisions: HandoffPacket['decisions'];
  rejected: HandoffPacket['rejected'];
  openLoops: HandoffPacket['openLoops'];
  artifacts: HandoffPacket['artifacts'];
  scope: HandoffPacket['scope'];
}

/**
 * Compute a deterministic content hash for a handoff packet.
 * Uses JSON.stringify with sorted keys for determinism.
 */
export function computePacketHash(packet: Omit<HandoffPacket, 'contentHash' | 'handoffId' | 'packetVersion' | 'createdAt' | 'derivedFromRunId'>): string {
  const hashable: HashableContent = {
    summary: packet.summary,
    instructions: packet.instructions,
    decisions: packet.decisions,
    rejected: packet.rejected,
    openLoops: packet.openLoops,
    artifacts: packet.artifacts,
    scope: packet.scope,
  };

  const canonical = JSON.stringify(hashable, sortReplacer);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Replacer that sorts object keys at every level for deterministic JSON.
 */
function sortReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Compute hash of rendered working context output for audit trail.
 */
export function computeOutputHash(output: string): string {
  return createHash('sha256').update(output).digest('hex');
}
