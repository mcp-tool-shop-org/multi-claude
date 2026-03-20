/**
 * Flow Control — Store.
 *
 * Durable lane capacity, overflow tracking, and flow audit events.
 */

import type Database from 'better-sqlite3';
import { migrateFlowSchema } from './flow-sql.js';
import type { RoutingLane } from '../routing/types.js';
import type { FlowEvent, FlowEventKind, FlowReasonCode } from './types.js';
import { DEFAULT_WIP_CAP } from './types.js';
import { nowISO } from '../../lib/ids.js';

export interface LaneCapRow {
  lane: string;
  wipCap: number;
  updatedAt: string;
  updatedBy: string;
  reason: string;
}

export interface OverflowRow {
  queueItemId: string;
  lane: string;
  reasonCode: string;
  reason: string;
  enteredAt: string;
}

export class FlowStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migrateFlowSchema(this.db);
  }

  // ── Lane caps ───────────────────────────────────────────────────

  getWipCap(lane: RoutingLane): number {
    const row = this.db.prepare(
      'SELECT wip_cap FROM flow_lane_caps WHERE lane = ?',
    ).get(lane) as { wip_cap: number } | undefined;
    return row?.wip_cap ?? DEFAULT_WIP_CAP;
  }

  setWipCap(lane: RoutingLane, cap: number, actor: string, reason: string): void {
    const now = nowISO();
    this.db.prepare(`
      INSERT INTO flow_lane_caps (lane, wip_cap, updated_at, updated_by, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lane) DO UPDATE SET
        wip_cap = excluded.wip_cap,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by,
        reason = excluded.reason
    `).run(lane, cap, now, actor, reason);
  }

  getAllCaps(): LaneCapRow[] {
    const rows = this.db.prepare(
      'SELECT lane, wip_cap, updated_at, updated_by, reason FROM flow_lane_caps ORDER BY lane',
    ).all() as Array<{ lane: string; wip_cap: number; updated_at: string; updated_by: string; reason: string }>;
    return rows.map(r => ({
      lane: r.lane,
      wipCap: r.wip_cap,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      reason: r.reason,
    }));
  }

  // ── Overflow ────────────────────────────────────────────────────

  addOverflow(queueItemId: string, lane: RoutingLane, reasonCode: string, reason: string): void {
    const now = nowISO();
    this.db.prepare(`
      INSERT OR REPLACE INTO flow_overflow (queue_item_id, lane, reason_code, reason, entered_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(queueItemId, lane, reasonCode, reason, now);
  }

  removeOverflow(queueItemId: string): void {
    this.db.prepare('DELETE FROM flow_overflow WHERE queue_item_id = ?').run(queueItemId);
  }

  getOverflow(queueItemId: string): OverflowRow | undefined {
    const row = this.db.prepare(
      'SELECT queue_item_id, lane, reason_code, reason, entered_at FROM flow_overflow WHERE queue_item_id = ?',
    ).get(queueItemId) as { queue_item_id: string; lane: string; reason_code: string; reason: string; entered_at: string } | undefined;
    if (!row) return undefined;
    return {
      queueItemId: row.queue_item_id,
      lane: row.lane,
      reasonCode: row.reason_code,
      reason: row.reason,
      enteredAt: row.entered_at,
    };
  }

  listOverflow(lane?: RoutingLane): OverflowRow[] {
    const sql = lane
      ? 'SELECT queue_item_id, lane, reason_code, reason, entered_at FROM flow_overflow WHERE lane = ? ORDER BY entered_at ASC'
      : 'SELECT queue_item_id, lane, reason_code, reason, entered_at FROM flow_overflow ORDER BY entered_at ASC';
    const rows = (lane
      ? this.db.prepare(sql).all(lane)
      : this.db.prepare(sql).all()
    ) as Array<{ queue_item_id: string; lane: string; reason_code: string; reason: string; entered_at: string }>;
    return rows.map(r => ({
      queueItemId: r.queue_item_id,
      lane: r.lane,
      reasonCode: r.reason_code,
      reason: r.reason,
      enteredAt: r.entered_at,
    }));
  }

  countOverflow(lane?: RoutingLane): number {
    if (lane) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM flow_overflow WHERE lane = ?').get(lane) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM flow_overflow').get() as { cnt: number };
    return row.cnt;
  }

  // ── Events ──────────────────────────────────────────────────────

  insertEvent(event: FlowEvent): void {
    this.db.prepare(`
      INSERT INTO flow_events (lane, kind, prior_active, new_active, wip_cap, reason_code, reason, actor, queue_item_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.lane,
      event.kind,
      event.priorActiveCount,
      event.newActiveCount,
      event.wipCap,
      event.reasonCode,
      event.reason,
      event.actor,
      event.queueItemId ?? null,
      event.createdAt,
    );
  }

  getEvents(opts?: { lane?: RoutingLane; kind?: FlowEventKind; limit?: number }): FlowEvent[] {
    let sql = 'SELECT * FROM flow_events WHERE 1=1';
    const params: unknown[] = [];

    if (opts?.lane) {
      sql += ' AND lane = ?';
      params.push(opts.lane);
    }
    if (opts?.kind) {
      sql += ' AND kind = ?';
      params.push(opts.kind);
    }
    sql += ' ORDER BY rowid DESC';
    if (opts?.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as Array<{
      lane: string; kind: string; prior_active: number; new_active: number;
      wip_cap: number; reason_code: string; reason: string; actor: string;
      queue_item_id: string | null; created_at: string;
    }>;

    return rows.map(r => ({
      lane: r.lane as RoutingLane,
      kind: r.kind as FlowEventKind,
      priorActiveCount: r.prior_active,
      newActiveCount: r.new_active,
      wipCap: r.wip_cap,
      reasonCode: r.reason_code as FlowReasonCode,
      reason: r.reason,
      actor: r.actor,
      queueItemId: r.queue_item_id ?? undefined,
      createdAt: r.created_at,
    }));
  }
}
