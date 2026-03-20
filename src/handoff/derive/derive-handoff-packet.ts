/**
 * Handoff Spine — Main derivation entry point.
 *
 * Derives a canonical handoff packet from execution truth.
 * Conservative and truthful — does not derive from freeform chat
 * unless that content was promoted into execution truth.
 */

import type {
  HandoffPacket,
  HandoffScope,
  HandoffInstructionLayer,
  HandoffLane,
} from '../schema/packet.js';
import { generateId, nowISO } from '../../lib/ids.js';
import { computePacketHash } from '../integrity/hash.js';
import { deriveOpenLoops, type OpenLoopSource } from './derive-open-loops.js';
import { deriveDecisions, deriveRejections, type DecisionSource, type RejectionSource } from './derive-decisions.js';
import { deriveArtifactRefs, type ArtifactRefSource } from './derive-artifact-refs.js';

export interface DeriveHandoffInput {
  projectId: string;
  runId: string;
  repoRoot?: string;
  lane?: HandoffLane;
  sourcePacketId?: string;

  summary: string;
  instructions: HandoffInstructionLayer;

  decisionSource: DecisionSource;
  rejectionSource: RejectionSource;
  openLoopSource: OpenLoopSource;
  artifactSource: ArtifactRefSource;
}

/**
 * Derive a canonical handoff packet from execution truth sources.
 * The returned packet includes a computed content hash.
 */
export function deriveHandoffPacket(input: DeriveHandoffInput): HandoffPacket {
  const scope: HandoffScope = {
    projectId: input.projectId,
    runId: input.runId,
    repoRoot: input.repoRoot,
    lane: input.lane,
    sourcePacketId: input.sourcePacketId,
  };

  const decisions = deriveDecisions(input.decisionSource);
  const rejected = deriveRejections(input.rejectionSource);
  const openLoops = deriveOpenLoops(input.openLoopSource);
  const artifacts = deriveArtifactRefs(input.artifactSource);

  const contentFields = {
    summary: input.summary,
    instructions: input.instructions,
    decisions,
    rejected,
    openLoops,
    artifacts,
    scope,
  };

  const contentHash = computePacketHash(contentFields);

  return {
    handoffId: generateId('ho'),
    packetVersion: 1,
    createdAt: nowISO(),
    derivedFromRunId: input.runId,
    scope,
    summary: input.summary,
    instructions: input.instructions,
    decisions,
    rejected,
    openLoops,
    artifacts,
    contentHash,
  };
}
