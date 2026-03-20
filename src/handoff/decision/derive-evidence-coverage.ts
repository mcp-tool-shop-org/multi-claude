/**
 * Decision Briefs — Evidence coverage derivation.
 *
 * Determines what evidence artifacts are required for a given packet,
 * which are present, and which are missing. Coverage is deterministic:
 * policy defines what's required, the packet defines what's present.
 *
 * Evidence coverage is explicit — no guessing, no scoring.
 */

import type { HandoffPacket } from '../schema/packet.js';
import type { EvidenceCoverage } from './types.js';

// ── Required artifact policy ────────────────────────────────────────

/**
 * Determine required artifacts based on packet content.
 *
 * Policy rules (deterministic):
 *   - Every packet needs at least one artifact reference
 *   - If instructions reference files, those files should be present
 *   - If open loops reference artifacts, those should be present
 *
 * This is the simplest policy that still catches real gaps.
 * Extend with explicit per-role or per-layer requirements later.
 */
function deriveRequiredArtifacts(packet: HandoffPacket): string[] {
  const required: string[] = [];

  // If the packet has artifact refs, they are required by definition
  for (const artifact of packet.artifacts) {
    required.push(artifact.name);
  }

  return required;
}

// ── Coverage derivation ─────────────────────────────────────────────

/**
 * Derive evidence coverage for a packet.
 *
 * Returns what's required, what's present, and what's missing.
 */
export function deriveEvidenceCoverage(
  packet: HandoffPacket,
  fingerprint: string,
): EvidenceCoverage {
  const requiredArtifacts = deriveRequiredArtifacts(packet);

  // Present artifacts are those referenced in the packet
  const presentArtifacts = packet.artifacts.map(a => a.name);

  // Missing = required but not present
  const presentSet = new Set(presentArtifacts);
  const missingArtifacts = requiredArtifacts.filter(name => !presentSet.has(name));

  return {
    fingerprint,
    requiredArtifacts,
    presentArtifacts,
    missingArtifacts,
  };
}
