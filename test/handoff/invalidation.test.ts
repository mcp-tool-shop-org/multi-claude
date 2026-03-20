import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { openTestStore, makeTestPacket } from './helpers.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { readHandoff } from '../../src/handoff/api/read-handoff.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import type Database from 'better-sqlite3';

describe('Invalidation Engine', () => {
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

  function seedPacket(): string {
    const result = createHandoff(store, {
      projectId: 'proj-1',
      runId: 'run-1',
      summary: 'Test packet',
      instructions: { authoritative: ['Do X'], constraints: [], prohibitions: [] },
      decisionSource: { approvals: [], contractDeltas: [] },
      rejectionSource: { rejectedApprovals: [], rejectedDeltas: [] },
      openLoopSource: { failedPacketIds: [], blockedPacketIds: [], pendingPacketIds: [], unresolvedGates: [] },
      artifactSource: { artifacts: [] },
    });
    return result.packet.handoffId;
  }

  it('invalidates a packet version', () => {
    const id = seedPacket();

    const result = invalidatePacketVersion(store, {
      handoffId: id,
      packetVersion: 1,
      reasonCode: 'manual',
      reason: 'Testing invalidation',
    });

    expect(result.ok).toBe(true);
    expect(store.isVersionInvalidated(id, 1)).toBe(true);
  });

  it('invalidated current version updates packet status', () => {
    const id = seedPacket();

    invalidatePacketVersion(store, {
      handoffId: id,
      packetVersion: 1,
      reasonCode: 'schema_drift',
      reason: 'Schema changed',
    });

    const record = store.getPacket(id);
    expect(record!.status).toBe('invalidated');
  });

  it('readHandoff flags invalidated versions', () => {
    const id = seedPacket();

    invalidatePacketVersion(store, {
      handoffId: id,
      packetVersion: 1,
      reasonCode: 'manual',
      reason: 'Test',
    });

    const read = readHandoff(store, id);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.isInvalidated).toBe(true);
    }
  });

  it('rejects double invalidation', () => {
    const id = seedPacket();

    invalidatePacketVersion(store, {
      handoffId: id,
      packetVersion: 1,
      reasonCode: 'manual',
      reason: 'First',
    });

    const result = invalidatePacketVersion(store, {
      handoffId: id,
      packetVersion: 1,
      reasonCode: 'manual',
      reason: 'Second',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects invalidation of nonexistent packet', () => {
    const result = invalidatePacketVersion(store, {
      handoffId: 'nonexistent',
      packetVersion: 1,
      reasonCode: 'manual',
      reason: 'Does not exist',
    });

    expect(result.ok).toBe(false);
  });
});
