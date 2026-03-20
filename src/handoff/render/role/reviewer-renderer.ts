/**
 * Handoff Spine — Reviewer role renderer.
 *
 * Prioritizes:
 * - What changed
 * - Decisions + rationale
 * - Risks / unresolved loops
 * - Evidence refs
 * - Invalidations and approval context
 */

import type { RoleRenderer, RoleRendererInput, RoleRenderedContext } from '../../schema/render.js';
import type { HandoffPacket } from '../../schema/packet.js';
import { truncateToTokenBudget, allocateBudget } from '../truncation-policy.js';

const RENDERER_VERSION = '1.0.0';

export class ReviewerRenderer implements RoleRenderer {
  readonly role = 'reviewer' as const;
  readonly version = RENDERER_VERSION;

  render(input: RoleRendererInput): RoleRenderedContext {
    const { packet, tokenBudget } = input;
    const warnings: string[] = [];

    let instructionBlock = this.renderInstructions(packet);
    let stateBlock = this.renderState(packet);
    let decisionsBlock = this.renderDecisions(packet);
    let openLoopsBlock = this.renderOpenLoops(packet);
    let artifactBlock = this.renderArtifacts(packet);

    if (tokenBudget) {
      const budget = allocateBudget(tokenBudget, {
        instruction: 1,
        state: 2,
        decisions: 3,
        openLoops: 2,
        artifacts: 2,
      });

      const trInst = truncateToTokenBudget(instructionBlock, budget.get('instruction')!);
      const trState = truncateToTokenBudget(stateBlock, budget.get('state')!);
      const trDec = truncateToTokenBudget(decisionsBlock, budget.get('decisions')!);
      const trLoops = truncateToTokenBudget(openLoopsBlock, budget.get('openLoops')!);
      const trArt = truncateToTokenBudget(artifactBlock, budget.get('artifacts')!);

      instructionBlock = trInst.text;
      stateBlock = trState.text;
      decisionsBlock = trDec.text;
      openLoopsBlock = trLoops.text;
      artifactBlock = trArt.text;

      if (trInst.truncated || trState.truncated || trDec.truncated || trLoops.truncated || trArt.truncated) {
        warnings.push('Content was truncated to fit token budget');
      }
    }

    return {
      role: 'reviewer',
      rendererVersion: this.version,
      instructionBlock,
      stateBlock,
      decisionsBlock,
      openLoopsBlock,
      artifactBlock,
      warnings,
    };
  }

  private renderInstructions(packet: HandoffPacket): string {
    const lines = [
      '## Review Instructions',
      'You are reviewing the output of a completed execution run.',
      'Focus on: correctness, completeness, and whether decisions were sound.',
      '',
    ];

    if (packet.instructions.constraints.length > 0) {
      lines.push('## Active Constraints');
      for (const c of packet.instructions.constraints) {
        lines.push(`- ${c}`);
      }
    }

    return lines.join('\n');
  }

  private renderState(packet: HandoffPacket): string {
    return [
      '## What Changed',
      packet.summary,
      '',
      `Project: ${packet.scope.projectId} | Run: ${packet.derivedFromRunId}`,
      packet.scope.lane ? `Lane: ${packet.scope.lane}` : '',
    ].filter(Boolean).join('\n');
  }

  private renderDecisions(packet: HandoffPacket): string {
    const lines: string[] = [];

    if (packet.decisions.length > 0) {
      lines.push('## Decisions Made (review for soundness)');
      for (const d of packet.decisions) {
        lines.push(`### ${d.summary}`);
        lines.push(`Rationale: ${d.rationale}`);
        if (d.evidenceRefs?.length) {
          lines.push(`Evidence: ${d.evidenceRefs.join(', ')}`);
        }
        lines.push('');
      }
    }

    if (packet.rejected.length > 0) {
      lines.push('## Rejected Approaches');
      for (const r of packet.rejected) {
        lines.push(`- **${r.summary}**: ${r.rationale}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderOpenLoops(packet: HandoffPacket): string {
    if (packet.openLoops.length === 0) return '';

    const lines = ['## Unresolved Issues (assess risk)'];
    const sorted = [...packet.openLoops].sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return prio[a.priority] - prio[b.priority];
    });

    for (const loop of sorted) {
      const owner = loop.ownerRole ? ` → ${loop.ownerRole}` : '';
      lines.push(`- [${loop.priority.toUpperCase()}${owner}] ${loop.summary}`);
    }

    return lines.join('\n');
  }

  private renderArtifacts(packet: HandoffPacket): string {
    if (packet.artifacts.length === 0) return '';

    const lines = ['## Evidence / Artifacts (inspect these)'];
    for (const a of packet.artifacts) {
      lines.push(`- **${a.name}** (${a.kind}) — ${a.storageRef}`);
      if (a.contentHash) lines.push(`  Integrity: ${a.contentHash}`);
    }

    return lines.join('\n');
  }
}
