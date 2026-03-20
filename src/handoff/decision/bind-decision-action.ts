/**
 * Decision Briefs — Action binding.
 *
 * Binds a decision action to a specific brief, packet version,
 * and evidence fingerprint. This is the final link in the chain:
 *
 *   run truth → handoff truth → render truth → decision truth → bound action
 *
 * Rules:
 *   - Action must be in the brief's allowed actions
 *   - Invalidated versions cannot produce a bound action
 *   - The binding is durable — stored in the handoff DB
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffId } from '../schema/packet.js';
import type { DecisionBrief, DecisionAction, DecisionActionRecord } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Result types ─────────────────────────────────────────────────────

export interface BindActionResult {
  ok: true;
  record: DecisionActionRecord;
}

export interface BindActionError {
  ok: false;
  error: string;
  code: 'action_not_allowed' | 'version_invalidated' | 'brief_stale';
}

// ── Binding ──────────────────────────────────────────────────────────

/**
 * Bind a decision action to a brief.
 *
 * Pre-conditions:
 *   - action must be in brief.eligibility.allowedActions
 *   - packet version must not be invalidated
 */
export function bindDecisionAction(
  store: HandoffStore,
  input: {
    brief: DecisionBrief;
    action: DecisionAction;
    actor: string;
    reason: string;
    renderEventId?: number;
  },
): BindActionResult | BindActionError {
  const { brief, action, actor, reason, renderEventId } = input;
  const handoffId = brief.handoffId as HandoffId;

  // Guard: action must be allowed
  if (!brief.eligibility.allowedActions.includes(action)) {
    return {
      ok: false,
      error: `Action '${action}' is not allowed. Allowed: ${brief.eligibility.allowedActions.join(', ')}`,
      code: 'action_not_allowed',
    };
  }

  // Guard: version must not be invalidated at bind time
  if (store.isVersionInvalidated(handoffId, brief.packetVersion)) {
    return {
      ok: false,
      error: `Version ${brief.packetVersion} of '${handoffId}' is invalidated — cannot bind action`,
      code: 'version_invalidated',
    };
  }

  // Build the action record
  const record: DecisionActionRecord = {
    actionId: generateId('dac'),
    briefId: brief.briefId,
    handoffId: brief.handoffId,
    packetVersion: brief.packetVersion,
    renderEventId,
    evidenceFingerprint: brief.evidenceCoverage.fingerprint,
    briefVersion: brief.briefVersion,
    action,
    actor,
    reason,
    decidedAt: nowISO(),
  };

  // Record as spine approval (maps to existing handoff_approvals table)
  store.insertApproval({
    handoffId: brief.handoffId,
    packetVersion: brief.packetVersion,
    approvalType: 'handoff_approval',
    approvalStatus: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending',
    approvedBy: actor,
    evidenceFingerprint: brief.evidenceCoverage.fingerprint,
    createdAt: record.decidedAt,
    updatedAt: record.decidedAt,
  });

  return { ok: true, record };
}
