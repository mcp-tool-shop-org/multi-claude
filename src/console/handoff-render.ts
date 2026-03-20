/**
 * Handoff Render — Phase 10A-201
 *
 * Operator-grade terminal rendering for run handoff artifacts.
 * Reads like a handoff brief, not a dashboard dump.
 *
 * Sections:
 *   1. Verdict
 *   2. Run context
 *   3. Attempted objective
 *   4. Outcome
 *   5. Contribution summary
 *   6. Interventions and recovery
 *   7. Outstanding issues
 *   8. Recommended follow-ups
 *   9. Review readiness
 *   10. Evidence trail
 */

import type { RunHandoff } from '../types/handoff.js';

// ── Constants ────────────────────────────────────────────────────────

const MAX_LINE_WIDTH = 100;

const VERDICT_SYMBOLS: Record<string, string> = {
  review_ready: '✓',
  review_ready_with_notes: '✓',
  not_review_ready: '✗',
  incomplete: '◌',
  blocked: '⊘',
};

const CONTRIBUTION_SYMBOLS: Record<string, string> = {
  resolved: '✓',
  recovered: '↻',
  failed: '✗',
  blocked: '⊘',
  pending: '◌',
  skipped: '—',
};

const SEVERITY_SYMBOLS: Record<string, string> = {
  critical: '!',
  warning: '▸',
  info: '·',
};

const URGENCY_LABELS: Record<string, string> = {
  immediate: 'NOW',
  soon: 'SOON',
  when_ready: 'LATER',
};

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function formatElapsed(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return `${hours}h ${remainMins}m`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render a RunHandoff to terminal-formatted text.
 */
export function renderHandoff(handoff: RunHandoff): string {
  const lines: string[] = [];

  // ── 1. Verdict ──────────────────────────────────────────────────
  lines.push('═══ RUN HANDOFF ═══');
  lines.push('');

  const sym = VERDICT_SYMBOLS[handoff.verdict] ?? '?';
  const verdictLabel = handoff.verdict.replace(/_/g, ' ').toUpperCase();
  lines.push(`  ${sym} Verdict: ${verdictLabel}`);
  lines.push('');

  // ── 2. Run context ──────────────────────────────────────────────
  lines.push(`  Run:     ${handoff.runId}`);
  lines.push(`  Feature: ${handoff.featureId} (${handoff.featureTitle})`);
  lines.push(`  Elapsed: ${formatElapsed(handoff.elapsedMs)}`);
  lines.push('');

  // ── 3. Attempted objective ──────────────────────────────────────
  lines.push('  Objective:');
  lines.push(`    ${handoff.attemptedGoal}`);
  lines.push('');

  // ── 4. Outcome ──────────────────────────────────────────────────
  lines.push('  Outcome:');
  lines.push(`    Status: ${handoff.outcomeStatus.replace(/_/g, ' ')}`);
  lines.push(`    ${handoff.summary}`);
  const acceptSym = handoff.acceptable ? '✓' : '✗';
  lines.push(`    ${acceptSym} Acceptable: ${handoff.acceptable ? 'YES' : 'NO'} — ${handoff.acceptabilityReason}`);
  lines.push('');

  // ── 5. Contribution summary ─────────────────────────────────────
  lines.push('  Contributions:');
  lines.push(`    ${handoff.landedContributions} landed | ${handoff.recoveredContributions} recovered | ${handoff.failedContributions} failed | ${handoff.totalContributions} total`);

  if (handoff.hasChangeEvidence) {
    lines.push(`    ${handoff.totalFilesChanged} file(s) changed (evidence available)`);
  } else {
    lines.push('    No file-level change evidence available');
  }
  lines.push('');

  // Per-contribution detail
  for (const c of handoff.contributions) {
    const cSym = CONTRIBUTION_SYMBOLS[c.status] ?? '?';
    const flags: string[] = [];
    if (c.wasRecovered) flags.push('recovered');
    if (c.hadIntervention) flags.push('intervened');
    if (c.attempts > 1) flags.push(`${c.attempts} attempts`);
    const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
    lines.push(`    ${cSym} ${c.packetId} [${c.role}/${c.layer}] — ${truncate(c.title, 50)}${flagStr}`);

    if (c.changedFiles) {
      const cf = c.changedFiles;
      lines.push(`      Files: +${cf.filesCreated.length} ~${cf.filesModified.length} -${cf.filesDeleted.length}${cf.reconciled ? (cf.reconcilePass ? ' ✓ reconciled' : ' ✗ reconcile failed') : ''}`);
    }
  }
  lines.push('');

  // ── 6. Interventions and recovery ───────────────────────────────
  if (handoff.interventions.occurred) {
    lines.push('  Interventions:');
    const s = handoff.interventions.summary;
    const parts: string[] = [];
    if (s.retries > 0) parts.push(`${s.retries} retries`);
    if (s.gateApprovals > 0) parts.push(`${s.gateApprovals} gate approvals`);
    if (s.hookResolutions > 0) parts.push(`${s.hookResolutions} hook resolutions`);
    if (s.stops > 0) parts.push(`${s.stops} stops`);
    if (s.resumes > 0) parts.push(`${s.resumes} resumes`);
    lines.push(`    ${s.totalActions} total: ${parts.join(', ')}`);

    // Show significant actions (limit to 5 for readability)
    const significant = handoff.interventions.significantActions.slice(0, 5);
    if (significant.length > 0) {
      for (const event of significant) {
        lines.push(`    • ${event.description}`);
      }
      if (handoff.interventions.significantActions.length > 5) {
        lines.push(`    … and ${handoff.interventions.significantActions.length - 5} more`);
      }
    }
    lines.push('');
  }

  // ── 7. Outstanding issues ───────────────────────────────────────
  if (handoff.outstandingIssues.length > 0) {
    lines.push('  Outstanding Issues:');
    for (const issue of handoff.outstandingIssues) {
      const issSym = SEVERITY_SYMBOLS[issue.severity] ?? '·';
      const blocking = issue.blocksReview ? ' [BLOCKS REVIEW]' : '';
      lines.push(`    ${issSym} ${issue.description}${blocking}`);
      if (issue.recommendedAction) {
        lines.push(`      Run: ${issue.recommendedAction}`);
      }
    }
    lines.push('');
  }

  // ── 8. Recommended follow-ups ───────────────────────────────────
  if (handoff.followUps.length > 0) {
    lines.push('  Follow-ups:');
    for (const fu of handoff.followUps) {
      const urgLabel = URGENCY_LABELS[fu.urgency] ?? fu.urgency;
      lines.push(`    [${urgLabel}] ${fu.description}`);
      lines.push(`      Reason: ${truncate(fu.reason, MAX_LINE_WIDTH - 14)}`);
      if (fu.command) {
        lines.push(`      Run: ${fu.command}`);
      }
    }
    lines.push('');
  }

  // ── 9. Review readiness ─────────────────────────────────────────
  lines.push('  Review Readiness:');
  const readySym = handoff.reviewReadiness.ready ? '✓' : '✗';
  lines.push(`    ${readySym} ${handoff.reviewReadiness.reason}`);

  if (handoff.reviewReadiness.blockers.length > 0) {
    lines.push('    Blockers:');
    for (const b of handoff.reviewReadiness.blockers) {
      lines.push(`      ✗ [${b.kind}] ${b.description}`);
    }
  }

  if (handoff.reviewReadiness.notes.length > 0) {
    lines.push('    Notes:');
    for (const n of handoff.reviewReadiness.notes) {
      lines.push(`      · [${n.kind}] ${n.description}`);
    }
  }
  lines.push('');

  // ── 10. Evidence trail ──────────────────────────────────────────
  if (handoff.evidenceRefs.length > 0) {
    lines.push('  Evidence:');
    for (const ref of handoff.evidenceRefs) {
      lines.push(`    [${ref.kind}] ${ref.description}`);
      if (ref.command) {
        lines.push(`      Inspect: ${ref.command}`);
      }
    }
  }

  return lines.join('\n');
}
