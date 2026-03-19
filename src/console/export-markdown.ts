/**
 * Export Markdown Renderer — Phase 10D-201
 *
 * GitHub-friendly review brief. Compact, trustworthy, grounded.
 * Sections follow decision flow, not implementation structure.
 *
 * Invariants:
 *   - Blockers always survive export
 *   - Notes preserve severity
 *   - Invalidated approval never renders as simply "approved"
 *   - No certainty beyond source evidence
 */

import type { ExportModel, ExportRenderOptions } from '../types/export.js';

// ── Verdict symbols ─────────────────────────────────────────────────

const VERDICT_SYMBOLS: Record<string, string> = {
  review_ready: '✅',
  review_ready_with_notes: '✅',
  not_review_ready: '❌',
  incomplete: '⏸️',
  blocked: '🚫',
};

const APPROVAL_SYMBOLS: Record<string, string> = {
  pending: '⏳',
  approved: '✅',
  rejected: '❌',
  invalidated: '⚠️',
};

// ── Public API ──────────────────────────────────────────────────────

export function renderMarkdownHandoff(model: ExportModel, _opts?: ExportRenderOptions): string {
  const sections: string[] = [];

  sections.push(renderVerdict(model));
  sections.push(renderRunContext(model));
  sections.push(renderObjective(model));
  sections.push(renderOutcome(model));
  sections.push(renderContributions(model));

  if (model.interventionOccurred) {
    sections.push(renderInterventions(model));
  }

  if (model.blockers.length > 0 || model.notes.length > 0) {
    sections.push(renderIssuesAndNotes(model));
  }

  sections.push(renderApprovalState(model));

  if (model.followUps.length > 0 || model.recommendedNextStep) {
    sections.push(renderNextSteps(model));
  }

  sections.push(renderEvidenceRefs(model));

  return sections.filter(s => s.length > 0).join('\n\n');
}

export function renderMarkdownApproval(model: ExportModel): string {
  const sections: string[] = [];

  sections.push(`## Approval Summary — ${model.runId}`);
  sections.push(renderApprovalState(model));

  if (model.blockers.length > 0) {
    sections.push(renderIssuesAndNotes(model));
  }

  if (model.recommendedNextStep) {
    sections.push(`**Next step:** \`${model.recommendedNextStep}\``);
  }

  return sections.join('\n\n');
}

// ── Section renderers ───────────────────────────────────────────────

function renderVerdict(model: ExportModel): string {
  const sym = VERDICT_SYMBOLS[model.handoffVerdict] ?? '❓';
  const verdictLabel = model.handoffVerdict.replace(/_/g, ' ');

  const lines = [
    `## ${sym} Handoff: ${verdictLabel.toUpperCase()}`,
    '',
    `> ${model.summary}`,
  ];

  return lines.join('\n');
}

function renderRunContext(model: ExportModel): string {
  const lines = [
    '### Run Context',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Run | \`${model.runId}\` |`,
    `| Feature | ${model.featureTitle} (\`${model.featureId}\`) |`,
    `| Outcome | ${model.outcomeStatus.replace(/_/g, ' ')} |`,
    `| Acceptable | ${model.acceptable ? 'Yes' : 'No'} |`,
    `| Promotion | ${model.promotionEligibility.replace(/_/g, ' ')} |`,
  ];

  if (model.elapsedMs) {
    const mins = Math.round(model.elapsedMs / 60000);
    lines.push(`| Duration | ${mins}min |`);
  }

  return lines.join('\n');
}

function renderObjective(model: ExportModel): string {
  return [
    '### Objective',
    '',
    model.attemptedGoal,
  ].join('\n');
}

function renderOutcome(model: ExportModel): string {
  const lines = [
    '### Outcome',
    '',
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Total packets | ${model.totalContributions} |`,
    `| Landed | ${model.landedContributions} |`,
    `| Failed | ${model.failedContributions} |`,
    `| Recovered | ${model.recoveredContributions} |`,
  ];

  if (!model.acceptable) {
    lines.push('');
    lines.push(`> ⚠️ **Not acceptable:** ${model.acceptabilityReason}`);
  }

  return lines.join('\n');
}

function renderContributions(model: ExportModel): string {
  const lines = [
    '### Contributions',
    '',
    '| Packet | Role | Status | Flags |',
    '|--------|------|--------|-------|',
  ];

  for (const c of model.contributions) {
    const flags: string[] = [];
    if (c.wasRetried) flags.push('retried');
    if (c.wasRecovered) flags.push('recovered');
    if (c.hadIntervention) flags.push('intervention');
    if (!c.contributed) flags.push('**did not contribute**');

    const statusEmoji = c.contributed ? '✅' : '❌';
    lines.push(`| ${c.title} | ${c.role} | ${statusEmoji} ${c.status} | ${flags.join(', ') || '—'} |`);
  }

  return lines.join('\n');
}

function renderInterventions(model: ExportModel): string {
  const lines = [
    '### Interventions',
    '',
    `This run required **${model.interventionCount}** operator intervention(s).`,
  ];

  if (model.recoveryOccurred) {
    lines.push(`Recovery was needed and ${model.recoveredContributions > 0 ? 'succeeded' : 'attempted'}.`);
  }

  return lines.join('\n');
}

function renderIssuesAndNotes(model: ExportModel): string {
  const lines = ['### Issues & Notes'];

  if (model.blockers.length > 0) {
    lines.push('');
    lines.push('**Blockers** (block review/promotion):');
    for (const b of model.blockers) {
      lines.push(`- 🚫 **[${b.kind}]** ${b.description}`);
      if (b.recommendedAction) {
        lines.push(`  - Fix: \`${b.recommendedAction}\``);
      }
    }
  }

  if (model.notes.length > 0) {
    lines.push('');
    lines.push('**Notes:**');
    for (const n of model.notes) {
      const icon = n.severity === 'material' ? '⚠️' :
        n.severity === 'caution' ? '💡' : 'ℹ️';
      lines.push(`- ${icon} [${n.severity}] ${n.description}`);
    }
  }

  return lines.join('\n');
}

function renderApprovalState(model: ExportModel): string {
  const sym = APPROVAL_SYMBOLS[model.approvalStatus] ?? '❓';
  const lines = [
    '### Approval',
    '',
    `**Status:** ${sym} ${model.approvalStatus.toUpperCase()}`,
  ];

  if (model.approver) {
    lines.push(`**Approver:** ${model.approver}`);
    lines.push(`**Decided:** ${model.approvalDecidedAt}`);
    lines.push(`**Reason:** ${model.approvalReason}`);
  }

  if (model.approvalFingerprint) {
    lines.push(`**Evidence fingerprint:** \`${model.approvalFingerprint}\``);
  }

  // Invalidation — MUST be explicit, never hidden
  if (model.approvalStatus === 'invalidated' || (model.approvalValid === false)) {
    lines.push('');
    lines.push('> ⚠️ **Approval has been invalidated.** Reasons:');
    for (let i = 0; i < model.invalidationReasons.length; i++) {
      lines.push(`> - ${model.invalidationReasons[i]}: ${model.invalidationDetails[i] ?? ''}`);
    }
  }

  return lines.join('\n');
}

function renderNextSteps(model: ExportModel): string {
  const lines = ['### Next Steps'];
  lines.push('');

  for (const f of model.followUps) {
    lines.push(`- **${f.action}:** ${f.reason}`);
    if (f.command) {
      lines.push(`  - \`${f.command}\``);
    }
  }

  if (model.recommendedNextStep && !model.followUps.some(f => f.command === model.recommendedNextStep)) {
    lines.push(`- **Recommended:** \`${model.recommendedNextStep}\``);
  }

  return lines.join('\n');
}

function renderEvidenceRefs(model: ExportModel): string {
  const lines = [
    '<details>',
    '<summary>Evidence References</summary>',
    '',
  ];

  for (const ref of model.evidenceRefs) {
    lines.push(`- **${ref.label}**: \`${ref.command}\``);
  }

  lines.push('');
  lines.push(`Generated: ${model.generatedAt}`);
  if (model.evidenceFingerprint) {
    lines.push(`Fingerprint: \`${model.evidenceFingerprint}\``);
  }

  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}
