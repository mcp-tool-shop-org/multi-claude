/**
 * Handoff Spine — Packet integrity verification.
 *
 * Verifies that a stored packet has not been tampered with
 * by recomputing its content hash and comparing.
 */

import type { HandoffPacket } from '../schema/packet.js';
import { computePacketHash } from './hash.js';

export interface VerifyResult {
  valid: boolean;
  expectedHash: string;
  actualHash: string;
}

/**
 * Verify a packet's content hash matches its stored hash.
 */
export function verifyPacketIntegrity(packet: HandoffPacket): VerifyResult {
  const recomputed = computePacketHash(packet);
  return {
    valid: recomputed === packet.contentHash,
    expectedHash: packet.contentHash,
    actualHash: recomputed,
  };
}
