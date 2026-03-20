/**
 * Handoff Spine — Approver role renderer.
 *
 * Prioritizes:
 * - Approval target
 * - Evidence fingerprint
 * - Decision summary
 * - Policy-relevant risks
 * - Exact artifacts to inspect
 */

import type { RoleRenderer, RoleRendererInput, RoleRenderedContext } from '../../schema/render.js';
import type { HandoffPacket } from '../../schema/packet.js';
import { truncateToTokenBudget, allocateBudget } from '../truncation-policy.js';

const RENDERER_VERSION = '1.0.0';

export class ApproverRenderer implements RoleRenderer {
  readonly role = 'approver' as const;
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
        instruction: 2,
        state: 1,
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
      role: 'approver',
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
      '## Approval Context',
      'You are the approver for this handoff packet.',
      'Verify that decisions are sound, evidence is present, and risks are acceptable.',
      '',
    ];

    if (packet.instructions.prohibitions.length > 0) {
      lines.push('## Policy Prohibitions');
      for (const p of packet.instructions.prohibitions) {
        lines.push(`- ${p}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderState(packet: HandoffPacket): string {
    return [
      '## Approval Target',
      `Packet: ${packet.handoffId} v${packet.packetVersion}`,
      `Project: ${packet.scope.projectId}`,
      `Run: ${packet.derivedFromRunId}`,
      `Hash: ${packet.contentHash}`,
      '',
      packet.summary,
    ].join('\n');
  }

  private renderDecisions(packet: HandoffPacket): string {
    if (packet.decisions.length === 0) return '';

    const lines = ['## Decisions Requiring Approval'];
    for (const d of packet.decisions) {
      lines.push(`### ${d.summary}`);
      lines.push(`Rationale: ${d.rationale}`);
      if (d.evidenceRefs?.length) {
        lines.push(`Evidence: ${d.evidenceRefs.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderOpenLoops(packet: HandoffPacket): string {
    const riskLoops = packet.openLoops.filter(l => l.priority === 'high');
    if (riskLoops.length === 0) return '';

    const lines = ['## Policy-Relevant Risks'];
    for (const loop of riskLoops) {
      lines.push(`- [${loop.priority.toUpperCase()}] ${loop.summary}`);
    }

    return lines.join('\n');
  }

  private renderArtifacts(packet: HandoffPacket): string {
    if (packet.artifacts.length === 0) return '';

    const lines = ['## Artifacts to Inspect'];
    for (const a of packet.artifacts) {
      lines.push(`- **${a.name}** (${a.kind})`);
      if (a.contentHash) lines.push(`  Hash: ${a.contentHash}`);
      lines.push(`  Location: ${a.storageRef}`);
    }

    return lines.join('\n');
  }
}
