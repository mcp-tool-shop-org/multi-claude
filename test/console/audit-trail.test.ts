import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureAuditTableWithDb,
  recordAuditWithDb,
  queryAuditTrailWithDb,
  getAuditEntryWithDb,
  type AuditEntry,
} from '../../src/console/audit-trail.js';

function makeInput(overrides: Partial<Omit<AuditEntry, 'id' | 'timestamp'>> = {}) {
  return {
    actor: overrides.actor ?? 'operator',
    action: overrides.action ?? 'stop_run',
    targetType: overrides.targetType ?? 'run',
    targetId: overrides.targetId ?? 'run-001',
    beforeState: overrides.beforeState ?? 'running',
    afterState: overrides.afterState ?? 'stopped',
    reason: overrides.reason ?? 'test reason',
    command: overrides.command ?? 'mc stop run-001',
    success: overrides.success ?? true,
    error: overrides.error ?? null,
  };
}

describe('audit-trail', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  // 1. ensureAuditTable creates the table (idempotent)
  it('ensureAuditTable creates the table and is idempotent', () => {
    ensureAuditTableWithDb(db);
    ensureAuditTableWithDb(db); // second call should not throw

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='operator_audit_log'`
    ).all();
    expect(tables).toHaveLength(1);
  });

  // 2. recordAudit stores and returns entry with generated ID and timestamp
  it('recordAudit returns entry with generated ID and timestamp', () => {
    const entry = recordAuditWithDb(db, makeInput());

    expect(entry.id).toMatch(/^aud-/);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.actor).toBe('operator');
    expect(entry.action).toBe('stop_run');
    expect(entry.targetType).toBe('run');
    expect(entry.targetId).toBe('run-001');
    expect(entry.beforeState).toBe('running');
    expect(entry.afterState).toBe('stopped');
    expect(entry.reason).toBe('test reason');
    expect(entry.command).toBe('mc stop run-001');
  });

  // 3. recordAudit stores success=true correctly
  it('recordAudit stores success=true correctly', () => {
    const entry = recordAuditWithDb(db, makeInput({ success: true }));
    expect(entry.success).toBe(true);

    const fetched = getAuditEntryWithDb(db, entry.id);
    expect(fetched!.success).toBe(true);
  });

  // 4. recordAudit stores success=false with error message
  it('recordAudit stores success=false with error message', () => {
    const entry = recordAuditWithDb(db, makeInput({
      success: false,
      afterState: 'error',
      error: 'run not found',
    }));
    expect(entry.success).toBe(false);
    expect(entry.error).toBe('run not found');

    const fetched = getAuditEntryWithDb(db, entry.id);
    expect(fetched!.success).toBe(false);
    expect(fetched!.error).toBe('run not found');
  });

  // 5. queryAuditTrail returns entries sorted newest-first
  it('queryAuditTrail returns entries sorted newest-first', () => {
    ensureAuditTableWithDb(db);

    // Insert with explicit timestamps to control order
    const insert = db.prepare(`
      INSERT INTO operator_audit_log
        (id, timestamp, actor, action, target_type, target_id, before_state, after_state, reason, command, success, error)
      VALUES (@id, @ts, 'op', 'stop_run', 'run', 'r1', 'a', 'b', 'r', 'cmd', 1, NULL)
    `);
    insert.run({ id: 'aud-old', ts: '2026-01-01T00:00:00Z' });
    insert.run({ id: 'aud-mid', ts: '2026-01-02T00:00:00Z' });
    insert.run({ id: 'aud-new', ts: '2026-01-03T00:00:00Z' });

    const results = queryAuditTrailWithDb(db);
    expect(results[0].id).toBe('aud-new');
    expect(results[1].id).toBe('aud-mid');
    expect(results[2].id).toBe('aud-old');
  });

  // 6. queryAuditTrail limit parameter works
  it('queryAuditTrail limit parameter works', () => {
    for (let i = 0; i < 5; i++) {
      recordAuditWithDb(db, makeInput({ targetId: `run-${i}` }));
    }

    const results = queryAuditTrailWithDb(db, { limit: 2 });
    expect(results).toHaveLength(2);
  });

  // 7. queryAuditTrail action filter works
  it('queryAuditTrail action filter works', () => {
    recordAuditWithDb(db, makeInput({ action: 'stop_run' }));
    recordAuditWithDb(db, makeInput({ action: 'retry_packet' }));
    recordAuditWithDb(db, makeInput({ action: 'stop_run' }));

    const results = queryAuditTrailWithDb(db, { action: 'retry_packet' });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('retry_packet');
  });

  // 8. queryAuditTrail targetType filter works
  it('queryAuditTrail targetType filter works', () => {
    recordAuditWithDb(db, makeInput({ targetType: 'run' }));
    recordAuditWithDb(db, makeInput({ targetType: 'packet' }));
    recordAuditWithDb(db, makeInput({ targetType: 'run' }));

    const results = queryAuditTrailWithDb(db, { targetType: 'packet' });
    expect(results).toHaveLength(1);
    expect(results[0].targetType).toBe('packet');
  });

  // 9. queryAuditTrail targetId filter works
  it('queryAuditTrail targetId filter works', () => {
    recordAuditWithDb(db, makeInput({ targetId: 'run-aaa' }));
    recordAuditWithDb(db, makeInput({ targetId: 'run-bbb' }));

    const results = queryAuditTrailWithDb(db, { targetId: 'run-aaa' });
    expect(results).toHaveLength(1);
    expect(results[0].targetId).toBe('run-aaa');
  });

  // 10. queryAuditTrail sinceTimestamp filter works
  it('queryAuditTrail sinceTimestamp filter works', () => {
    ensureAuditTableWithDb(db);

    const insert = db.prepare(`
      INSERT INTO operator_audit_log
        (id, timestamp, actor, action, target_type, target_id, before_state, after_state, reason, command, success, error)
      VALUES (@id, @ts, 'op', 'stop_run', 'run', 'r1', 'a', 'b', 'r', 'cmd', 1, NULL)
    `);
    insert.run({ id: 'aud-1', ts: '2026-01-01T00:00:00Z' });
    insert.run({ id: 'aud-2', ts: '2026-01-15T00:00:00Z' });
    insert.run({ id: 'aud-3', ts: '2026-02-01T00:00:00Z' });

    const results = queryAuditTrailWithDb(db, { sinceTimestamp: '2026-01-10T00:00:00Z' });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.timestamp >= '2026-01-10T00:00:00Z')).toBe(true);
  });

  // 11. queryAuditTrail actor filter works
  it('queryAuditTrail actor filter works', () => {
    recordAuditWithDb(db, makeInput({ actor: 'alice' }));
    recordAuditWithDb(db, makeInput({ actor: 'bob' }));
    recordAuditWithDb(db, makeInput({ actor: 'alice' }));

    const results = queryAuditTrailWithDb(db, { actor: 'bob' });
    expect(results).toHaveLength(1);
    expect(results[0].actor).toBe('bob');
  });

  // 12. queryAuditTrail returns empty array when no entries
  it('queryAuditTrail returns empty array when no entries', () => {
    const results = queryAuditTrailWithDb(db);
    expect(results).toEqual([]);
  });

  // 13. getAuditEntry returns entry by ID
  it('getAuditEntry returns entry by ID', () => {
    const entry = recordAuditWithDb(db, makeInput());
    const fetched = getAuditEntryWithDb(db, entry.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(entry.id);
    expect(fetched!.actor).toBe(entry.actor);
    expect(fetched!.action).toBe(entry.action);
    expect(fetched!.success).toBe(true);
  });

  // 14. getAuditEntry returns null for unknown ID
  it('getAuditEntry returns null for unknown ID', () => {
    ensureAuditTableWithDb(db);
    const result = getAuditEntryWithDb(db, 'aud-nonexistent');
    expect(result).toBeNull();
  });

  // 15. Multiple filters combine correctly (AND logic)
  it('multiple filters combine with AND logic', () => {
    recordAuditWithDb(db, makeInput({ action: 'stop_run', actor: 'alice', targetType: 'run' }));
    recordAuditWithDb(db, makeInput({ action: 'stop_run', actor: 'bob', targetType: 'run' }));
    recordAuditWithDb(db, makeInput({ action: 'retry_packet', actor: 'alice', targetType: 'packet' }));
    recordAuditWithDb(db, makeInput({ action: 'stop_run', actor: 'alice', targetType: 'packet' }));

    const results = queryAuditTrailWithDb(db, {
      action: 'stop_run',
      actor: 'alice',
      targetType: 'run',
    });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('stop_run');
    expect(results[0].actor).toBe('alice');
    expect(results[0].targetType).toBe('run');
  });
});
