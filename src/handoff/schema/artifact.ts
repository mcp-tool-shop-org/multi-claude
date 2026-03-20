/**
 * Handoff Spine — Artifact schema.
 *
 * Artifact refs are stored in the DB as an index.
 * Artifact bodies are stored in the CAS by content hash.
 * Packets reference artifacts by stable IDs and hashes.
 */

import type { ArtifactKind, HandoffId, PacketVersion, ContentHash } from './packet.js';

export interface HandoffArtifactRecord {
  artifactId: string;
  handoffId: HandoffId;
  packetVersion: PacketVersion;
  name: string;
  kind: ArtifactKind;
  version?: string;
  mediaType?: string;
  contentHash?: ContentHash;
  storageRef: string;
  sizeBytes?: number;
  createdAt: string;
}
