/**
 * Handoff Spine — Invalidate handoff API.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { InvalidationReasonCode } from '../schema/version.js';
import { invalidatePacketVersion, type InvalidateResult } from '../integrity/invalidation-engine.js';

export interface InvalidateHandoffInput {
  handoffId: string;
  packetVersion: number;
  reasonCode: InvalidationReasonCode;
  reason: string;
}

export function invalidateHandoff(
  store: HandoffStore,
  input: InvalidateHandoffInput,
): InvalidateResult {
  return invalidatePacketVersion(store, input);
}
