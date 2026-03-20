/**
 * Handoff Spine — Read handoff API.
 *
 * Exact-lookup retrieval. No fuzzy search.
 * Returns the authoritative packet or null.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket, HandoffPacketRecord, HandoffId, PacketVersion } from '../schema/packet.js';
import { verifyPacketIntegrity } from '../integrity/verify-packet.js';

export interface ReadHandoffResult {
  ok: true;
  packet: HandoffPacket;
  record: HandoffPacketRecord;
  integrityValid: boolean;
  isInvalidated: boolean;
}

export interface ReadHandoffError {
  ok: false;
  error: string;
}

/**
 * Read a handoff packet by exact ID.
 * Optionally specify a version; defaults to current.
 */
export function readHandoff(
  store: HandoffStore,
  handoffId: HandoffId,
  version?: PacketVersion,
): ReadHandoffResult | ReadHandoffError {
  const record = store.getPacket(handoffId);
  if (!record) {
    return { ok: false, error: `Packet ${handoffId} not found` };
  }

  const v = version ?? record.currentVersion;
  const packet = store.reconstructPacket(handoffId, v);
  if (!packet) {
    return { ok: false, error: `Version ${v} not found for packet ${handoffId}` };
  }

  const integrity = verifyPacketIntegrity(packet);
  const isInvalidated = store.isVersionInvalidated(handoffId, v);

  return {
    ok: true,
    packet,
    record,
    integrityValid: integrity.valid,
    isInvalidated,
  };
}
