/**
 * Routing Law — Durable store.
 *
 * Handles routes, lane assignments, and routing events.
 */

import type Database from 'better-sqlite3';
import type { Route, RouteStatus, RoutingLane, RoutingEvent, RoutingEventKind, RoutingReasonCode } from './types.js';
import { migrateRoutingSchema } from './routing-sql.js';
import { nowISO } from '../../lib/ids.js';

export class RoutingStore {
  constructor(private readonly db: Database.Database) {}

  migrate(): void {
    migrateRoutingSchema(this.db);
  }

  // ── Routes ───────────────────────────────────────────────────────

  insertRoute(route: Route): void {
    this.db.prepare(`
      INSERT INTO routing_routes
        (route_id, queue_item_id, lane, assigned_target, status,
         reason_code, reason, routed_by, routed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      route.routeId,
      route.queueItemId,
      route.lane,
      route.assignedTarget,
      route.status,
      route.reasonCode,
      route.reason,
      route.routedBy,
      route.routedAt,
      route.updatedAt,
    );
  }

  getRoute(routeId: string): Route | null {
    const row = this.db.prepare(
      `SELECT * FROM routing_routes WHERE route_id = ?`
    ).get(routeId) as Record<string, unknown> | undefined;
    return row ? this.rowToRoute(row) : null;
  }

  /**
   * Get the active route for a queue item.
   */
  getActiveRoute(queueItemId: string): Route | null {
    const row = this.db.prepare(
      `SELECT * FROM routing_routes
       WHERE queue_item_id = ? AND status = 'active'
       ORDER BY routed_at DESC LIMIT 1`
    ).get(queueItemId) as Record<string, unknown> | undefined;
    return row ? this.rowToRoute(row) : null;
  }

  /**
   * List active routes, optionally filtered by lane.
   */
  listRoutes(opts?: {
    lane?: RoutingLane;
    activeOnly?: boolean;
  }): Route[] {
    let sql = `SELECT * FROM routing_routes`;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts?.activeOnly !== false) {
      conditions.push("status = 'active'");
    }

    if (opts?.lane) {
      conditions.push('lane = @lane');
      params.lane = opts.lane;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY routed_at DESC';

    const rows = this.db.prepare(sql).all(params) as Record<string, unknown>[];
    return rows.map(r => this.rowToRoute(r));
  }

  /**
   * Get route history for a queue item.
   */
  getRouteHistory(queueItemId: string): Route[] {
    const rows = this.db.prepare(
      `SELECT * FROM routing_routes WHERE queue_item_id = ? ORDER BY routed_at ASC`
    ).all(queueItemId) as Record<string, unknown>[];
    return rows.map(r => this.rowToRoute(r));
  }

  updateRouteStatus(routeId: string, status: RouteStatus): void {
    this.db.prepare(
      `UPDATE routing_routes SET status = ?, updated_at = ? WHERE route_id = ?`
    ).run(status, nowISO(), routeId);
  }

  updateRouteTarget(routeId: string, target: string | null): void {
    this.db.prepare(
      `UPDATE routing_routes SET assigned_target = ?, updated_at = ? WHERE route_id = ?`
    ).run(target, nowISO(), routeId);
  }

  // ── Events ───────────────────────────────────────────────────────

  insertEvent(event: RoutingEvent): void {
    this.db.prepare(`
      INSERT INTO routing_events
        (route_id, queue_item_id, kind, from_lane, to_lane,
         from_target, to_target, reason_code, reason, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.routeId,
      event.queueItemId,
      event.kind,
      event.fromLane ?? null,
      event.toLane,
      event.fromTarget ?? null,
      event.toTarget ?? null,
      event.reasonCode,
      event.reason,
      event.actor,
      event.createdAt,
    );
  }

  getEvents(queueItemId: string): RoutingEvent[] {
    const rows = this.db.prepare(
      `SELECT * FROM routing_events WHERE queue_item_id = ? ORDER BY created_at ASC`
    ).all(queueItemId) as Record<string, unknown>[];
    return rows.map(r => this.rowToEvent(r));
  }

  // ── Internal ─────────────────────────────────────────────────────

  private rowToRoute(row: Record<string, unknown>): Route {
    return {
      routeId: row.route_id as string,
      queueItemId: row.queue_item_id as string,
      lane: row.lane as RoutingLane,
      assignedTarget: (row.assigned_target as string) ?? null,
      status: row.status as RouteStatus,
      reasonCode: row.reason_code as RoutingReasonCode,
      reason: row.reason as string,
      routedBy: row.routed_by as string,
      routedAt: row.routed_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  private rowToEvent(row: Record<string, unknown>): RoutingEvent {
    return {
      eventId: row.event_id as number,
      routeId: row.route_id as string,
      queueItemId: row.queue_item_id as string,
      kind: row.kind as RoutingEventKind,
      fromLane: (row.from_lane as RoutingLane) ?? undefined,
      toLane: row.to_lane as RoutingLane,
      fromTarget: (row.from_target as string) ?? undefined,
      toTarget: (row.to_target as string) ?? undefined,
      reasonCode: row.reason_code as RoutingReasonCode,
      reason: row.reason as string,
      actor: row.actor as string,
      createdAt: row.created_at as string,
    };
  }
}
