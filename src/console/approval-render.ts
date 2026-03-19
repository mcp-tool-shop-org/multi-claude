/**
 * Approval Render — Phase 10B-202
 *
 * Operator-grade terminal rendering for promotion checks,
 * approval status, and invalidation state.
 */

import type { PromotionCheckResult, ApprovalRecord } from '../types/approval.js';
import type { ApprovalStatusResult } from './approval-executor.js';

// ── Constants ────────────────────────────────────────────────────────

const ELIGIBILITY_SYMBOLS: Record<string, string> = {
  promotable: '✓',
  promotable_with_notes: '✓',
  not_promotable: '✗',
  ineligible: '⊘',
};

const STATUS_SYMBOLS: Record<string, string> = {
  pending: '◌',
  approved: '✓',
  rejected: '✗',
  invalidated: '⚠',
};

// ── Promotion check rendering ───────────────────────────────────────

export function renderPromotionCheck(check: PromotionCheckResult): string {
  const lines: string[] = [];

  lines.push('═══ PROMOTION CHECK ═══');
  lines.push('');

  const sym = ELIGIBILITY_SYMBOLS[check.eligibility] ?? '?';
  lines.push(`  ${sym} Eligibility: ${check.eligibility.replace(/_/g, ' ').toUpperCase()}`);
  lines.push(`  Run:       ${check.runId}`);
  lines.push(`  Verdict:   ${check.handoffVerdict.replace(/_/g, ' ')}`);
  lines.push(`  Fingerprint: ${check.handoffFingerprint}`);
  lines.push('');
  lines.push(`  ${check.reason}`);
  lines.push('');

  // Blockers
  if (check.blockers.length > 0) {
    lines.push('  Blockers:');
    for (const b of check.blockers) {
      lines.push(`    ✗ [${b.kind}] ${b.description}`);
    }
    lines.push('');
  }

  // Notes
  if (check.notes.length > 0) {
    lines.push('  Notes for approver:');
    for (const n of check.notes) {
      lines.push(`    · ${n}`);
    }
    lines.push('');
  }

  // Recommended action
  if (check.recommendedAction) {
    lines.push(`  Next: ${check.recommendedAction}`);
  }

  return lines.join('\n');
}

// ── Approval status rendering ───────────────────────────────────────

export function renderApprovalStatus(status: ApprovalStatusResult): string {
  const lines: string[] = [];

  lines.push('═══ APPROVAL STATUS ═══');
  lines.push('');

  lines.push(`  Run: ${status.runId}`);
  lines.push('');

  // Current eligibility
  const eligSym = ELIGIBILITY_SYMBOLS[status.promotionCheck.eligibility] ?? '?';
  lines.push(`  ${eligSym} Current eligibility: ${status.promotionCheck.eligibility.replace(/_/g, ' ').toUpperCase()}`);
  lines.push('');

  // Approval record
  if (status.latestApproval) {
    const a = status.latestApproval;
    const aSym = STATUS_SYMBOLS[a.status] ?? '?';
    lines.push(`  ${aSym} Approval: ${a.status.toUpperCase()}`);
    lines.push(`    By:   ${a.approver}`);
    lines.push(`    At:   ${a.decidedAt}`);
    lines.push(`    Reason: ${a.reason}`);
    lines.push(`    Bound fingerprint: ${a.binding.handoffFingerprint}`);

    if (a.status === 'invalidated') {
      lines.push(`    ⚠ Invalidated at: ${a.invalidatedAt}`);
      lines.push(`    ⚠ Reason: ${a.invalidationReason}`);
    }

    lines.push('');
  } else {
    lines.push('  No approval recorded.');
    lines.push('');
  }

  // Invalidation details
  if (status.invalidation && !status.invalidation.valid) {
    lines.push('  Invalidation details:');
    for (let i = 0; i < status.invalidation.reasons.length; i++) {
      lines.push(`    ✗ ${status.invalidation.reasons[i]}: ${status.invalidation.details[i]}`);
    }
    lines.push('');
  }

  // Message
  lines.push(`  ${status.message}`);

  return lines.join('\n');
}

// ── Approve result rendering ────────────────────────────────────────

export function renderApproveResult(result: {
  decision: string;
  message: string;
  approval?: ApprovalRecord | null;
  promotionCheck?: PromotionCheckResult;
}): string {
  const lines: string[] = [];

  const sym = result.decision === 'approved' ? '✓' :
    result.decision === 'rejected' ? '✗' : '⊘';

  lines.push(`  ${sym} ${result.message}`);

  if (result.approval) {
    lines.push(`    Approval ID: ${result.approval.id}`);
    lines.push(`    Bound fingerprint: ${result.approval.binding.handoffFingerprint}`);
  }

  if (result.decision === 'refused' && result.promotionCheck) {
    lines.push('');
    lines.push('  Blockers:');
    for (const b of result.promotionCheck.blockers) {
      lines.push(`    ✗ ${b.description}`);
    }
    if (result.promotionCheck.recommendedAction) {
      lines.push('');
      lines.push(`  Next: ${result.promotionCheck.recommendedAction}`);
    }
  }

  return lines.join('\n');
}
