/**
 * Policy Control — Store.
 *
 * Durable policy sets, activation state, and audit events.
 */

import type Database from 'better-sqlite3';
import { migratePolicySchema } from './policy-sql.js';
import type {
  PolicySet,
  PolicyStatus,
  PolicyContent,
  PolicyEvent,
  PolicyEventKind,
} from './types.js';

export class PolicyStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migratePolicySchema(this.db);
  }

  // ── Policy sets ─────────────────────────────────────────────────

  insertPolicySet(ps: PolicySet): void {
    this.db.prepare(`
      INSERT INTO policy_sets
        (policy_set_id, policy_version, status, scope, content, content_hash, reason, created_by, created_at, activated_at, superseded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ps.policySetId, ps.policyVersion, ps.status, ps.scope,
      JSON.stringify(ps.content), ps.contentHash,
      ps.reason, ps.createdBy, ps.createdAt,
      ps.activatedAt, ps.supersededAt,
    );
  }

  getPolicySet(policySetId: string): PolicySet | undefined {
    const row = this.db.prepare(
      'SELECT * FROM policy_sets WHERE policy_set_id = ?',
    ).get(policySetId) as PolicyRow | undefined;
    return row ? mapPolicyRow(row) : undefined;
  }

  getActivePolicy(scope: string = 'global'): PolicySet | undefined {
    const row = this.db.prepare(
      "SELECT * FROM policy_sets WHERE scope = ? AND status = 'active' ORDER BY activated_at DESC LIMIT 1",
    ).get(scope) as PolicyRow | undefined;
    return row ? mapPolicyRow(row) : undefined;
  }

  getNextVersion(scope: string = 'global'): number {
    const row = this.db.prepare(
      'SELECT MAX(policy_version) as max_v FROM policy_sets WHERE scope = ?',
    ).get(scope) as { max_v: number | null };
    return (row.max_v ?? 0) + 1;
  }

  listPolicySets(opts?: { scope?: string; status?: PolicyStatus }): PolicySet[] {
    let sql = 'SELECT * FROM policy_sets WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.scope) { sql += ' AND scope = ?'; params.push(opts.scope); }
    if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
    sql += ' ORDER BY policy_version DESC';
    return (this.db.prepare(sql).all(...params) as PolicyRow[]).map(mapPolicyRow);
  }

  updateStatus(policySetId: string, status: PolicyStatus): void {
    this.db.prepare(
      'UPDATE policy_sets SET status = ? WHERE policy_set_id = ?',
    ).run(status, policySetId);
  }

  updateActivatedAt(policySetId: string, activatedAt: string): void {
    this.db.prepare(
      'UPDATE policy_sets SET activated_at = ?, status = ? WHERE policy_set_id = ?',
    ).run(activatedAt, 'active', policySetId);
  }

  updateSupersededAt(policySetId: string, supersededAt: string): void {
    this.db.prepare(
      'UPDATE policy_sets SET superseded_at = ?, status = ? WHERE policy_set_id = ?',
    ).run(supersededAt, 'superseded', policySetId);
  }

  // ── Events ──────────────────────────────────────────────────────

  insertEvent(event: PolicyEvent): void {
    this.db.prepare(`
      INSERT INTO policy_events
        (policy_set_id, kind, from_status, to_status, reason, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.policySetId, event.kind,
      event.fromStatus, event.toStatus,
      event.reason, event.actor, event.createdAt,
    );
  }

  getEvents(opts?: { policySetId?: string; limit?: number }): PolicyEvent[] {
    let sql = 'SELECT * FROM policy_events WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.policySetId) { sql += ' AND policy_set_id = ?'; params.push(opts.policySetId); }
    sql += ' ORDER BY rowid DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as EventRow[]).map(mapEventRow);
  }
}

// ── Row mappers ─────────────────────────────────────────────────────

interface PolicyRow {
  policy_set_id: string; policy_version: number; status: string;
  scope: string; content: string; content_hash: string;
  reason: string; created_by: string; created_at: string;
  activated_at: string | null; superseded_at: string | null;
}

function mapPolicyRow(r: PolicyRow): PolicySet {
  return {
    policySetId: r.policy_set_id, policyVersion: r.policy_version,
    status: r.status as PolicyStatus, scope: r.scope,
    content: JSON.parse(r.content) as PolicyContent,
    contentHash: r.content_hash,
    reason: r.reason, createdBy: r.created_by, createdAt: r.created_at,
    activatedAt: r.activated_at, supersededAt: r.superseded_at,
  };
}

interface EventRow {
  policy_set_id: string; kind: string; from_status: string | null;
  to_status: string; reason: string; actor: string; created_at: string;
}

function mapEventRow(r: EventRow): PolicyEvent {
  return {
    policySetId: r.policy_set_id, kind: r.kind as PolicyEventKind,
    fromStatus: r.from_status as PolicyStatus | null,
    toStatus: r.to_status as PolicyStatus,
    reason: r.reason, actor: r.actor, createdAt: r.created_at,
  };
}
