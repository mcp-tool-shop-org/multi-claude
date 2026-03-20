/**
 * Handoff Spine — Recovery role renderer.
 *
 * Prioritizes:
 * - Stop reason / failure point
 * - Last trusted packet version
 * - Invalidations
 * - Resumable open loops
 * - Artifacts needed to recover truthfully
 */

import type { RoleRenderer, RoleRendererInput, RoleRenderedContext } from '../../schema/render.js';
import type { HandoffPacket } from '../../schema/packet.js';
import { truncateToTokenBudget, allocateBudget } from '../truncation-policy.js';

const RENDERER_VERSION = '1.0.0';

export class RecoveryRenderer implements RoleRenderer {
  readonly role = 'recovery' as const;
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
        state: 3,
        decisions: 1,
        openLoops: 3,
        artifacts: 1,
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
      role: 'recovery',
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
      '## Recovery Context',
      'This packet represents state that needs recovery.',
      'Do NOT invent state. Only work from what is documented here.',
      'If information is missing, flag it — do not fabricate.',
      '',
    ];

    if (packet.instructions.authoritative.length > 0) {
      lines.push('## Recovery Instructions');
      for (const inst of packet.instructions.authoritative) {
        lines.push(`- ${inst}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private renderState(packet: HandoffPacket): string {
    return [
      '## Failure / Stop Point',
      `Packet: ${packet.handoffId} v${packet.packetVersion}`,
      `Run: ${packet.derivedFromRunId}`,
      `Hash: ${packet.contentHash}`,
      '',
      '### Last Known State',
      packet.summary,
    ].join('\n');
  }

  private renderDecisions(packet: HandoffPacket): string {
    if (packet.decisions.length === 0) return '';

    const lines = ['## Prior Decisions (preserve unless explicitly overridden)'];
    for (const d of packet.decisions) {
      lines.push(`- ${d.summary}: ${d.rationale}`);
    }

    return lines.join('\n');
  }

  private renderOpenLoops(packet: HandoffPacket): string {
    if (packet.openLoops.length === 0) return '';

    const lines = ['## Resumable Open Loops'];
    const sorted = [...packet.openLoops].sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return prio[a.priority] - prio[b.priority];
    });

    for (const loop of sorted) {
      const owner = loop.ownerRole ? ` (${loop.ownerRole})` : '';
      lines.push(`- [${loop.priority.toUpperCase()}${owner}] ${loop.summary}`);
    }

    return lines.join('\n');
  }

  private renderArtifacts(packet: HandoffPacket): string {
    if (packet.artifacts.length === 0) return '';

    const lines = ['## Recovery Artifacts'];
    for (const a of packet.artifacts) {
      lines.push(`- ${a.name} (${a.kind}) — ${a.storageRef}`);
    }

    return lines.join('\n');
  }
}
