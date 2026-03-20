/**
 * Handoff Spine — Lineage query API.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId } from '../schema/packet.js';
import type { HandoffLineageRecord } from '../schema/version.js';

export interface LineageResult {
  ok: true;
  handoffId: HandoffId;
  ancestors: HandoffLineageRecord[];
  descendants: HandoffLineageRecord[];
}

export interface LineageError {
  ok: false;
  error: string;
}

/**
 * List the full lineage of a handoff packet — both ancestors and descendants.
 */
export function listHandoffLineage(
  store: HandoffStore,
  handoffId: HandoffId,
): LineageResult | LineageError {
  const record = store.getPacket(handoffId);
  if (!record) {
    return { ok: false, error: `Packet ${handoffId} not found` };
  }

  const ancestors = store.getLineage(handoffId);
  const descendants = store.getDescendants(handoffId);

  return {
    ok: true,
    handoffId,
    ancestors,
    descendants,
  };
}
