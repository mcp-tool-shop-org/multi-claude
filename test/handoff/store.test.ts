import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { openTestStore, makeTestPacket } from './helpers.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { handoffTableCount } from '../../src/handoff/store/handoff-sql.js';
import type Database from 'better-sqlite3';

describe('Handoff Store', () => {
  let store: HandoffStore;
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    ({ store, db, dbPath } = openTestStore());
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const ext of ['-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('creates all 8 handoff tables', () => {
    expect(handoffTableCount(db)).toBe(8);
  });

  it('migrations are idempotent', () => {
    store.migrate();
    store.migrate();
    expect(handoffTableCount(db)).toBe(8);
  });

  describe('packet CRUD', () => {
    it('creates and retrieves a packet record', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      const record = store.getPacket('ho-001');
      expect(record).not.toBeNull();
      expect(record!.handoffId).toBe('ho-001');
      expect(record!.status).toBe('active');
    });

    it('returns null for nonexistent packet', () => {
      expect(store.getPacket('nonexistent')).toBeNull();
    });

    it('updates packet status', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      store.updatePacketStatus('ho-001', 'invalidated');
      const record = store.getPacket('ho-001');
      expect(record!.status).toBe('invalidated');
    });
  });

  describe('packet versions', () => {
    it('stores and retrieves immutable version snapshots', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      store.insertVersion({
        handoffId: 'ho-001',
        packetVersion: 1,
        createdAt: '2026-03-19T00:00:00Z',
        summary: 'Test summary',
        instructionsJson: '{"authoritative":[],"constraints":[],"prohibitions":[]}',
        decisionsJson: '[]',
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: '[]',
        scopeJson: '{"projectId":"proj-1","runId":"run-1"}',
        contentHash: 'abc123',
      });

      const version = store.getVersion('ho-001', 1);
      expect(version).not.toBeNull();
      expect(version!.summary).toBe('Test summary');
      expect(version!.contentHash).toBe('abc123');
    });

    it('rejects duplicate version inserts (immutability)', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      const versionRow = {
        handoffId: 'ho-001',
        packetVersion: 1,
        createdAt: '2026-03-19T00:00:00Z',
        summary: 'Test',
        instructionsJson: '{}',
        decisionsJson: '[]',
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: '[]',
        scopeJson: '{}',
        contentHash: 'abc',
      };

      store.insertVersion(versionRow);
      expect(() => store.insertVersion(versionRow)).toThrow();
    });

    it('lists all versions in order', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 2,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      for (let v = 1; v <= 3; v++) {
        store.insertVersion({
          handoffId: 'ho-001',
          packetVersion: v,
          createdAt: `2026-03-19T0${v}:00:00Z`,
          summary: `Version ${v}`,
          instructionsJson: '{}',
          decisionsJson: '[]',
          rejectedJson: '[]',
          openLoopsJson: '[]',
          artifactsJson: '[]',
          scopeJson: '{}',
          contentHash: `hash-v${v}`,
        });
      }

      const versions = store.listVersions('ho-001');
      expect(versions).toHaveLength(3);
      expect(versions[0].packetVersion).toBe(1);
      expect(versions[2].packetVersion).toBe(3);
    });
  });

  describe('reconstructPacket', () => {
    it('reconstructs a full HandoffPacket from stored data', () => {
      const testPacket = makeTestPacket();

      store.createPacket({
        handoffId: testPacket.handoffId,
        projectId: testPacket.scope.projectId,
        runId: testPacket.derivedFromRunId,
        currentVersion: 1,
        status: 'active',
        createdAt: testPacket.createdAt,
        updatedAt: testPacket.createdAt,
      });

      store.insertVersion({
        handoffId: testPacket.handoffId,
        packetVersion: 1,
        createdAt: testPacket.createdAt,
        summary: testPacket.summary,
        instructionsJson: JSON.stringify(testPacket.instructions),
        decisionsJson: JSON.stringify(testPacket.decisions),
        rejectedJson: JSON.stringify(testPacket.rejected),
        openLoopsJson: JSON.stringify(testPacket.openLoops),
        artifactsJson: JSON.stringify(testPacket.artifacts),
        scopeJson: JSON.stringify(testPacket.scope),
        contentHash: testPacket.contentHash,
      });

      const reconstructed = store.reconstructPacket(testPacket.handoffId);
      expect(reconstructed).not.toBeNull();
      expect(reconstructed!.handoffId).toBe(testPacket.handoffId);
      expect(reconstructed!.summary).toBe(testPacket.summary);
      expect(reconstructed!.contentHash).toBe(testPacket.contentHash);
      expect(reconstructed!.instructions).toEqual(testPacket.instructions);
      expect(reconstructed!.decisions).toEqual(testPacket.decisions);
    });

    it('returns null for nonexistent packet', () => {
      expect(store.reconstructPacket('nonexistent')).toBeNull();
    });
  });

  describe('lineage', () => {
    it('records and queries ancestry', () => {
      store.createPacket({
        handoffId: 'ho-parent',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      store.createPacket({
        handoffId: 'ho-child',
        projectId: 'proj-1',
        runId: 'run-2',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T01:00:00Z',
        updatedAt: '2026-03-19T01:00:00Z',
      });

      store.insertLineage({
        handoffId: 'ho-child',
        parentHandoffId: 'ho-parent',
        relation: 'derived_from',
        createdAt: '2026-03-19T01:00:00Z',
      });

      const ancestors = store.getLineage('ho-child');
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].parentHandoffId).toBe('ho-parent');
      expect(ancestors[0].relation).toBe('derived_from');

      const descendants = store.getDescendants('ho-parent');
      expect(descendants).toHaveLength(1);
      expect(descendants[0].handoffId).toBe('ho-child');
    });

    it('supports supersede/recovery lineage', () => {
      for (const id of ['ho-a', 'ho-b', 'ho-c']) {
        store.createPacket({
          handoffId: id,
          projectId: 'proj-1',
          runId: 'run-1',
          currentVersion: 1,
          status: 'active',
          createdAt: '2026-03-19T00:00:00Z',
          updatedAt: '2026-03-19T00:00:00Z',
        });
      }

      store.insertLineage({ handoffId: 'ho-b', parentHandoffId: 'ho-a', relation: 'supersedes', createdAt: '2026-03-19T01:00:00Z' });
      store.insertLineage({ handoffId: 'ho-c', parentHandoffId: 'ho-b', relation: 'recovery_from', createdAt: '2026-03-19T02:00:00Z' });

      const descendants = store.getDescendants('ho-a');
      expect(descendants).toHaveLength(1);
      expect(descendants[0].relation).toBe('supersedes');

      const cAncestors = store.getLineage('ho-c');
      expect(cAncestors).toHaveLength(1);
      expect(cAncestors[0].relation).toBe('recovery_from');
    });
  });

  describe('render events', () => {
    it('records render events with renderer + adapter versions', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      const eventId = store.insertRenderEvent({
        handoffId: 'ho-001',
        packetVersion: 1,
        roleRenderer: 'worker',
        rendererVersion: '1.0.0',
        modelAdapter: 'claude',
        adapterVersion: '1.0.0',
        tokenBudget: 4000,
        renderedAt: '2026-03-19T00:00:00Z',
        outputHash: 'out-hash-001',
      });

      expect(eventId).toBeGreaterThan(0);

      const events = store.getRenderEvents('ho-001');
      expect(events).toHaveLength(1);
      expect(events[0].roleRenderer).toBe('worker');
      expect(events[0].rendererVersion).toBe('1.0.0');
      expect(events[0].modelAdapter).toBe('claude');
      expect(events[0].adapterVersion).toBe('1.0.0');
      expect(events[0].outputHash).toBe('out-hash-001');
    });
  });

  describe('invalidations', () => {
    it('records invalidation and detects invalidated versions', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      expect(store.isVersionInvalidated('ho-001', 1)).toBe(false);

      store.insertInvalidation({
        handoffId: 'ho-001',
        packetVersion: 1,
        reasonCode: 'manual',
        reason: 'Test invalidation',
        invalidatedAt: '2026-03-19T01:00:00Z',
      });

      expect(store.isVersionInvalidated('ho-001', 1)).toBe(true);

      const invalidations = store.getInvalidations('ho-001');
      expect(invalidations).toHaveLength(1);
      expect(invalidations[0].reasonCode).toBe('manual');
    });
  });

  describe('uses', () => {
    it('records packet usage by consumers', () => {
      store.createPacket({
        handoffId: 'ho-001',
        projectId: 'proj-1',
        runId: 'run-1',
        currentVersion: 1,
        status: 'active',
        createdAt: '2026-03-19T00:00:00Z',
        updatedAt: '2026-03-19T00:00:00Z',
      });

      store.insertUse({
        handoffId: 'ho-001',
        packetVersion: 1,
        consumerRunId: 'run-2',
        consumerRole: 'worker',
        usedAt: '2026-03-19T01:00:00Z',
      });

      const uses = store.getUses('ho-001');
      expect(uses).toHaveLength(1);
      expect(uses[0].consumerRunId).toBe('run-2');
    });
  });
});
