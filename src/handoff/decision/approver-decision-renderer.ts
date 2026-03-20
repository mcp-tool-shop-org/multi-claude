/**
 * Decision Briefs — Approver brief renderer.
 *
 * Approver mode is signoff mode. Brutally explicit. No vibes.
 * It answers:
 *   - what exact unit is being approved
 *   - whether approval is currently eligible
 *   - what evidence fingerprint is bound
 *   - what blockers must be cleared first
 *   - whether this is safe to approve, reject, or bounce to recovery
 */

import type { DecisionBrief } from './types.js';

/**
 * Render an approver-facing decision brief as structured text.
 */
export function renderApproverBrief(brief: DecisionBrief): string {
  const lines: string[] = [];

  lines.push(`## Approver Brief — ${brief.handoffId} v${brief.packetVersion}`);
  lines.push('');

  // Approval target — what exactly is being signed
  lines.push('### Approval Target');
  lines.push(`- Handoff: ${brief.handoffId}`);
  lines.push(`- Version: ${brief.packetVersion}`);
  if (brief.baselinePacketVersion !== null) {
    lines.push(`- Baseline: v${brief.baselinePacketVersion}`);
  }
  lines.push(`- Fingerprint: ${brief.evidenceCoverage.fingerprint}`);
  lines.push(`- Brief: ${brief.briefId} (${brief.briefVersion})`);
  lines.push('');

  // Eligibility verdict — the core question
  const isApprovable = brief.eligibility.allowedActions.includes('approve');
  const highBlockers = brief.blockers.filter(b => b.severity === 'high');

  lines.push('### Eligibility');
  if (isApprovable && highBlockers.length === 0) {
    lines.push('**ELIGIBLE FOR APPROVAL**');
  } else if (isApprovable) {
    lines.push('**ELIGIBLE WITH CAVEATS**');
  } else {
    lines.push('**NOT ELIGIBLE FOR APPROVAL**');
  }
  for (const r of brief.eligibility.rationale) {
    lines.push(`- ${r}`);
  }
  lines.push('');

  // Blockers — what must be cleared
  if (brief.blockers.length > 0) {
    lines.push('### Blockers');
    for (const blocker of brief.blockers) {
      lines.push(`- [${blocker.severity.toUpperCase()}] \`${blocker.code}\`: ${blocker.summary}`);
    }
    lines.push('');
  }

  // Delta (concise for approver)
  if (brief.deltaSummary.length > 0) {
    lines.push('### Changes');
    for (const delta of brief.deltaSummary) {
      lines.push(`- ${delta}`);
    }
    lines.push('');
  }

  // Evidence — what the approval binds to
  lines.push('### Bound Evidence');
  lines.push(`- Artifacts present: ${brief.evidenceCoverage.presentArtifacts.length}`);
  if (brief.evidenceCoverage.missingArtifacts.length > 0) {
    lines.push(`- **Missing:** ${brief.evidenceCoverage.missingArtifacts.join(', ')}`);
  }
  lines.push(`- Output hash: ${brief.evidenceCoverage.fingerprint}`);
  lines.push('');

  // Risks (only if present)
  if (brief.risks.length > 0) {
    lines.push('### Risks');
    for (const risk of brief.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  // Available actions
  lines.push('### Available Actions');
  lines.push(`Recommended: **${brief.eligibility.recommendedAction}**`);
  lines.push(`Allowed: ${brief.eligibility.allowedActions.join(', ')}`);

  return lines.join('\n');
}
