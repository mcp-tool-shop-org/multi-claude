/**
 * Approval Store — Phase 10B-201
 *
 * Durable storage for approval records. This is genuinely new truth:
 * an approval decision is not derivable — it records a human judgment.
 *
 * Schema: one table (run_approvals) with version-binding fields.
 * Pattern matches audit-trail.ts (self-bootstrapping table).
 */

import type Database from 'better-sqlite3';
import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';
import type {
  ApprovalRecord,
  ApprovalBinding,
  ApprovalStatus,
} from '../types/approval.js';

// ── Table bootstrap ─────────────────────────────────────────────────

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS run_approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approver TEXT NOT NULL,
  reason TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  invalidated_at TEXT,
  invalidation_reason TEXT
)`;

const CREATE_IDX_RUN = `CREATE INDEX IF NOT EXISTS idx_approval_run ON run_approvals(run_id)`;
const CREATE_IDX_STATUS = `CREATE INDEX IF NOT EXISTS idx_approval_status ON run_approvals(status)`;

export function ensureApprovalTableWithDb(db: Database.Database): void {
  db.exec(CREATE_TABLE);
  db.exec(CREATE_IDX_RUN);
  db.exec(CREATE_IDX_STATUS);
}

export function ensureApprovalTable(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    ensureApprovalTableWithDb(db);
  } finally {
    db.close();
  }
}

// ── Row mapping ─────────────────────────────────────────────────────

interface ApprovalRow {
  id: string;
  run_id: string;
  status: string;
  approver: string;
  reason: string;
  binding_json: string;
  decided_at: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
}

function rowToRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status as ApprovalStatus,
    approver: row.approver,
    reason: row.reason,
    binding: JSON.parse(row.binding_json) as ApprovalBinding,
    decidedAt: row.decided_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
  };
}

// ── Write operations ────────────────────────────────────────────────

export interface RecordApprovalInput {
  runId: string;
  status: 'approved' | 'rejected';
  approver: string;
  reason: string;
  binding: ApprovalBinding;
}

export function recordApprovalWithDb(
  db: Database.Database,
  input: RecordApprovalInput,
): ApprovalRecord {
  ensureApprovalTableWithDb(db);

  const id = generateId('apr');
  const decidedAt = nowISO();

  db.prepare(`
    INSERT INTO run_approvals
      (id, run_id, status, approver, reason, binding_json, decided_at, invalidated_at, invalidation_reason)
    VALUES
      (@id, @run_id, @status, @approver, @reason, @binding_json, @decided_at, NULL, NULL)
  `).run({
    id,
    run_id: input.runId,
    status: input.status,
    approver: input.approver,
    reason: input.reason,
    binding_json: JSON.stringify(input.binding),
    decided_at: decidedAt,
  });

  return {
    id,
    runId: input.runId,
    status: input.status,
    approver: input.approver,
    reason: input.reason,
    binding: input.binding,
    decidedAt,
    invalidatedAt: null,
    invalidationReason: null,
  };
}

export function recordApproval(dbPath: string, input: RecordApprovalInput): ApprovalRecord {
  const db = openDb(dbPath);
  try {
    return recordApprovalWithDb(db, input);
  } finally {
    db.close();
  }
}

// ── Invalidation ────────────────────────────────────────────────────

export function invalidateApprovalWithDb(
  db: Database.Database,
  approvalId: string,
  reason: string,
): void {
  ensureApprovalTableWithDb(db);

  db.prepare(`
    UPDATE run_approvals
    SET status = 'invalidated', invalidated_at = @invalidated_at, invalidation_reason = @reason
    WHERE id = @id AND status = 'approved'
  `).run({
    id: approvalId,
    invalidated_at: nowISO(),
    reason,
  });
}

export function invalidateApproval(dbPath: string, approvalId: string, reason: string): void {
  const db = openDb(dbPath);
  try {
    invalidateApprovalWithDb(db, approvalId, reason);
  } finally {
    db.close();
  }
}

// ── Query operations ────────────────────────────────────────────────

export function getLatestApprovalWithDb(
  db: Database.Database,
  runId: string,
): ApprovalRecord | null {
  ensureApprovalTableWithDb(db);

  const row = db.prepare(
    `SELECT * FROM run_approvals WHERE run_id = @run_id ORDER BY decided_at DESC LIMIT 1`,
  ).get({ run_id: runId }) as ApprovalRow | undefined;

  return row ? rowToRecord(row) : null;
}

export function getLatestApproval(dbPath: string, runId: string): ApprovalRecord | null {
  const db = openDb(dbPath);
  try {
    return getLatestApprovalWithDb(db, runId);
  } finally {
    db.close();
  }
}

export function getApprovalHistoryWithDb(
  db: Database.Database,
  runId: string,
  limit = 10,
): ApprovalRecord[] {
  ensureApprovalTableWithDb(db);

  const rows = db.prepare(
    `SELECT * FROM run_approvals WHERE run_id = @run_id ORDER BY decided_at DESC LIMIT @limit`,
  ).all({ run_id: runId, limit }) as ApprovalRow[];

  return rows.map(rowToRecord);
}

export function getApprovalHistory(dbPath: string, runId: string, limit = 10): ApprovalRecord[] {
  const db = openDb(dbPath);
  try {
    return getApprovalHistoryWithDb(db, runId, limit);
  } finally {
    db.close();
  }
}
