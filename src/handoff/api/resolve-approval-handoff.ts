/**
 * Handoff Spine — Approval handoff resolver.
 *
 * Resolves and renders a spine handoff packet for review/approval lanes.
 * This closes the loop: the same authoritative packet that the worker
 * consumed is now rendered for the reviewer/approver — no ad hoc summaries.
 *
 * Rules:
 *   - Invalidated current version → fallback to last valid (with rollback evidence)
 *   - All versions invalidated → explicit rejection (cannot approve phantom state)
 *   - Approval context is always traceable: handoffId + packetVersion + renderEventId
 *   - handoff_use is recorded for the review/approval lane
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId, HandoffLane } from '../schema/packet.js';
import type { WorkingContext, RoleRenderedContext } from '../schema/render.js';
import { resolveLastValidHandoff } from './resolve-handoff.js';
import { renderHandoff, type ModelAdapterName } from './render-handoff.js';
import { nowISO } from '../../lib/ids.js';

// ── Result types ─────────────────────────────────────────────────────

export interface ApprovalHandoffResult {
  ok: true;
  /** The handoff ID that was resolved */
  handoffId: string;
  /** The exact packet version rendered for the approver/reviewer */
  packetVersion: number;
  /** Render event ID for audit trail binding */
  renderEventId: number | undefined;
  /** Hash of the rendered output — binds approval to exact content */
  outputHash: string;
  /** The rendered working context */
  context: WorkingContext;
  /** Role-specific rendered context */
  rendered: RoleRenderedContext;
  /** True if the resolved version is not the latest (invalidated versions skipped) */
  isRollback: boolean;
  /** Number of invalidated versions skipped */
  skippedVersions: number;
  /** Warnings (e.g., rollback notices) */
  warnings: string[];
}

export interface ApprovalHandoffError {
  ok: false;
  error: string;
  /** Reason code for structured handling */
  reason: 'not_found' | 'all_invalidated' | 'no_versions' | 'render_failed';
  handoffId?: string;
}

// ── Resolver ─────────────────────────────────────────────────────────

/**
 * Resolve a handoff packet for review/approval, render it with the
 * appropriate role renderer, and record the use for audit trail.
 *
 * This is the single entry point for approval flows consuming spine truth.
 */
export function resolveApprovalHandoff(
  store: HandoffStore,
  input: {
    handoffId: string;
    role: 'reviewer' | 'approver';
    model: ModelAdapterName;
    consumerRunId: string;
    consumerRole: string;
  },
): ApprovalHandoffResult | ApprovalHandoffError {
  // Step 1: Resolve last valid version (rejects all-invalidated)
  const resolved = resolveLastValidHandoff(store, input.handoffId as HandoffId);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.error,
      reason: resolved.reason,
      handoffId: input.handoffId,
    };
  }

  // Step 2: Render with reviewer/approver renderer
  const renderResult = renderHandoff(store, {
    handoffId: input.handoffId as HandoffId,
    version: resolved.resolvedVersion,
    role: input.role as HandoffLane,
    model: input.model,
  });

  if (!renderResult.ok) {
    return {
      ok: false,
      error: renderResult.error,
      reason: 'render_failed',
      handoffId: input.handoffId,
    };
  }

  // Step 3: Record handoff_use for audit trail
  store.insertUse({
    handoffId: input.handoffId,
    packetVersion: resolved.resolvedVersion,
    renderEventId: renderResult.renderEventId,
    consumerRunId: input.consumerRunId,
    consumerRole: input.consumerRole,
    usedAt: nowISO(),
  });

  // Step 4: Build warnings
  const warnings = [...renderResult.warnings];
  if (resolved.isRollback) {
    warnings.push(
      `Rollback: resolved v${resolved.resolvedVersion} (skipped ${resolved.skippedVersions} invalidated version(s))`,
    );
  }

  return {
    ok: true,
    handoffId: input.handoffId,
    packetVersion: resolved.resolvedVersion,
    renderEventId: renderResult.renderEventId,
    outputHash: renderResult.outputHash,
    context: renderResult.context,
    rendered: renderResult.rendered,
    isRollback: resolved.isRollback,
    skippedVersions: resolved.skippedVersions,
    warnings,
  };
}
