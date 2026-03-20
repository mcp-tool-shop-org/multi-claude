/**
 * Approval Executor — Phase 10B-201
 *
 * Lawful approval path:
 *   1. Derive handoff
 *   2. Check promotion eligibility
 *   3. Refuse if not eligible (with exact reasons)
 *   4. Record approval with version binding
 *   5. Write audit trail entry
 *
 * No approval through a side channel.
 * No silent auto-promotion.
 */

import type { RunHandoff } from '../types/handoff.js';
import type {
  ApprovalRecord,
  PromotionCheckResult,
  PromotionDecision,
  ApprovalBinding,
} from '../types/approval.js';
import { checkPromotion } from './promotion-check.js';
import { checkApprovalValidity } from './approval-invalidation.js';
import { recordApproval, getLatestApproval, invalidateApproval } from './approval-store.js';
import { recordAudit } from './audit-trail.js';
import { deriveRunHandoff } from './run-handoff.js';
import { nowISO } from '../lib/ids.js';
import { openDb } from '../db/connection.js';
import { HandoffStore, migrateHandoffSchema } from '../handoff/index.js';
import { resolveApprovalHandoff } from '../handoff/api/resolve-approval-handoff.js';
import type { ModelAdapterName } from '../handoff/api/render-handoff.js';

// ── Public types ────────────────────────────────────────────────────

export interface ApproveInput {
  dbPath: string;
  runId?: string;
  approver: string;
  reason: string;
}

export interface ApproveResult {
  decision: PromotionDecision;
  approval: ApprovalRecord | null;       // set when approved
  promotionCheck: PromotionCheckResult;  // always present
  message: string;
}

export interface RejectInput {
  dbPath: string;
  runId?: string;
  approver: string;
  reason: string;
}

export interface RejectResult {
  decision: 'rejected';
  approval: ApprovalRecord;
  message: string;
}

export interface ApprovalStatusResult {
  runId: string;
  latestApproval: ApprovalRecord | null;
  promotionCheck: PromotionCheckResult;
  invalidation: { valid: boolean; reasons: string[]; details: string[] } | null;
  message: string;
}

// ── Approve ─────────────────────────────────────────────────────────

/**
 * Attempt to approve a run for promotion.
 * Refuses with exact reasons if not eligible.
 */
export function executeApprove(input: ApproveInput): ApproveResult {
  const handoff = deriveRunHandoff(input.dbPath, input.runId);

  if (!handoff) {
    const noHandoffCheck: PromotionCheckResult = {
      runId: input.runId ?? 'unknown',
      eligibility: 'ineligible',
      reason: 'No handoff available — no active run found',
      blockers: [{ kind: 'no_handoff', description: 'No active run found', targetId: null }],
      notes: [],
      handoffVerdict: 'incomplete' as any,
      handoffFingerprint: '',
      recommendedAction: null,
    };
    return {
      decision: 'refused',
      approval: null,
      promotionCheck: noHandoffCheck,
      message: 'Approval refused: no active run found',
    };
  }

  const promotionCheck = checkPromotion(handoff);

  // Refuse if not promotable
  if (promotionCheck.eligibility === 'not_promotable' || promotionCheck.eligibility === 'ineligible') {
    // Record the refused attempt in audit trail
    recordAudit(input.dbPath, {
      actor: input.approver,
      action: 'approve_promotion',
      targetType: 'run',
      targetId: handoff.runId,
      beforeState: promotionCheck.eligibility,
      afterState: 'refused',
      reason: `Promotion refused: ${promotionCheck.reason}`,
      command: `multi-claude console approve --run ${handoff.runId}`,
      success: false,
      error: promotionCheck.blockers.map(b => b.description).join('; '),
    });

    return {
      decision: 'refused',
      approval: null,
      promotionCheck,
      message: `Approval refused: ${promotionCheck.reason}`,
    };
  }

  // Resolve spine handoff for approval traceability (records handoff_use)
  const spine = trySpineResolution(input.dbPath, handoff.runId, 'approver');

  // Create binding (with spine traceability if available)
  const binding = createBinding(handoff, promotionCheck, spine);

  // Record approval
  const approval = recordApproval(input.dbPath, {
    runId: handoff.runId,
    status: 'approved',
    approver: input.approver,
    reason: input.reason,
    binding,
  });

  // Record audit trail
  recordAudit(input.dbPath, {
    actor: input.approver,
    action: 'approve_promotion',
    targetType: 'run',
    targetId: handoff.runId,
    beforeState: promotionCheck.eligibility,
    afterState: 'approved',
    reason: input.reason,
    command: `multi-claude console approve --run ${handoff.runId}`,
    success: true,
    error: null,
  });

  return {
    decision: 'approved',
    approval,
    promotionCheck,
    message: `Run ${handoff.runId} approved for promotion by ${input.approver}`,
  };
}

// ── Reject ──────────────────────────────────────────────────────────

/**
 * Explicitly reject a run for promotion.
 */
export function executeReject(input: RejectInput): RejectResult | null {
  const handoff = deriveRunHandoff(input.dbPath, input.runId);
  if (!handoff) return null;

  const promotionCheck = checkPromotion(handoff);
  const spine = trySpineResolution(input.dbPath, handoff.runId, 'approver');
  const binding = createBinding(handoff, promotionCheck, spine);

  const approval = recordApproval(input.dbPath, {
    runId: handoff.runId,
    status: 'rejected',
    approver: input.approver,
    reason: input.reason,
    binding,
  });

  recordAudit(input.dbPath, {
    actor: input.approver,
    action: 'reject_promotion',
    targetType: 'run',
    targetId: handoff.runId,
    beforeState: promotionCheck.eligibility,
    afterState: 'rejected',
    reason: input.reason,
    command: `multi-claude console approve --run ${handoff.runId}`,
    success: true,
    error: null,
  });

  return {
    decision: 'rejected',
    approval,
    message: `Run ${handoff.runId} rejected by ${input.approver}: ${input.reason}`,
  };
}

// ── Status check with invalidation ──────────────────────────────────

/**
 * Check current approval status for a run, including invalidation detection.
 */
export function checkApprovalStatus(dbPath: string, runId?: string): ApprovalStatusResult | null {
  const handoff = deriveRunHandoff(dbPath, runId);
  if (!handoff) return null;

  const promotionCheck = checkPromotion(handoff);
  const latestApproval = getLatestApproval(dbPath, handoff.runId);

  let invalidation: ApprovalStatusResult['invalidation'] = null;

  if (latestApproval && latestApproval.status === 'approved') {
    const validity = checkApprovalValidity(latestApproval, handoff);
    invalidation = {
      valid: validity.valid,
      reasons: validity.reasons,
      details: validity.details,
    };

    // Auto-invalidate if stale
    if (!validity.valid) {
      invalidateApproval(
        dbPath,
        latestApproval.id,
        validity.reasons.join(', '),
      );
      latestApproval.status = 'invalidated';
      latestApproval.invalidatedAt = nowISO();
      latestApproval.invalidationReason = validity.reasons.join(', ');
    }
  }

  const message = buildStatusMessage(latestApproval, promotionCheck, invalidation);

  return {
    runId: handoff.runId,
    latestApproval,
    promotionCheck,
    invalidation,
    message,
  };
}

// ── Spine traceability ──────────────────────────────────────────────

interface SpineTraceability {
  spineHandoffId: string;
  spinePacketVersion: number;
  spineRenderEventId: number | undefined;
  spineOutputHash: string;
}

/**
 * Try to resolve spine handoff for approval.
 * Returns traceability data if spine handoff exists, null otherwise.
 */
function trySpineResolution(
  dbPath: string,
  runId: string,
  role: 'reviewer' | 'approver',
): SpineTraceability | null {
  const db = openDb(dbPath);
  try {
    migrateHandoffSchema(db);
    const store = new HandoffStore(db);

    // Find handoffs for this run
    const handoffs = store.findHandoffsByRunId(runId);
    if (handoffs.length === 0) return null;

    // Use the most recent handoff for this run
    const handoffRecord = handoffs[0]!;

    const result = resolveApprovalHandoff(store, {
      handoffId: handoffRecord.handoffId,
      role,
      model: 'claude' as ModelAdapterName,
      consumerRunId: runId,
      consumerRole: `${role}:approval`,
    });

    if (!result.ok) return null;

    return {
      spineHandoffId: result.handoffId,
      spinePacketVersion: result.packetVersion,
      spineRenderEventId: result.renderEventId,
      spineOutputHash: result.outputHash,
    };
  } catch {
    // Spine tables may not exist or other DB issues — fall through silently
    return null;
  } finally {
    db.close();
  }
}

// ── Internal helpers ────────────────────────────────────────────────

function createBinding(
  handoff: RunHandoff,
  promotionCheck: PromotionCheckResult,
  spine?: SpineTraceability | null,
): ApprovalBinding {
  return {
    runId: handoff.runId,
    handoffFingerprint: promotionCheck.handoffFingerprint,
    outcomeStatus: handoff.outcomeStatus,
    verdict: handoff.verdict,
    resolvedCount: handoff.landedContributions,
    failedCount: handoff.failedContributions,
    unresolvedCount: handoff.reviewBlockingIssues,
    boundAt: nowISO(),
    // Spine traceability — present when spine handoff was resolved
    spineHandoffId: spine?.spineHandoffId,
    spinePacketVersion: spine?.spinePacketVersion,
    spineRenderEventId: spine?.spineRenderEventId,
    spineOutputHash: spine?.spineOutputHash,
  };
}

function buildStatusMessage(
  approval: ApprovalRecord | null,
  check: PromotionCheckResult,
  invalidation: ApprovalStatusResult['invalidation'],
): string {
  if (!approval) {
    return `No approval recorded — current eligibility: ${check.eligibility}`;
  }

  if (approval.status === 'invalidated') {
    return `Previous approval invalidated: ${approval.invalidationReason ?? 'truth changed'} — current eligibility: ${check.eligibility}`;
  }

  if (approval.status === 'rejected') {
    return `Run was rejected: ${approval.reason}`;
  }

  if (approval.status === 'approved') {
    if (invalidation && !invalidation.valid) {
      return `Approval is stale — ${invalidation.reasons.join(', ')}`;
    }
    return `Run approved by ${approval.approver} at ${approval.decidedAt}`;
  }

  return `Approval status: ${approval.status}`;
}
