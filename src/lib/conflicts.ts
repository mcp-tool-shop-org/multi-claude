import type Database from 'better-sqlite3';

interface ActiveClaim {
  claim_id: string;
  packet_id: string;
  claimed_by: string;
  role: string;
  feature_id: string;
}

/**
 * Check the role conflict matrix for a proposed claim.
 *
 * Forbidden combinations:
 * - Builder + Verifier on same packet
 * - Builder + Integrator on same feature
 * - Coordinator + Builder in same session (not enforced here — session-level)
 * - Sweep + any file-modifying role in same session (not enforced here)
 *
 * Returns null if no conflict, or a description of the conflict.
 */
export function checkRoleConflict(
  db: Database.Database,
  packetId: string,
  featureId: string,
  worker: string,
  role: string,
): { conflict_type: string; conflicting_claim: string } | null {
  // Rule: Integrator must not have built any packet in this feature
  if (role === 'integrator') {
    const builtPacket = db.prepare(`
      SELECT pa.attempt_id, pa.packet_id
      FROM packet_attempts pa
      JOIN packets p ON p.packet_id = pa.packet_id
      WHERE p.feature_id = ? AND pa.started_by = ?
      LIMIT 1
    `).get(featureId, worker) as { attempt_id: string; packet_id: string } | undefined;

    if (builtPacket) {
      return {
        conflict_type: 'integrator_built_in_feature',
        conflicting_claim: `Worker '${worker}' built packet '${builtPacket.packet_id}' in this feature`,
      };
    }
  }

  // Rule: Verifier must not have built the same packet
  if (role === 'verifier' || role === 'verifier-checklist' || role === 'verifier-analysis') {
    const builtThis = db.prepare(`
      SELECT pa.attempt_id
      FROM packet_attempts pa
      WHERE pa.packet_id = ? AND pa.started_by = ?
      LIMIT 1
    `).get(packetId, worker) as { attempt_id: string } | undefined;

    if (builtThis) {
      return {
        conflict_type: 'verifier_built_same_packet',
        conflicting_claim: `Worker '${worker}' previously built this packet`,
      };
    }
  }

  return null;
}
