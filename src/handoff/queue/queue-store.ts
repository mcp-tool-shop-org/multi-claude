/**
 * Decision Queue — Durable store.
 *
 * Handles queue items, decision briefs, and queue events.
 * All reads are exact-lookup. Ordering is done at query time.
 */

import type Database from 'better-sqlite3';
import type { DecisionBrief } from '../decision/types.js';
import type { QueueItem, QueueItemStatus, PriorityClass, QueueEvent, QueueEventKind } from './types.js';
// PRIORITY_WEIGHT available from './types.js' if needed at runtime
import { migrateQueueSchema } from './queue-sql.js';
import { nowISO } from '../../lib/ids.js';

export class QueueStore {
  constructor(private readonly db: Database.Database) {}

  migrate(): void {
    migrateQueueSchema(this.db);
  }

  // ── Brief persistence ──────────────────────────────────────────

  insertBrief(brief: DecisionBrief): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO decision_briefs
        (brief_id, handoff_id, packet_version, baseline_packet_version, brief_version,
         role, summary, delta_summary_json, blockers_json, evidence_coverage_json,
         eligibility_json, risks_json, open_loops_json, decision_refs_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      brief.briefId,
      brief.handoffId,
      brief.packetVersion,
      brief.baselinePacketVersion,
      brief.briefVersion,
      brief.role,
      brief.summary,
      JSON.stringify(brief.deltaSummary),
      JSON.stringify(brief.blockers),
      JSON.stringify(brief.evidenceCoverage),
      JSON.stringify(brief.eligibility),
      JSON.stringify(brief.risks),
      JSON.stringify(brief.openLoops),
      JSON.stringify(brief.decisionRefs),
      brief.createdAt,
    );
  }

  getBrief(briefId: string): DecisionBrief | null {
    const row = this.db.prepare(
      `SELECT * FROM decision_briefs WHERE brief_id = ?`
    ).get(briefId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      briefId: row.brief_id as string,
      handoffId: row.handoff_id as string,
      packetVersion: row.packet_version as number,
      baselinePacketVersion: row.baseline_packet_version as number | null,
      briefVersion: row.brief_version as string,
      createdAt: row.created_at as string,
      role: row.role as 'reviewer' | 'approver',
      summary: row.summary as string,
      deltaSummary: JSON.parse(row.delta_summary_json as string),
      blockers: JSON.parse(row.blockers_json as string),
      evidenceCoverage: JSON.parse(row.evidence_coverage_json as string),
      eligibility: JSON.parse(row.eligibility_json as string),
      risks: JSON.parse(row.risks_json as string),
      openLoops: JSON.parse(row.open_loops_json as string),
      decisionRefs: JSON.parse(row.decision_refs_json as string),
    };
  }

  // ── Queue items ────────────────────────────────────────────────

  insertQueueItem(item: QueueItem): void {
    this.db.prepare(`
      INSERT INTO decision_queue_items
        (queue_item_id, handoff_id, packet_version, brief_id, role,
         status, priority_class, blocker_summary, eligibility_summary,
         evidence_fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.queueItemId,
      item.handoffId,
      item.packetVersion,
      item.briefId,
      item.role,
      item.status,
      item.priorityClass,
      item.blockerSummary,
      item.eligibilitySummary,
      item.evidenceFingerprint,
      item.createdAt,
      item.updatedAt,
    );
  }

  getQueueItem(queueItemId: string): QueueItem | null {
    const row = this.db.prepare(
      `SELECT * FROM decision_queue_items WHERE queue_item_id = ?`
    ).get(queueItemId) as Record<string, unknown> | undefined;

    return row ? this.rowToQueueItem(row) : null;
  }

  /**
   * List queue items, ordered by deterministic priority law.
   *
   * Order: priority_class weight ASC, created_at ASC (oldest first within class).
   * Optionally filter by role and/or active-only.
   */
  listQueue(opts?: {
    role?: 'reviewer' | 'approver';
    activeOnly?: boolean;
  }): QueueItem[] {
    let sql = `SELECT * FROM decision_queue_items`;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts?.role) {
      conditions.push('role = @role');
      params.role = opts.role;
    }

    if (opts?.activeOnly !== false) {
      // Default: exclude terminal statuses
      conditions.push("status NOT IN ('approved', 'rejected', 'recovery_requested', 'cleared')");
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Order by priority weight, then oldest first
    sql += ` ORDER BY
      CASE priority_class
        WHEN 'recovery_needed' THEN 0
        WHEN 'blocked_high' THEN 1
        WHEN 'blocked_medium' THEN 2
        WHEN 'approvable' THEN 3
        WHEN 'informational' THEN 4
      END ASC,
      created_at ASC`;

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map(r => this.rowToQueueItem(r));
  }

  /**
   * Find active queue items for a specific handoff.
   */
  findByHandoffId(handoffId: string): QueueItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM decision_queue_items
       WHERE handoff_id = ? AND status NOT IN ('approved', 'rejected', 'recovery_requested', 'cleared')
       ORDER BY created_at DESC`
    ).all(handoffId) as Record<string, unknown>[];
    return rows.map(r => this.rowToQueueItem(r));
  }

  updateStatus(queueItemId: string, status: QueueItemStatus): void {
    this.db.prepare(
      `UPDATE decision_queue_items SET status = ?, updated_at = ? WHERE queue_item_id = ?`
    ).run(status, nowISO(), queueItemId);
  }

  updatePriority(queueItemId: string, priorityClass: PriorityClass, blockerSummary: string): void {
    this.db.prepare(
      `UPDATE decision_queue_items SET priority_class = ?, blocker_summary = ?, updated_at = ? WHERE queue_item_id = ?`
    ).run(priorityClass, blockerSummary, nowISO(), queueItemId);
  }

  // ── Queue events ───────────────────────────────────────────────

  insertEvent(event: QueueEvent): void {
    this.db.prepare(`
      INSERT INTO decision_queue_events
        (queue_item_id, kind, from_status, to_status, from_priority, to_priority,
         actor, reason, action_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.queueItemId,
      event.kind,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.fromPriority ?? null,
      event.toPriority ?? null,
      event.actor,
      event.reason,
      event.actionId ?? null,
      event.createdAt,
    );
  }

  getEvents(queueItemId: string): QueueEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM decision_queue_events WHERE queue_item_id = ? ORDER BY created_at ASC`
    ).all(queueItemId) as Record<string, unknown>[];

    return rows.map(r => ({
      eventId: r.event_id as number,
      queueItemId: r.queue_item_id as string,
      kind: r.kind as QueueEventKind,
      fromStatus: (r.from_status as QueueItemStatus) ?? undefined,
      toStatus: (r.to_status as QueueItemStatus) ?? undefined,
      fromPriority: (r.from_priority as PriorityClass) ?? undefined,
      toPriority: (r.to_priority as PriorityClass) ?? undefined,
      actor: r.actor as string,
      reason: r.reason as string,
      actionId: (r.action_id as string) ?? undefined,
      createdAt: r.created_at as string,
    }));
  }

  // ── Internal ───────────────────────────────────────────────────

  private rowToQueueItem(row: Record<string, unknown>): QueueItem {
    return {
      queueItemId: row.queue_item_id as string,
      handoffId: row.handoff_id as string,
      packetVersion: row.packet_version as number,
      briefId: row.brief_id as string,
      role: row.role as 'reviewer' | 'approver',
      status: row.status as QueueItemStatus,
      priorityClass: row.priority_class as PriorityClass,
      blockerSummary: row.blocker_summary as string,
      eligibilitySummary: row.eligibility_summary as string,
      evidenceFingerprint: row.evidence_fingerprint as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
