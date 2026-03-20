/**
 * Shared test helpers for handoff spine tests.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { openDb } from '../../src/db/connection.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import type Database from 'better-sqlite3';
import type { HandoffPacket, HandoffInstructionLayer, HandoffScope } from '../../src/handoff/schema/packet.js';
import { computePacketHash } from '../../src/handoff/integrity/hash.js';

export function tempDir(): string {
  const dir = join(tmpdir(), 'handoff-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function tempDbPath(): string {
  return join(tempDir(), 'test.db');
}

export function openTestStore(): { store: HandoffStore; db: Database.Database; dbPath: string } {
  const dbPath = tempDbPath();
  const db = openDb(dbPath);
  const store = new HandoffStore(db);
  store.migrate();
  return { store, db, dbPath };
}

export function makeTestPacket(overrides: Partial<HandoffPacket> = {}): HandoffPacket {
  const scope: HandoffScope = {
    projectId: 'test-project',
    runId: 'run-001',
    lane: 'worker',
    ...(overrides.scope ?? {}),
  };

  const instructions: HandoffInstructionLayer = {
    authoritative: ['Complete the backend implementation'],
    constraints: ['Do not modify shared types'],
    prohibitions: ['Do not delete test files'],
    ...(overrides.instructions ?? {}),
  };

  const decisions = overrides.decisions ?? [{
    id: 'dec-001',
    summary: 'Use SQLite for persistence',
    rationale: 'Lightweight, embedded, sufficient for single-host',
  }];

  const rejected = overrides.rejected ?? [{
    id: 'rej-001',
    summary: 'MongoDB was rejected',
    rationale: 'Overkill for local orchestration',
  }];

  const openLoops = overrides.openLoops ?? [{
    id: 'loop-001',
    summary: 'API tests not yet written',
    priority: 'high' as const,
    ownerRole: 'worker' as const,
  }];

  const artifacts = overrides.artifacts ?? [{
    id: 'art-001',
    name: 'schema.sql',
    kind: 'file' as const,
    storageRef: '/cas/sha256/ab/cd/abcdef',
    contentHash: 'abcdef1234567890',
  }];

  const contentFields = {
    summary: overrides.summary ?? 'Test handoff packet for worker execution',
    instructions,
    decisions,
    rejected,
    openLoops,
    artifacts,
    scope,
  };

  return {
    handoffId: overrides.handoffId ?? 'ho-test-001',
    packetVersion: overrides.packetVersion ?? 1,
    createdAt: overrides.createdAt ?? '2026-03-19T00:00:00Z',
    derivedFromRunId: overrides.derivedFromRunId ?? 'run-001',
    scope,
    summary: contentFields.summary,
    instructions,
    decisions,
    rejected,
    openLoops,
    artifacts,
    contentHash: overrides.contentHash ?? computePacketHash(contentFields),
  };
}
