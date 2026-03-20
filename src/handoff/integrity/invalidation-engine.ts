/**
 * Handoff Spine — Invalidation engine.
 *
 * Manages packet version invalidation with reason tracking.
 * Invalidated versions cannot be treated as current truth.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { InvalidationReasonCode } from '../schema/version.js';
import { nowISO } from '../../lib/ids.js';

export interface InvalidateInput {
  handoffId: string;
  packetVersion: number;
  reasonCode: InvalidationReasonCode;
  reason: string;
}

export interface InvalidateResult {
  ok: boolean;
  error?: string;
}

/**
 * Invalidate a specific packet version.
 * If the invalidated version is the current version, the packet status
 * is updated to 'invalidated'.
 */
export function invalidatePacketVersion(
  store: HandoffStore,
  input: InvalidateInput,
): InvalidateResult {
  const record = store.getPacket(input.handoffId);
  if (!record) {
    return { ok: false, error: `Packet ${input.handoffId} not found` };
  }

  const version = store.getVersion(input.handoffId, input.packetVersion);
  if (!version) {
    return { ok: false, error: `Version ${input.packetVersion} not found for packet ${input.handoffId}` };
  }

  if (store.isVersionInvalidated(input.handoffId, input.packetVersion)) {
    return { ok: false, error: `Version ${input.packetVersion} is already invalidated` };
  }

  store.transaction(() => {
    store.insertInvalidation({
      handoffId: input.handoffId,
      packetVersion: input.packetVersion,
      reasonCode: input.reasonCode,
      reason: input.reason,
      invalidatedAt: nowISO(),
    });

    if (record.currentVersion === input.packetVersion) {
      store.updatePacketStatus(input.handoffId, 'invalidated');
    }
  });

  return { ok: true };
}
