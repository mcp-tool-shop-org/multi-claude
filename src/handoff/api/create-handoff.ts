/**
 * Handoff Spine — Create handoff API.
 *
 * Derives a packet from execution truth, stores it durably,
 * and returns the created packet with its ID.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket } from '../schema/packet.js';
import type { LineageRelation } from '../schema/version.js';
import { deriveHandoffPacket, type DeriveHandoffInput } from '../derive/derive-handoff-packet.js';
import { nowISO } from '../../lib/ids.js';

export interface CreateHandoffInput extends DeriveHandoffInput {
  parentHandoffId?: string;
  lineageRelation?: LineageRelation;
}

export interface CreateHandoffResult {
  ok: true;
  packet: HandoffPacket;
}

/**
 * Create a new handoff packet from execution truth sources.
 * Stores the packet identity, version snapshot, and optional lineage.
 */
export function createHandoff(
  store: HandoffStore,
  input: CreateHandoffInput,
): CreateHandoffResult {
  const packet = deriveHandoffPacket(input);
  const now = nowISO();

  store.transaction(() => {
    // 1. Create packet identity
    store.createPacket({
      handoffId: packet.handoffId,
      projectId: input.projectId,
      runId: input.runId,
      currentVersion: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Store immutable version snapshot
    store.insertVersion({
      handoffId: packet.handoffId,
      packetVersion: 1,
      createdAt: now,
      summary: packet.summary,
      instructionsJson: JSON.stringify(packet.instructions),
      decisionsJson: JSON.stringify(packet.decisions),
      rejectedJson: JSON.stringify(packet.rejected),
      openLoopsJson: JSON.stringify(packet.openLoops),
      artifactsJson: JSON.stringify(packet.artifacts),
      scopeJson: JSON.stringify(packet.scope),
      contentHash: packet.contentHash,
    });

    // 3. Store artifact index records
    for (const artifact of packet.artifacts) {
      store.insertArtifact({
        artifactId: artifact.id,
        handoffId: packet.handoffId,
        packetVersion: 1,
        name: artifact.name,
        kind: artifact.kind,
        version: artifact.version,
        mediaType: artifact.mediaType,
        contentHash: artifact.contentHash,
        storageRef: artifact.storageRef,
        sizeBytes: artifact.sizeBytes,
        createdAt: now,
      });
    }

    // 4. Record lineage if parent specified
    if (input.parentHandoffId) {
      store.insertLineage({
        handoffId: packet.handoffId,
        parentHandoffId: input.parentHandoffId,
        relation: input.lineageRelation ?? 'derived_from',
        createdAt: now,
      });
    }
  });

  return { ok: true, packet };
}
