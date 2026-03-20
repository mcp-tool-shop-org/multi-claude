import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  queryHookFeed,
  queryPendingApprovals,
  queryPacketDecisionTrail,
} from '../../src/console/hook-feed.js';
import type { HookEvent } from '../../src/console/hook-feed.js';

// ── Helpers ────────────────────────────────────────────────────────────

function tempDbPath(): string {
  const dir = join(tmpdir(), 'mc-hookfeed-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.db');
}

const HOOK_DECISIONS_DDL = `
CREATE TABLE IF NOT EXISTS hook_decisions (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event TEXT NOT NULL,
  event_entity_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  conditions_json TEXT NOT NULL,
  rule_matched TEXT,
  action TEXT,
  packets_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL,
  operator_decision TEXT NOT NULL DEFAULT 'pending',
  executed INTEGER NOT NULL DEFAULT 0,
  reason TEXT
)`;

interface InsertRow {
  id: string;
  timestamp: string;
  event: string;
  event_entity_id: string;
  feature_id: string;
  conditions_json: string;
  rule_matched?: string | null;
  action?: string | null;
  packets_json?: string;
  mode: string;
  operator_decision?: string;
  executed?: number;
  reason?: string | null;
}

function insertRow(db: Database.Database, row: InsertRow): void {
  db.prepare(`
    INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id,
      conditions_json, rule_matched, action, packets_json, mode, operator_decision, executed, reason)
    VALUES (@id, @timestamp, @event, @event_entity_id, @feature_id,
      @conditions_json, @rule_matched, @action, @packets_json, @mode, @operator_decision, @executed, @reason)
  `).run({
    id: row.id,
    timestamp: row.timestamp,
    event: row.event,
    event_entity_id: row.event_entity_id,
    feature_id: row.feature_id,
    conditions_json: row.conditions_json,
    rule_matched: row.rule_matched ?? null,
    action: row.action ?? null,
    packets_json: row.packets_json ?? '[]',
    mode: row.mode,
    operator_decision: row.operator_decision ?? 'pending',
    executed: row.executed ?? 0,
    reason: row.reason ?? null,
  });
}

function cleanupDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('hook-feed', () => {
  let dbPath: string;
  let setupDb: Database.Database;

  beforeEach(() => {
    dbPath = tempDbPath();
    setupDb = new Database(dbPath);
    setupDb.pragma('journal_mode = WAL');
    setupDb.exec(HOOK_DECISIONS_DDL);
  });

  afterEach(() => {
    setupDb.close();
    cleanupDb(dbPath);
  });

  // ── queryHookFeed ──────────────────────────────────────────────────

  describe('queryHookFeed', () => {
    it('returns empty result when no decisions exist', () => {
      const result = queryHookFeed(dbPath, 'feat-1');
      expect(result.events).toEqual([]);
      expect(result.summary.totalDecisions).toBe(0);
      expect(result.summary.pendingApprovals).toBe(0);
      expect(result.summary.autoExecuted).toBe(0);
      expect(result.summary.confirmedByOperator).toBe(0);
      expect(result.summary.rejectedByOperator).toBe(0);
      expect(result.summary.byEvent).toEqual({});
      expect(result.summary.byAction).toEqual({});
      expect(result.summary.byRule).toEqual({});
      expect(result.queriedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns events sorted newest-first', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd3', timestamp: '2026-01-03T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p3', feature_id: 'feat-1', conditions_json: '{}', mode: 'autonomous',
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      expect(result.events).toHaveLength(3);
      expect(result.events[0].id).toBe('d3');
      expect(result.events[1].id).toBe('d2');
      expect(result.events[2].id).toBe('d1');
    });

    it('computes summary counts correctly', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        rule_matched: 'rule-wave', action: 'launch_workers', mode: 'autonomous',
        operator_decision: 'auto', executed: 1,
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}',
        rule_matched: 'rule-wave', action: 'launch_workers', mode: 'advisory',
        operator_decision: 'confirmed', executed: 1,
      });
      insertRow(setupDb, {
        id: 'd3', timestamp: '2026-01-03T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p3', feature_id: 'feat-1', conditions_json: '{}',
        rule_matched: 'rule-retry', action: 'retry_once', mode: 'advisory',
        operator_decision: 'rejected', executed: 0,
      });
      insertRow(setupDb, {
        id: 'd4', timestamp: '2026-01-04T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p4', feature_id: 'feat-1', conditions_json: '{}',
        rule_matched: 'rule-escalate', action: 'escalate', mode: 'advisory',
        operator_decision: 'pending', executed: 0,
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      const s = result.summary;
      expect(s.totalDecisions).toBe(4);
      expect(s.pendingApprovals).toBe(1);
      expect(s.autoExecuted).toBe(1);
      expect(s.confirmedByOperator).toBe(1);
      expect(s.rejectedByOperator).toBe(1);
      expect(s.byEvent).toEqual({ 'packet.verified': 2, 'packet.failed': 2 });
      expect(s.byAction).toEqual({ launch_workers: 2, retry_once: 1, escalate: 1 });
      expect(s.byRule).toEqual({ 'rule-wave': 2, 'rule-retry': 1, 'rule-escalate': 1 });
    });

    it('filters with pendingOnly', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'autonomous', operator_decision: 'auto', executed: 1,
      });

      const result = queryHookFeed(dbPath, 'feat-1', { pendingOnly: true });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('d1');
      expect(result.events[0].operatorDecision).toBe('pending');
    });

    it('filters with eventFilter', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });

      const result = queryHookFeed(dbPath, 'feat-1', { eventFilter: 'packet.failed' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].event).toBe('packet.failed');
    });

    it('filters with sinceTimestamp', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-05T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
      });

      const result = queryHookFeed(dbPath, 'feat-1', { sinceTimestamp: '2026-01-03T00:00:00Z' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].id).toBe('d2');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertRow(setupDb, {
          id: `d${i}`, timestamp: `2026-01-0${i + 1}T00:00:00Z`, event: 'packet.verified',
          event_entity_id: `p${i}`, feature_id: 'feat-1', conditions_json: '{}', mode: 'advisory',
        });
      }

      const result = queryHookFeed(dbPath, 'feat-1', { limit: 2 });
      expect(result.events).toHaveLength(2);
      // Newest first
      expect(result.events[0].id).toBe('d4');
      expect(result.events[1].id).toBe('d3');
    });

    it('parses conditions_json correctly', () => {
      const conditions = { claimableCount: 3, fileOverlap: false };
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1',
        conditions_json: JSON.stringify(conditions), mode: 'advisory',
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      expect(result.events[0].conditions).toEqual(conditions);
    });

    it('returns null for malformed conditions_json', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1',
        conditions_json: '{broken json!!!', mode: 'advisory',
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      expect(result.events[0].conditions).toBeNull();
    });

    it('converts executed from integer to boolean', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'autonomous', operator_decision: 'auto', executed: 1,
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending', executed: 0,
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      const executed = result.events.find(e => e.id === 'd1')!;
      const notExecuted = result.events.find(e => e.id === 'd2')!;

      expect(executed.executed).toBe(true);
      expect(typeof executed.executed).toBe('boolean');
      expect(notExecuted.executed).toBe(false);
      expect(typeof notExecuted.executed).toBe('boolean');
    });
  });

  // ── queryPendingApprovals ──────────────────────────────────────────

  describe('queryPendingApprovals', () => {
    it('returns only pending decisions', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'autonomous', operator_decision: 'auto', executed: 1,
      });
      insertRow(setupDb, {
        id: 'd3', timestamp: '2026-01-03T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p3', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'confirmed', executed: 1,
      });
      insertRow(setupDb, {
        id: 'd4', timestamp: '2026-01-04T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p4', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending',
      });

      const pending = queryPendingApprovals(dbPath, 'feat-1');
      expect(pending).toHaveLength(2);
      expect(pending.every(e => e.operatorDecision === 'pending')).toBe(true);
      // Newest first
      expect(pending[0].id).toBe('d4');
      expect(pending[1].id).toBe('d1');
    });

    it('returns empty array when nothing is pending', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'autonomous', operator_decision: 'auto', executed: 1,
      });

      const pending = queryPendingApprovals(dbPath, 'feat-1');
      expect(pending).toEqual([]);
    });

    it('scopes to the given featureId', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p2', feature_id: 'feat-2', conditions_json: '{}',
        mode: 'advisory', operator_decision: 'pending',
      });

      const pending = queryPendingApprovals(dbPath, 'feat-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].featureId).toBe('feat-1');
    });
  });

  // ── queryPacketDecisionTrail ───────────────────────────────────────

  describe('queryPacketDecisionTrail', () => {
    it('returns events containing the specific packet', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        packets_json: '["pkt-alpha","pkt-beta"]', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd2', timestamp: '2026-01-02T00:00:00Z', event: 'packet.failed',
        event_entity_id: 'p2', feature_id: 'feat-1', conditions_json: '{}',
        packets_json: '["pkt-gamma"]', mode: 'advisory',
      });
      insertRow(setupDb, {
        id: 'd3', timestamp: '2026-01-03T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p3', feature_id: 'feat-1', conditions_json: '{}',
        packets_json: '["pkt-alpha","pkt-gamma"]', mode: 'autonomous',
      });

      const trail = queryPacketDecisionTrail(dbPath, 'pkt-alpha');
      expect(trail).toHaveLength(2);
      // Newest first
      expect(trail[0].id).toBe('d3');
      expect(trail[1].id).toBe('d1');
      expect(trail.every(e => e.packets.includes('pkt-alpha'))).toBe(true);
    });

    it('returns empty array when packet has no decisions', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        packets_json: '["pkt-other"]', mode: 'advisory',
      });

      const trail = queryPacketDecisionTrail(dbPath, 'pkt-missing');
      expect(trail).toEqual([]);
    });

    it('does not false-match on substring packet IDs', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1', conditions_json: '{}',
        packets_json: '["pkt-alpha-long"]', mode: 'advisory',
      });

      const trail = queryPacketDecisionTrail(dbPath, 'pkt-alpha');
      expect(trail).toEqual([]);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles malformed packets_json gracefully', () => {
      insertRow(setupDb, {
        id: 'd1', timestamp: '2026-01-01T00:00:00Z', event: 'packet.verified',
        event_entity_id: 'p1', feature_id: 'feat-1',
        conditions_json: '{}', packets_json: 'not-json!!!', mode: 'advisory',
      });

      const result = queryHookFeed(dbPath, 'feat-1');
      expect(result.events[0].packets).toEqual([]);
    });

    it('works when hook_decisions table does not pre-exist', () => {
      // Use a fresh DB without the table
      const freshPath = tempDbPath();
      try {
        const result = queryHookFeed(freshPath, 'feat-1');
        expect(result.events).toEqual([]);
      } finally {
        cleanupDb(freshPath);
      }
    });
  });
});
