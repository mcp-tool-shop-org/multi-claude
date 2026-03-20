/**
 * Supervisor Loop — Durable store.
 *
 * Handles claims, leases, and supervisor events.
 * All reads are exact-lookup. No fuzzy queries.
 */

import type Database from 'better-sqlite3';
import type { SupervisorClaim, ClaimStatus, SupervisorEvent, SupervisorEventKind } from './types.js';
import { migrateSupervisorSchema } from './supervisor-sql.js';
import { nowISO } from '../../lib/ids.js';

export class SupervisorStore {
  constructor(private readonly db: Database.Database) {}

  migrate(): void {
    migrateSupervisorSchema(this.db);
  }

  // ── Claims ───────────────────────────────────────────────────────

  insertClaim(claim: SupervisorClaim): void {
    this.db.prepare(`
      INSERT INTO supervisor_claims
        (claim_id, queue_item_id, claimed_by, claimed_at, status,
         lease_expires_at, deferred_until, escalation_target, last_reason, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      claim.claimId,
      claim.queueItemId,
      claim.claimedBy,
      claim.claimedAt,
      claim.status,
      claim.leaseExpiresAt,
      claim.deferredUntil,
      claim.escalationTarget,
      claim.lastReason,
      claim.updatedAt,
    );
  }

  getClaim(claimId: string): SupervisorClaim | null {
    const row = this.db.prepare(
      `SELECT * FROM supervisor_claims WHERE claim_id = ?`
    ).get(claimId) as Record<string, unknown> | undefined;

    return row ? this.rowToClaim(row) : null;
  }

  /**
   * Get the active claim for a queue item, if any.
   * Returns null if no active claim exists.
   */
  getActiveClaim(queueItemId: string): SupervisorClaim | null {
    const row = this.db.prepare(
      `SELECT * FROM supervisor_claims
       WHERE queue_item_id = ? AND status = 'active'
       ORDER BY claimed_at DESC LIMIT 1`
    ).get(queueItemId) as Record<string, unknown> | undefined;

    return row ? this.rowToClaim(row) : null;
  }

  /**
   * Get the active or deferred claim for a queue item.
   */
  getActiveOrDeferredClaim(queueItemId: string): SupervisorClaim | null {
    const row = this.db.prepare(
      `SELECT * FROM supervisor_claims
       WHERE queue_item_id = ? AND status IN ('active', 'deferred')
       ORDER BY claimed_at DESC LIMIT 1`
    ).get(queueItemId) as Record<string, unknown> | undefined;

    return row ? this.rowToClaim(row) : null;
  }

  /**
   * List claims, optionally filtered.
   */
  listClaims(opts?: {
    activeOnly?: boolean;
    actor?: string;
  }): SupervisorClaim[] {
    let sql = `SELECT * FROM supervisor_claims`;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts?.activeOnly !== false) {
      conditions.push("status IN ('active', 'deferred')");
    }

    if (opts?.actor) {
      conditions.push('claimed_by = @actor');
      params.actor = opts.actor;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY claimed_at DESC';

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map(r => this.rowToClaim(r));
  }

  updateClaimStatus(claimId: string, status: ClaimStatus, reason: string): void {
    this.db.prepare(
      `UPDATE supervisor_claims SET status = ?, last_reason = ?, updated_at = ? WHERE claim_id = ?`
    ).run(status, reason, nowISO(), claimId);
  }

  updateClaimDefer(claimId: string, deferredUntil: string, reason: string): void {
    this.db.prepare(
      `UPDATE supervisor_claims SET status = 'deferred', deferred_until = ?, last_reason = ?, updated_at = ? WHERE claim_id = ?`
    ).run(deferredUntil, reason, nowISO(), claimId);
  }

  updateClaimEscalate(claimId: string, target: string, reason: string): void {
    this.db.prepare(
      `UPDATE supervisor_claims SET status = 'escalated', escalation_target = ?, last_reason = ?, updated_at = ? WHERE claim_id = ?`
    ).run(target, reason, nowISO(), claimId);
  }

  /**
   * Find all active claims with expired leases.
   */
  findExpiredClaims(now: string): SupervisorClaim[] {
    const rows = this.db.prepare(
      `SELECT * FROM supervisor_claims
       WHERE status = 'active' AND lease_expires_at <= ?
       ORDER BY lease_expires_at ASC`
    ).all(now) as Record<string, unknown>[];
    return rows.map(r => this.rowToClaim(r));
  }

  /**
   * Find deferred claims that are now eligible (deferred_until has passed).
   */
  findEligibleDeferred(now: string): SupervisorClaim[] {
    const rows = this.db.prepare(
      `SELECT * FROM supervisor_claims
       WHERE status = 'deferred' AND deferred_until IS NOT NULL AND deferred_until <= ?
       ORDER BY deferred_until ASC`
    ).all(now) as Record<string, unknown>[];
    return rows.map(r => this.rowToClaim(r));
  }

  // ── Events ───────────────────────────────────────────────────────

  insertEvent(event: SupervisorEvent): void {
    this.db.prepare(`
      INSERT INTO supervisor_events
        (claim_id, queue_item_id, kind, from_status, to_status,
         actor, reason, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.claimId,
      event.queueItemId,
      event.kind,
      event.fromStatus ?? null,
      event.toStatus,
      event.actor,
      event.reason,
      event.metadata ?? null,
      event.createdAt,
    );
  }

  getEvents(claimId: string): SupervisorEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM supervisor_events WHERE claim_id = ? ORDER BY created_at ASC`
    ).all(claimId) as Record<string, unknown>[];
    return rows.map(r => this.rowToEvent(r));
  }

  getEventsByQueueItem(queueItemId: string): SupervisorEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM supervisor_events WHERE queue_item_id = ? ORDER BY created_at ASC`
    ).all(queueItemId) as Record<string, unknown>[];
    return rows.map(r => this.rowToEvent(r));
  }

  // ── Internal ─────────────────────────────────────────────────────

  private rowToClaim(row: Record<string, unknown>): SupervisorClaim {
    return {
      claimId: row.claim_id as string,
      queueItemId: row.queue_item_id as string,
      claimedBy: row.claimed_by as string,
      claimedAt: row.claimed_at as string,
      status: row.status as ClaimStatus,
      leaseExpiresAt: row.lease_expires_at as string,
      deferredUntil: (row.deferred_until as string) ?? null,
      escalationTarget: (row.escalation_target as string) ?? null,
      lastReason: row.last_reason as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToEvent(row: Record<string, unknown>): SupervisorEvent {
    return {
      eventId: row.event_id as number,
      claimId: row.claim_id as string,
      queueItemId: row.queue_item_id as string,
      kind: row.kind as SupervisorEventKind,
      fromStatus: (row.from_status as ClaimStatus) ?? undefined,
      toStatus: row.to_status as ClaimStatus,
      actor: row.actor as string,
      reason: row.reason as string,
      metadata: (row.metadata as string) ?? undefined,
      createdAt: row.created_at as string,
    };
  }
}
