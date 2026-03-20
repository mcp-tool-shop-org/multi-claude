/**
 * Handoff Spine — Resolve last valid handoff version.
 *
 * Walks versions in reverse order, skipping invalidated ones,
 * and returns the last valid packet. This is the trust anchor
 * for recovery: "what was the last known-good state?"
 *
 * Resolution is deterministic and exact — no fuzzy matching.
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket, HandoffId } from '../schema/packet.js';

// ── Result types ─────────────────────────────────────────────────────

export interface ResolvedHandoff {
  ok: true;
  packet: HandoffPacket;
  /** The version number that was resolved (may be < currentVersion) */
  resolvedVersion: number;
  /** True if the resolved version is not the latest (i.e., newer versions were invalidated) */
  isRollback: boolean;
  /** Number of versions that were skipped due to invalidation */
  skippedVersions: number;
}

export interface ResolvedHandoffError {
  ok: false;
  error: string;
  /** Reason code for structured logging */
  reason: 'not_found' | 'all_invalidated' | 'no_versions';
  handoffId?: string;
}

// ── Resolver: by handoff ID ──────────────────────────────────────────

/**
 * Resolve the last valid version of a handoff packet.
 * Walks versions from newest to oldest, skipping invalidated ones.
 */
export function resolveLastValidHandoff(
  store: HandoffStore,
  handoffId: HandoffId,
): ResolvedHandoff | ResolvedHandoffError {
  const record = store.getPacket(handoffId);
  if (!record) {
    return { ok: false, error: `Handoff '${handoffId}' not found`, reason: 'not_found', handoffId };
  }

  const versions = store.listVersions(handoffId);
  if (versions.length === 0) {
    return { ok: false, error: `Handoff '${handoffId}' has no versions`, reason: 'no_versions', handoffId };
  }

  // Walk from newest to oldest
  let skippedVersions = 0;
  for (let i = versions.length - 1; i >= 0; i--) {
    const version = versions[i]!;
    if (!store.isVersionInvalidated(handoffId, version.packetVersion)) {
      const packet = store.reconstructPacket(handoffId, version.packetVersion);
      if (packet) {
        return {
          ok: true,
          packet,
          resolvedVersion: version.packetVersion,
          isRollback: version.packetVersion < record.currentVersion,
          skippedVersions,
        };
      }
    }
    skippedVersions++;
  }

  return {
    ok: false,
    error: `All ${versions.length} version(s) of handoff '${handoffId}' are invalidated`,
    reason: 'all_invalidated',
    handoffId,
  };
}

// ── Resolver: by source packet ID (execution DB packet_id) ──────────

/**
 * Find the most recent handoff for a given source packet ID,
 * then resolve its last valid version.
 *
 * This is the bridge between "execution DB packet failed" and
 * "what was the last valid handoff state for this packet?"
 */
export function resolveLastValidHandoffForPacket(
  store: HandoffStore,
  sourcePacketId: string,
  projectId: string,
): ResolvedHandoff | ResolvedHandoffError {
  // Query handoff_packet_versions for scope containing this sourcePacketId
  // Since HandoffStore doesn't have a direct query for this, we look through
  // packet records by project and check scope
  const handoffId = findHandoffBySourcePacket(store, sourcePacketId, projectId);
  if (!handoffId) {
    return {
      ok: false,
      error: `No handoff found for source packet '${sourcePacketId}' in project '${projectId}'`,
      reason: 'not_found',
    };
  }

  return resolveLastValidHandoff(store, handoffId);
}

/**
 * Find the handoff ID for a given source packet ID by scanning versions.
 * Returns the most recent handoff that references this source packet.
 */
function findHandoffBySourcePacket(
  store: HandoffStore,
  sourcePacketId: string,
  projectId: string,
): HandoffId | null {
  // We need to query by project_id and then check scope JSON for sourcePacketId.
  // The store has getPacket by ID, but we need a project-scoped lookup.
  // Use the DB directly via the store's internal methods.
  // Since we don't have a direct query, we use a pragmatic approach:
  // query the handoff_packets table filtered by project_id, then check scopes.
  const db = (store as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } } }).db;

  const rows = db.prepare(
    `SELECT hp.handoff_id, hpv.scope_json
     FROM handoff_packets hp
     JOIN handoff_packet_versions hpv ON hpv.handoff_id = hp.handoff_id
     WHERE hp.project_id = ?
     ORDER BY hp.created_at DESC, hpv.packet_version DESC`,
  ).all(projectId) as Array<{ handoff_id: string; scope_json: string }>;

  for (const row of rows) {
    try {
      const scope = JSON.parse(row.scope_json) as { sourcePacketId?: string };
      if (scope.sourcePacketId === sourcePacketId) {
        return row.handoff_id;
      }
    } catch {
      // Skip malformed scope JSON
    }
  }

  return null;
}
