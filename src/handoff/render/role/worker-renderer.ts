/**
 * Handoff Spine — Worker role renderer.
 *
 * Prioritizes:
 * - Authoritative instructions
 * - Hard constraints / prohibitions
 * - Current state summary
 * - Open loops owned by worker
 * - Exact artifact refs needed for execution
 */

import type { RoleRenderer, RoleRendererInput, RoleRenderedContext } from '../../schema/render.js';
import type { HandoffPacket } from '../../schema/packet.js';
import { truncateToTokenBudget, allocateBudget } from '../truncation-policy.js';

const RENDERER_VERSION = '1.0.0';

function renderInstructions(packet: HandoffPacket): string {
  const lines: string[] = [];

  if (packet.instructions.authoritative.length > 0) {
    lines.push('## Authoritative Instructions');
    for (const inst of packet.instructions.authoritative) {
      lines.push(`- ${inst}`);
    }
    lines.push('');
  }

  if (packet.instructions.constraints.length > 0) {
    lines.push('## Constraints');
    for (const c of packet.instructions.constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (packet.instructions.prohibitions.length > 0) {
    lines.push('## Prohibitions');
    for (const p of packet.instructions.prohibitions) {
      lines.push(`- DO NOT: ${p}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderState(packet: HandoffPacket): string {
  const lines = [
    '## Current State',
    packet.summary,
    '',
    `Project: ${packet.scope.projectId}`,
    `Run: ${packet.derivedFromRunId}`,
  ];

  if (packet.scope.lane) lines.push(`Lane: ${packet.scope.lane}`);
  if (packet.scope.repoRoot) lines.push(`Repo: ${packet.scope.repoRoot}`);

  return lines.join('\n');
}

function renderDecisions(packet: HandoffPacket): string {
  if (packet.decisions.length === 0 && packet.rejected.length === 0) return '';

  const lines: string[] = [];

  if (packet.decisions.length > 0) {
    lines.push('## Decisions (do not re-litigate)');
    for (const d of packet.decisions) {
      lines.push(`- ${d.summary}`);
      lines.push(`  Rationale: ${d.rationale}`);
    }
    lines.push('');
  }

  if (packet.rejected.length > 0) {
    lines.push('## Rejected Approaches (do not retry)');
    for (const r of packet.rejected) {
      lines.push(`- ${r.summary}: ${r.rationale}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderOpenLoops(packet: HandoffPacket): string {
  const workerLoops = packet.openLoops.filter(l => !l.ownerRole || l.ownerRole === 'worker');
  if (workerLoops.length === 0) return '';

  const lines = ['## Open Loops (your responsibility)'];
  const sorted = [...workerLoops].sort((a, b) => {
    const prio = { high: 0, medium: 1, low: 2 };
    return prio[a.priority] - prio[b.priority];
  });

  for (const loop of sorted) {
    lines.push(`- [${loop.priority.toUpperCase()}] ${loop.summary}`);
  }

  return lines.join('\n');
}

function renderArtifacts(packet: HandoffPacket): string {
  if (packet.artifacts.length === 0) return '';

  const lines = ['## Artifact References'];
  for (const a of packet.artifacts) {
    const parts = [`- ${a.name} (${a.kind})`];
    if (a.version) parts.push(`v${a.version}`);
    if (a.contentHash) parts.push(`hash:${a.contentHash.slice(0, 12)}`);
    lines.push(parts.join(' '));
  }

  return lines.join('\n');
}

export class WorkerRenderer implements RoleRenderer {
  readonly role = 'worker' as const;
  readonly version = RENDERER_VERSION;

  render(input: RoleRendererInput): RoleRenderedContext {
    const { packet, tokenBudget } = input;
    const warnings: string[] = [];

    let instructionBlock = renderInstructions(packet);
    let stateBlock = renderState(packet);
    let decisionsBlock = renderDecisions(packet);
    let openLoopsBlock = renderOpenLoops(packet);
    let artifactBlock = renderArtifacts(packet);

    if (tokenBudget) {
      const budget = allocateBudget(tokenBudget, {
        instruction: 3,
        state: 2,
        decisions: 2,
        openLoops: 2,
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
      role: 'worker',
      rendererVersion: this.version,
      instructionBlock,
      stateBlock,
      decisionsBlock,
      openLoopsBlock,
      artifactBlock,
      warnings,
    };
  }
}
