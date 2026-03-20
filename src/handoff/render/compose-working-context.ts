/**
 * Handoff Spine — Working context composition.
 *
 * Chain: packet → role renderer → model adapter → working context
 *
 * This is the orchestrator that runs the chain and records the
 * render event for audit trail.
 */

import type { HandoffPacket } from '../schema/packet.js';
import type {
  RoleRenderer,
  ModelAdapter,
  WorkingContext,
  RoleRenderedContext,
} from '../schema/render.js';
import type { HandoffStore } from '../store/handoff-store.js';
import { computeOutputHash } from '../integrity/hash.js';
import { nowISO } from '../../lib/ids.js';

export interface ComposeInput {
  packet: HandoffPacket;
  renderer: RoleRenderer;
  adapter: ModelAdapter;
  tokenBudget?: number;
}

export interface ComposeResult {
  context: WorkingContext;
  rendered: RoleRenderedContext;
  outputHash: string;
  renderEventId?: number;
}

/**
 * Compose a working context from a packet using the rendering chain.
 * Optionally records the render event to the store for audit trail.
 */
export function composeWorkingContext(
  input: ComposeInput,
  store?: HandoffStore,
): ComposeResult {
  const { packet, renderer, adapter, tokenBudget } = input;

  // Step 1: Role renderer
  const rendered = renderer.render({ packet, tokenBudget });

  // Step 2: Model adapter
  const context = adapter.adapt({ rendered, tokenBudget });

  // Fill in metadata from packet
  context.metadata.handoffId = packet.handoffId;
  context.metadata.packetVersion = packet.packetVersion;

  // Compute output hash for traceability
  const outputHash = computeOutputHash(
    context.system + (context.developer ?? '') + (context.userBootstrap ?? ''),
  );

  let renderEventId: number | undefined;

  // Step 3: Record render event if store is provided
  if (store) {
    renderEventId = store.insertRenderEvent({
      handoffId: packet.handoffId,
      packetVersion: packet.packetVersion,
      roleRenderer: renderer.role,
      rendererVersion: renderer.version,
      modelAdapter: adapter.name,
      adapterVersion: adapter.version,
      tokenBudget,
      renderedAt: nowISO(),
      outputHash,
    });
  }

  return { context, rendered, outputHash, renderEventId };
}
