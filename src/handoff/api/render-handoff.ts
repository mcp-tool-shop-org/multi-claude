/**
 * Handoff Spine — Render handoff API.
 *
 * Composes working context from a stored packet using the
 * rendering chain: packet → role renderer → model adapter.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId, PacketVersion, HandoffLane } from '../schema/packet.js';
import type { WorkingContext, RoleRenderedContext } from '../schema/render.js';
import { readHandoff } from './read-handoff.js';
import { composeWorkingContext } from '../render/compose-working-context.js';
import { WorkerRenderer } from '../render/role/worker-renderer.js';
import { ReviewerRenderer } from '../render/role/reviewer-renderer.js';
import { ApproverRenderer } from '../render/role/approver-renderer.js';
import { RecoveryRenderer } from '../render/role/recovery-renderer.js';
import { ClaudeAdapter } from '../render/adapters/claude-adapter.js';
import { GptAdapter } from '../render/adapters/gpt-adapter.js';
import { OllamaAdapter } from '../render/adapters/ollama-adapter.js';

export type ModelAdapterName = 'claude' | 'gpt' | 'ollama';

export interface RenderHandoffInput {
  handoffId: HandoffId;
  version?: PacketVersion;
  role: HandoffLane;
  model: ModelAdapterName;
  tokenBudget?: number;
}

export interface RenderHandoffResult {
  ok: true;
  context: WorkingContext;
  rendered: RoleRenderedContext;
  outputHash: string;
  renderEventId?: number;
  warnings: string[];
}

export interface RenderHandoffError {
  ok: false;
  error: string;
}

function getRenderer(role: HandoffLane) {
  switch (role) {
    case 'worker': return new WorkerRenderer();
    case 'reviewer': return new ReviewerRenderer();
    case 'approver': return new ApproverRenderer();
    case 'recovery': return new RecoveryRenderer();
  }
}

function getAdapter(model: ModelAdapterName) {
  switch (model) {
    case 'claude': return new ClaudeAdapter();
    case 'gpt': return new GptAdapter();
    case 'ollama': return new OllamaAdapter();
  }
}

/**
 * Render a stored handoff packet for a specific role and model.
 * Records the render event for audit trail.
 */
export function renderHandoff(
  store: HandoffStore,
  input: RenderHandoffInput,
): RenderHandoffResult | RenderHandoffError {
  const readResult = readHandoff(store, input.handoffId, input.version);
  if (!readResult.ok) return readResult;

  const warnings: string[] = [];

  if (readResult.isInvalidated) {
    warnings.push(`WARNING: Version ${readResult.packet.packetVersion} is invalidated`);
  }

  if (!readResult.integrityValid) {
    warnings.push('WARNING: Packet integrity check failed — content may have been tampered with');
  }

  const renderer = getRenderer(input.role);
  const adapter = getAdapter(input.model);

  const result = composeWorkingContext(
    {
      packet: readResult.packet,
      renderer,
      adapter,
      tokenBudget: input.tokenBudget,
    },
    store,
  );

  return {
    ok: true,
    context: result.context,
    rendered: result.rendered,
    outputHash: result.outputHash,
    renderEventId: result.renderEventId,
    warnings: [...warnings, ...result.rendered.warnings],
  };
}
