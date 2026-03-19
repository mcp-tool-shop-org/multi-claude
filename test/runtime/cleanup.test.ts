import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { cleanupOnStop, cleanupOrphanWorktrees } from '../../src/runtime/cleanup.js';
import { completeEnvelopeOnExit, createEnvelope } from '../../src/runtime/envelope.js';
import { openDb } from '../../src/db/connection.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mc-cleanup-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function tempDbPath(): string {
  return join(tmpdir(), `mc-cleanup-test-${randomBytes(4).toString('hex')}.db`);
}

describe('cleanupOnStop', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tempDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('completed stopReason returns cleaned=true', () => {
    // No real git worktree needed — existsSync will return false for the path
    const result = cleanupOnStop(testDir, 'test-packet-01', 'completed', tempDbPath());
    expect(result.cleaned).toBe(true);
    expect(result.preserved).toEqual([]);
  });

  it('failed stopReason preserves evidence and returns cleaned=false', () => {
    const packetId = 'test-packet-02';
    // cleanup.ts constructs paths with forward slashes via template literals,
    // so we must create dirs using that same path format for existsSync to match
    const worktreePath = `${testDir}/.multi-claude/worktrees/${packetId}`;
    const outputDir = `${testDir}/.multi-claude/workers/${packetId}`;
    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const result = cleanupOnStop(testDir, packetId, 'failed', tempDbPath());
    expect(result.cleaned).toBe(false);
    expect(result.preserved).toContain(worktreePath);
    expect(result.preserved).toContain(outputDir);
  });

  it('with sessionId calls completeEnvelopeOnExit and reports envelope completion', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-1', 'pkt-1', 'worker-1', 'builder', 'sonnet',
      ['Read', 'Write'], '/tmp', '/tmp/out', 'hash123',
    );

    const result = cleanupOnStop(testDir, 'pkt-1', 'completed', dbPath, envelope.sessionId);
    expect(result.envelopeCompleted).toBe(true);

    // Verify the envelope was actually completed in DB
    const db = openDb(dbPath);
    try {
      const row = db.prepare('SELECT status FROM runtime_envelopes WHERE session_id = ?')
        .get(envelope.sessionId) as { status: string };
      expect(row.status).toBe('completed');
    } finally {
      db.close();
    }

    // Cleanup
    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('without sessionId skips envelope completion', () => {
    const result = cleanupOnStop(testDir, 'pkt-no-session', 'completed', tempDbPath());
    expect(result.envelopeCompleted).toBe(false);
  });
});

describe('cleanupOrphanWorktrees', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tempDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('finds orphan directories not in knownPacketIds', () => {
    const worktreeDir = join(testDir, '.multi-claude', 'worktrees');
    mkdirSync(join(worktreeDir, 'known-packet'), { recursive: true });
    mkdirSync(join(worktreeDir, 'orphan-a'), { recursive: true });
    mkdirSync(join(worktreeDir, 'orphan-b'), { recursive: true });

    const result = cleanupOrphanWorktrees(testDir, ['known-packet']);
    expect(result.total).toBe(3);
    expect(result.orphans).toContain('orphan-a');
    expect(result.orphans).toContain('orphan-b');
    expect(result.orphans).not.toContain('known-packet');
  });

  it('returns empty when all worktrees are known', () => {
    const worktreeDir = join(testDir, '.multi-claude', 'worktrees');
    mkdirSync(join(worktreeDir, 'pkt-a'), { recursive: true });
    mkdirSync(join(worktreeDir, 'pkt-b'), { recursive: true });

    const result = cleanupOrphanWorktrees(testDir, ['pkt-a', 'pkt-b']);
    expect(result.total).toBe(2);
    expect(result.orphans).toEqual([]);
  });

  it('returns empty when worktree directory does not exist', () => {
    const result = cleanupOrphanWorktrees(testDir, ['anything']);
    expect(result.total).toBe(0);
    expect(result.orphans).toEqual([]);
  });
});

describe('completeEnvelopeOnExit', () => {
  it('never throws with invalid dbPath', () => {
    const result = completeEnvelopeOnExit('/nonexistent/path/db.sqlite', 'fake-session', 'failed');
    expect(result.ok).toBe(false);
    expect('reason' in result && typeof result.reason).toBe('string');
  });

  it('never throws with invalid sessionId', () => {
    const dbPath = tempDbPath();
    // Create the DB so it opens, but the session won't exist
    const db = openDb(dbPath);
    db.close();

    const result = completeEnvelopeOnExit(dbPath, 'nonexistent-session', 'failed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not found');
    }

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('returns ok: false when envelope is already completed', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-2', 'pkt-2', 'worker-2', 'builder', 'sonnet',
      ['Read'], '/tmp', '/tmp/out', 'hash456',
    );

    // Complete it once
    const first = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'completed');
    expect(first.ok).toBe(true);

    // Try to complete again
    const second = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'failed');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toContain('already completed');
    }

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('successfully completes a running envelope', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-3', 'pkt-3', 'worker-3', 'builder', 'sonnet',
      ['Read', 'Write'], '/tmp', '/tmp/out', 'hash789',
    );

    const result = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'completed');
    expect(result.ok).toBe(true);

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });
});
