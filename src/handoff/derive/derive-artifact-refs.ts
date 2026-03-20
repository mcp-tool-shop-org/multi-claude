/**
 * Handoff Spine — Derive artifact references from execution truth.
 *
 * Artifact refs point to files/logs/diffs stored in the CAS.
 * The packet references them by ID and hash, never embeds bodies.
 */

import type { HandoffArtifactRef, ArtifactKind } from '../schema/packet.js';
import { generateId } from '../../lib/ids.js';

export interface ArtifactRefSource {
  artifacts: Array<{
    name: string;
    kind: ArtifactKind;
    version?: string;
    mediaType?: string;
    contentHash?: string;
    storageRef: string;
    sizeBytes?: number;
  }>;
}

export function deriveArtifactRefs(source: ArtifactRefSource): HandoffArtifactRef[] {
  return source.artifacts.map(a => ({
    id: generateId('art'),
    name: a.name,
    kind: a.kind,
    version: a.version,
    mediaType: a.mediaType,
    contentHash: a.contentHash,
    storageRef: a.storageRef,
    sizeBytes: a.sizeBytes,
  }));
}
