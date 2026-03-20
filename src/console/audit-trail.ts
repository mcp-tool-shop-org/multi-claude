import type Database from 'better-sqlite3';
import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { AuditEntry } from '../types/actions.js';

/** Re-export for backward compatibility */
export type { AuditEntry } from '../types/actions.js';

type AuditInput = Omit<AuditEntry, 'id' | 'timestamp'>;

interface AuditRow {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  before_state: string;
  after_state: string;
  reason: string;
  command: string;
  success: number;
  error: string | null;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS operator_audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_state TEXT NOT NULL,
  after_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  command TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  error TEXT
)`;

const CREATE_IDX_TIMESTAMP = `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON operator_audit_log(timestamp)`;
const CREATE_IDX_ACTION = `CREATE INDEX IF NOT EXISTS idx_audit_action ON operator_audit_log(action)`;
const CREATE_IDX_TARGET = `CREATE INDEX IF NOT EXISTS idx_audit_target ON operator_audit_log(target_type, target_id)`;

function rowToEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    actor: row.actor,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    reason: row.reason,
    command: row.command,
    success: row.success === 1,
    error: row.error,
  };
}

// --- ensureAuditTable ---

export function ensureAuditTableWithDb(db: Database.Database): void {
  db.exec(CREATE_TABLE);
  db.exec(CREATE_IDX_TIMESTAMP);
  db.exec(CREATE_IDX_ACTION);
  db.exec(CREATE_IDX_TARGET);
}

export function ensureAuditTable(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    ensureAuditTableWithDb(db);
  } finally {
    db.close();
  }
}

// --- recordAudit ---

export function recordAuditWithDb(db: Database.Database, entry: AuditInput): AuditEntry {
  ensureAuditTableWithDb(db);

  const id = generateId('aud');
  const timestamp = nowISO();

  db.prepare(`
    INSERT INTO operator_audit_log
      (id, timestamp, actor, action, target_type, target_id, before_state, after_state, reason, command, success, error)
    VALUES
      (@id, @timestamp, @actor, @action, @target_type, @target_id, @before_state, @after_state, @reason, @command, @success, @error)
  `).run({
    id,
    timestamp,
    actor: entry.actor,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    before_state: entry.beforeState,
    after_state: entry.afterState,
    reason: entry.reason,
    command: entry.command,
    success: entry.success ? 1 : 0,
    error: entry.error,
  });

  return {
    id,
    timestamp,
    ...entry,
  };
}

export function recordAudit(dbPath: string, entry: AuditInput): AuditEntry {
  const db = openDb(dbPath);
  try {
    return recordAuditWithDb(db, entry);
  } finally {
    db.close();
  }
}

// --- queryAuditTrail ---

export interface QueryOptions {
  limit?: number;
  action?: string;
  targetType?: string;
  targetId?: string;
  sinceTimestamp?: string;
  actor?: string;
}

export function queryAuditTrailWithDb(db: Database.Database, options: QueryOptions = {}): AuditEntry[] {
  ensureAuditTableWithDb(db);

  const conditions: string[] = [];
  const params: Record<string, string | number> = {};

  if (options.action) {
    conditions.push('action = @action');
    params.action = options.action;
  }
  if (options.targetType) {
    conditions.push('target_type = @target_type');
    params.target_type = options.targetType;
  }
  if (options.targetId) {
    conditions.push('target_id = @target_id');
    params.target_id = options.targetId;
  }
  if (options.sinceTimestamp) {
    conditions.push('timestamp >= @since');
    params.since = options.sinceTimestamp;
  }
  if (options.actor) {
    conditions.push('actor = @actor');
    params.actor = options.actor;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;

  const rows = db.prepare(
    `SELECT * FROM operator_audit_log ${where} ORDER BY timestamp DESC LIMIT @limit`
  ).all({ ...params, limit }) as AuditRow[];

  return rows.map(rowToEntry);
}

export function queryAuditTrail(dbPath: string, options: QueryOptions = {}): AuditEntry[] {
  const db = openDb(dbPath);
  try {
    return queryAuditTrailWithDb(db, options);
  } finally {
    db.close();
  }
}

// --- getAuditEntry ---

export function getAuditEntryWithDb(db: Database.Database, entryId: string): AuditEntry | null {
  ensureAuditTableWithDb(db);

  const row = db.prepare(
    `SELECT * FROM operator_audit_log WHERE id = @id`
  ).get({ id: entryId }) as AuditRow | undefined;

  return row ? rowToEntry(row) : null;
}

export function getAuditEntry(dbPath: string, entryId: string): AuditEntry | null {
  const db = openDb(dbPath);
  try {
    return getAuditEntryWithDb(db, entryId);
  } finally {
    db.close();
  }
}
