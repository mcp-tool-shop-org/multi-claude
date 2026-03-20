/**
 * Decision Briefs — Reviewer brief renderer.
 *
 * Reviewer mode is delta-first and evidence-aware.
 * It answers:
 *   - what changed
 *   - what seems risky
 *   - what is unresolved
 *   - what evidence exists
 *   - what deserves inspection
 */

import type { DecisionBrief } from './types.js';

/**
 * Render a reviewer-facing decision brief as structured text.
 */
export function renderReviewerBrief(brief: DecisionBrief): string {
  const lines: string[] = [];

  lines.push(`## Reviewer Brief — ${brief.handoffId} v${brief.packetVersion}`);
  lines.push('');

  // Summary
  lines.push(`**Summary:** ${brief.summary}`);
  lines.push('');

  // Delta (the primary view for reviewers)
  if (brief.baselinePacketVersion !== null) {
    lines.push(`### What Changed (vs v${brief.baselinePacketVersion})`);
  } else {
    lines.push('### Initial Version (no baseline)');
  }
  for (const delta of brief.deltaSummary) {
    lines.push(`- ${delta}`);
  }
  lines.push('');

  // Risks
  if (brief.risks.length > 0) {
    lines.push('### Risks');
    for (const risk of brief.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  // Blockers
  if (brief.blockers.length > 0) {
    lines.push('### Blockers');
    for (const blocker of brief.blockers) {
      lines.push(`- [${blocker.severity.toUpperCase()}] ${blocker.summary}`);
    }
    lines.push('');
  }

  // Open loops
  if (brief.openLoops.length > 0) {
    lines.push('### Open Loops');
    for (const loop of brief.openLoops) {
      lines.push(`- ${loop}`);
    }
    lines.push('');
  }

  // Evidence coverage
  lines.push('### Evidence');
  lines.push(`- Present: ${brief.evidenceCoverage.presentArtifacts.length} artifact(s)`);
  if (brief.evidenceCoverage.missingArtifacts.length > 0) {
    lines.push(`- Missing: ${brief.evidenceCoverage.missingArtifacts.join(', ')}`);
  }
  lines.push(`- Fingerprint: ${brief.evidenceCoverage.fingerprint.slice(0, 12)}…`);
  lines.push('');

  // Decisions for review
  if (brief.decisionRefs.length > 0) {
    lines.push('### Decisions to Review');
    for (const ref of brief.decisionRefs) {
      lines.push(`- ${ref}`);
    }
    lines.push('');
  }

  // Recommendation
  lines.push('### Recommendation');
  lines.push(`**${brief.eligibility.recommendedAction.toUpperCase()}**`);
  for (const r of brief.eligibility.rationale) {
    lines.push(`- ${r}`);
  }

  return lines.join('\n');
}
