/**
 * Recovery Render — Phase 9E-201
 *
 * Operator-grade terminal rendering for recovery plans.
 * Not decorative — reads like a generated playbook.
 */

import type {
  RecoveryPlan,
  RecoveryStep,
  RecoveryResult,
} from '../types/recovery.js';

// ── Constants ────────────────────────────────────────────────────────

const MAX_LINE_WIDTH = 100;

const SEVERITY_SYMBOLS: Record<string, string> = {
  critical: '!',
  actionable: '▸',
  waiting: '◌',
};

const KIND_LABELS: Record<string, string> = {
  operator_action: 'ACTION',
  diagnostic: 'DIAGNOSE',
  wait: 'WAIT',
  manual_fix: 'MANUAL',
};

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render a RecoveryResult to terminal-formatted text.
 */
export function renderRecovery(result: RecoveryResult): string {
  if (result.scenario === 'no_recovery_needed') {
    return [
      '═══ RECOVERY ═══',
      '',
      `  ${result.reason}`,
      '',
      '  No recovery action needed.',
    ].join('\n');
  }

  return renderPlan(result);
}

/**
 * Render a full RecoveryPlan.
 */
function renderPlan(plan: RecoveryPlan): string {
  const lines: string[] = [];

  // Header
  lines.push('═══ RECOVERY ═══');
  lines.push('');

  // Status line
  const sym = SEVERITY_SYMBOLS[plan.severity] ?? '?';
  lines.push(`  ${sym} Severity: ${plan.severity.toUpperCase()}`);
  lines.push(`  Scenario: ${plan.scenario}`);
  lines.push(`  Target:   ${plan.targetType} ${plan.targetId}`);
  lines.push('');

  // Summary
  lines.push(`  ${plan.summary}`);
  lines.push('');

  // Primary blocker
  lines.push('  Primary blocker:');
  lines.push(`    ${plan.blocker.summary}`);
  if (plan.blocker.failedPreconditions.length > 0) {
    for (const p of plan.blocker.failedPreconditions) {
      lines.push(`    ✗ ${p.check}: ${p.detail}`);
    }
  }
  lines.push('');

  // Recovery path
  lines.push('  Recommended path:');
  lines.push('');

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const stepLines = renderStep(step, i + 1, i === plan.currentStepIndex);
    lines.push(...stepLines);
  }

  // Terminal condition
  lines.push('  Recovered when:');
  lines.push(`    ${plan.terminalCondition.description}`);
  if (plan.terminalCondition.checkCommand) {
    lines.push(`    Verify: ${plan.terminalCondition.checkCommand}`);
  }

  return lines.join('\n');
}

/**
 * Render a single recovery step.
 */
function renderStep(step: RecoveryStep, number: number, isCurrent: boolean): string[] {
  const lines: string[] = [];
  const kindLabel = KIND_LABELS[step.kind] ?? step.kind;
  const legalMark = step.legalNow ? '✓ LEGAL NOW' : '✗ BLOCKED';
  const currentMark = isCurrent ? ' ◀ current' : '';

  lines.push(`  ${number}. [${kindLabel}] ${step.title}${currentMark}`);
  lines.push(`     Status: ${legalMark}`);
  lines.push(`     Why:    ${truncate(step.reason, MAX_LINE_WIDTH - 13)}`);

  if (step.command) {
    lines.push(`     Run:    ${step.command}`);
  }

  if (!step.legalNow && step.blockedReason) {
    lines.push(`     Blocked: ${truncate(step.blockedReason, MAX_LINE_WIDTH - 14)}`);
  }

  lines.push(`     Unlocks: ${truncate(step.expectedUnlock, MAX_LINE_WIDTH - 14)}`);
  lines.push('');

  return lines;
}
