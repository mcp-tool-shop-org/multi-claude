/**
 * Decision Briefs — Create brief API.
 *
 * Resolves packet, renders context, derives decision brief,
 * and produces the role-appropriate rendered text — in one call.
 *
 * Chain: packet → resolve → render → derive brief → render brief text
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId } from '../schema/packet.js';
import type { DecisionBrief, DecisionRole } from '../decision/types.js';
import { resolveLastValidHandoff } from './resolve-handoff.js';
import { renderHandoff, type ModelAdapterName } from './render-handoff.js';
import { deriveDecisionBrief } from '../decision/derive-decision-brief.js';
import { renderReviewerBrief } from '../decision/reviewer-decision-renderer.js';
import { renderApproverBrief } from '../decision/approver-decision-renderer.js';
import { nowISO } from '../../lib/ids.js';

// ── Result types ─────────────────────────────────────────────────────

export interface CreateBriefResult {
  ok: true;
  brief: DecisionBrief;
  /** Human-readable rendered brief text */
  renderedText: string;
  /** Render event ID for traceability */
  renderEventId: number | undefined;
}

export interface CreateBriefError {
  ok: false;
  error: string;
  reason: 'not_found' | 'all_invalidated' | 'no_versions' | 'render_failed' | 'derive_failed';
}

// ── API ──────────────────────────────────────────────────────────────

/**
 * Create a decision brief for a handoff packet.
 *
 * This is the primary entry point for the decision surface.
 */
export function createDecisionBrief(
  store: HandoffStore,
  input: {
    handoffId: string;
    role: DecisionRole;
    model?: ModelAdapterName;
    consumerRunId?: string;
  },
): CreateBriefResult | CreateBriefError {
  const handoffId = input.handoffId as HandoffId;
  const role = input.role;
  const model = input.model ?? 'claude';

  // Step 1: Resolve last valid version
  const resolved = resolveLastValidHandoff(store, handoffId);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      reason: resolved.reason,
    };
  }

  // Step 2: Render with role-appropriate renderer
  const renderResult = renderHandoff(store, {
    handoffId,
    version: resolved.resolvedVersion,
    role: role === 'reviewer' ? 'reviewer' : 'approver',
    model,
  });

  if (!renderResult.ok) {
    return {
      ok: false,
      error: renderResult.error,
      reason: 'render_failed',
    };
  }

  // Step 3: Record use for audit trail
  store.insertUse({
    handoffId: input.handoffId,
    packetVersion: resolved.resolvedVersion,
    renderEventId: renderResult.renderEventId,
    consumerRunId: input.consumerRunId ?? 'decision-brief',
    consumerRole: `${role}:brief`,
    usedAt: nowISO(),
  });

  // Step 4: Derive decision brief
  const briefResult = deriveDecisionBrief({
    store,
    packet: resolved.packet,
    role,
    fingerprint: renderResult.outputHash,
  });

  if (!briefResult.ok) {
    return {
      ok: false,
      error: briefResult.error,
      reason: 'derive_failed',
    };
  }

  // Step 5: Render brief text for human consumption
  const renderedText = role === 'reviewer'
    ? renderReviewerBrief(briefResult.brief)
    : renderApproverBrief(briefResult.brief);

  return {
    ok: true,
    brief: briefResult.brief,
    renderedText,
    renderEventId: renderResult.renderEventId,
  };
}
