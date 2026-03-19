/**
 * 8C-104: Retry/Recovery Test Harness
 *
 * End-to-end integration tests proving retry path, cleanup consistency,
 * and recovery behavior across the claim, policy, cleanup, and envelope subsystems.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runInit } from '../src/commands/init.js';
import { runFeatureCreate, runFeatureApprove } from '../src/commands/feature.js';
import { runPacketCreate, runPacketReady, type PacketDef } from '../src/commands/packet.js';
import { runClaim } from '../src/commands/claim.js';
import { endAttempt } from '../src/commands/claim.js';
import { openDb } from '../src/db/connection.js';
import { evaluatePolicy, POLICY_RULES, MAX_RETRIES } from '../src/hooks/policy.js';
import type { HookEventPayload } from '../src/hooks/events.js';
import type { EvaluatedConditions } from '../src/hooks/conditions.js';
import { cleanupOnStop, cleanupOrphanWorktrees } from '../src/runtime/cleanup.js';
import { createEnvelope, completeEnvelopeOnExit, getEnvelopes } from '../src/runtime/envelope.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mc-retry-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function tempDbPath(): string {
  return join(tmpdir(), `mc-retry-test-${randomBytes(4).toString('hex')}.db`);
}

function seedProofFeature(dbPath: string) {
  runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works'], 'mcp-tool-shop-org/GlyphStudio');
  runFeatureApprove(dbPath, 'anchor-propagation', 'mike');
  const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
  const packets: PacketDef[] = JSON.parse(fixtureData);
  runPacketCreate(dbPath, 'anchor-propagation', packets);
}

/** Release a claimed packet back to 'ready' so it can be re-claimed */
function releaseAndReady(dbPath: string, packetId: string) {
  const db = openDb(dbPath);
  db.prepare(`UPDATE claims SET is_active = 0, release_reason = 'failed' WHERE packet_id = ?`).run(packetId);
  db.prepare(`UPDATE packets SET status = 'ready' WHERE packet_id = ?`).run(packetId);
  db.close();
}

function makeEvent(event: string, entityId: string = 'test-packet', featureId: string = 'test-feature'): HookEventPayload {
  return { event: event as HookEventPayload['event'], entityType: 'packet', entityId, featureId, timestamp: new Date().toISOString() };
}

function makeConditions(overrides: Partial<EvaluatedConditions> = {}): EvaluatedConditions {
  return {
    claimableCount: 0,
    claimablePackets: [],
    fileOverlap: false,
    hasProtectedFiles: false,
    hasSeamFiles: false,
    criticalPathDepth: 3,
    graphDepth: 3,
    phaseType: 'subsystem',
    verifiedCount: 0,
    totalPackets: 5,
    activeWorkers: 0,
    allPacketsVerified: false,
    allPromotionsComplete: false,
    hasMergeApproval: false,
    retryCount: 0,
    docsEligible: false,
    ...overrides,
  };
}

// ─── 1. Retry Path Integration ───────────────────────────────────────

describe('Retry path integration (end-to-end)', () => {
  let dir: string;
  let dbPath: string;
  const PACKET_ID = 'anchor-propagation--contract-types';

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.multi-claude', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    seedProofFeature(dbPath);
    runPacketReady(dbPath, [PACKET_ID], 'mike');
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('claim -> endAttempt(failed) -> reclaim produces incrementing attempt numbers', () => {
    // Attempt 1: claim, end with failure
    const claim1 = runClaim(dbPath, PACKET_ID, 'builder-1');
    expect(claim1.ok).toBe(true);
    if (!claim1.ok) return;
    expect(claim1.result.attempt_number).toBe(1);

    const end1 = endAttempt(dbPath, PACKET_ID, 'failed');
    expect(end1.ok).toBe(true);
    expect(end1.alreadyEnded).toBe(false);
    expect(end1.attemptNumber).toBe(1);

    // Release claim and reset to ready for reclaim
    releaseAndReady(dbPath, PACKET_ID);

    // Attempt 2: different worker claims
    const claim2 = runClaim(dbPath, PACKET_ID, 'builder-2');
    expect(claim2.ok).toBe(true);
    if (!claim2.ok) return;
    expect(claim2.result.attempt_number).toBe(2);
  });

  it('endAttempt sets end_reason correctly in the database', () => {
    runClaim(dbPath, PACKET_ID, 'builder-1');
    endAttempt(dbPath, PACKET_ID, 'failed');

    const db = openDb(dbPath);
    try {
      const attempt = db.prepare(
        `SELECT end_reason, ended_at FROM packet_attempts WHERE packet_id = ? AND attempt_number = 1`,
      ).get(PACKET_ID) as { end_reason: string; ended_at: string };
      expect(attempt.end_reason).toBe('failed');
      expect(attempt.ended_at).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('retry count is trackable from DB across multiple failed attempts', () => {
    // Simulate 3 failed attempts
    for (let i = 1; i <= 3; i++) {
      const claim = runClaim(dbPath, PACKET_ID, `builder-${i}`);
      expect(claim.ok).toBe(true);
      if (!claim.ok) return;
      expect(claim.result.attempt_number).toBe(i);

      endAttempt(dbPath, PACKET_ID, 'failed');
      releaseAndReady(dbPath, PACKET_ID);
    }

    // Verify retry count from DB matches expectations
    const db = openDb(dbPath);
    try {
      const attempts = db.prepare(
        `SELECT COUNT(*) as cnt FROM packet_attempts WHERE packet_id = ? AND end_reason = 'failed'`,
      ).get(PACKET_ID) as { cnt: number };
      expect(attempts.cnt).toBe(3);
    } finally {
      db.close();
    }
  });

  it('endAttempt with submitted reason records correctly', () => {
    runClaim(dbPath, PACKET_ID, 'builder-1');
    const result = endAttempt(dbPath, PACKET_ID, 'submitted');
    expect(result.ok).toBe(true);
    expect(result.alreadyEnded).toBe(false);

    const db = openDb(dbPath);
    try {
      const attempt = db.prepare(
        `SELECT end_reason FROM packet_attempts WHERE packet_id = ? AND attempt_number = 1`,
      ).get(PACKET_ID) as { end_reason: string };
      expect(attempt.end_reason).toBe('submitted');
    } finally {
      db.close();
    }
  });
});

// ─── 2. Retry Limit Enforcement ──────────────────────────────────────

describe('Retry limit enforcement (policy integration)', () => {
  it('recommends retry_once for each attempt below MAX_RETRIES', () => {
    for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
      const event = makeEvent('packet.failed', `pkt-retry-${retryCount}`);
      const cond = makeConditions({ failureClass: 'deterministic', retryCount });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('retry_once');
      expect(result!.decision.reason).toContain('retry');
    }
  });

  it('does NOT recommend retry_once at MAX_RETRIES', () => {
    const event = makeEvent('packet.failed', 'pkt-exhausted');
    const cond = makeConditions({ failureClass: 'deterministic', retryCount: MAX_RETRIES });
    const result = evaluatePolicy(event, cond);
    // Should NOT be retry_once — should be verifier or escalation
    expect(result).not.toBeNull();
    expect(result!.decision.action).not.toBe('retry_once');
  });

  it('escalates after MAX_RETRIES failures via rule_4c', () => {
    const rule4c = POLICY_RULES.find(r => r.id === 'rule_4c_retry_limit')!;
    expect(rule4c).toBeDefined();

    const event = makeEvent('packet.failed', 'pkt-escalate');
    const cond = makeConditions({ failureClass: 'deterministic', retryCount: MAX_RETRIES });
    const decision = rule4c.evaluate(cond, event);
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe('escalate_human');
    expect(decision!.reason).toContain(`${MAX_RETRIES} retries`);
  });

  it('full retry path: attempt 1..MAX_RETRIES failures lead to escalation', () => {
    // Simulate the policy engine evaluation at each retry count
    const decisions: string[] = [];

    for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
      const event = makeEvent('packet.failed', 'pkt-full-path');
      const cond = makeConditions({ failureClass: 'deterministic', retryCount });
      const result = evaluatePolicy(event, cond);
      if (result) {
        decisions.push(result.decision.action);
      }
    }

    // First MAX_RETRIES iterations should be retry_once, last should be verifier analysis
    // (rule_4b fires before rule_4c in the array order)
    const retryDecisions = decisions.slice(0, MAX_RETRIES);
    const postLimitDecision = decisions[MAX_RETRIES];

    expect(retryDecisions.every(d => d === 'retry_once')).toBe(true);
    // At MAX_RETRIES, rule_4b (launch_verifier) fires first since it appears before rule_4c
    expect(postLimitDecision).toBe('launch_verifier');
  });
});

// ─── 3. Attempt Lifecycle Completeness ───────────────────────────────

describe('Attempt lifecycle completeness', () => {
  let dir: string;
  let dbPath: string;
  const PACKET_ID = 'anchor-propagation--contract-types';

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.multi-claude', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    seedProofFeature(dbPath);
    runPacketReady(dbPath, [PACKET_ID], 'mike');
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('endAttempt on active attempt sets ended_at timestamp', () => {
    runClaim(dbPath, PACKET_ID, 'builder-1');
    const result = endAttempt(dbPath, PACKET_ID, 'failed');
    expect(result.ok).toBe(true);
    expect(result.alreadyEnded).toBe(false);

    const db = openDb(dbPath);
    try {
      const attempt = db.prepare(
        `SELECT ended_at FROM packet_attempts WHERE packet_id = ? AND attempt_number = 1`,
      ).get(PACKET_ID) as { ended_at: string };
      expect(attempt.ended_at).toBeTruthy();
      // Verify it is a valid ISO date
      expect(new Date(attempt.ended_at).getTime()).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('endAttempt is idempotent: second call returns alreadyEnded=true', () => {
    runClaim(dbPath, PACKET_ID, 'builder-1');

    const first = endAttempt(dbPath, PACKET_ID, 'failed');
    expect(first.ok).toBe(true);
    expect(first.alreadyEnded).toBe(false);
    expect(first.attemptNumber).toBe(1);

    const second = endAttempt(dbPath, PACKET_ID, 'failed');
    expect(second.ok).toBe(true);
    expect(second.alreadyEnded).toBe(true);
    expect(second.attemptNumber).toBeUndefined();
  });

  it('endAttempt on packet with no attempts returns alreadyEnded=true', () => {
    // No claim has been made, so no attempts exist
    const result = endAttempt(dbPath, 'nonexistent--packet-id', 'failed');
    expect(result.ok).toBe(true);
    expect(result.alreadyEnded).toBe(true);
  });
});

// ─── 4. Cleanup Integration ─────────────────────────────────────────

describe('Cleanup integration (end-to-end)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tempDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('cleanupOnStop with completed returns cleaned=true and empty preserved', () => {
    const result = cleanupOnStop(testDir, 'pkt-completed', 'completed', tempDbPath());
    expect(result.cleaned).toBe(true);
    expect(result.preserved).toEqual([]);
  });

  it('cleanupOnStop with failed preserves worktree and output dirs', () => {
    const packetId = 'pkt-failed-evidence';
    const worktreePath = `${testDir}/.multi-claude/worktrees/${packetId}`;
    const outputDir = `${testDir}/.multi-claude/workers/${packetId}`;
    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(outputDir, { recursive: true });

    const result = cleanupOnStop(testDir, packetId, 'failed', tempDbPath());
    expect(result.cleaned).toBe(false);
    expect(result.preserved).toContain(worktreePath);
    expect(result.preserved).toContain(outputDir);
  });

  it('cleanupOnStop with sessionId completes the envelope', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-cleanup-1', 'pkt-cleanup-1', 'worker-1', 'builder', 'sonnet',
      ['Read', 'Write'], '/tmp', '/tmp/out', 'hash-cleanup',
    );

    const result = cleanupOnStop(testDir, 'pkt-cleanup-1', 'completed', dbPath, envelope.sessionId);
    expect(result.envelopeCompleted).toBe(true);

    // Verify envelope was completed in DB
    const envelopes = getEnvelopes(dbPath, 'run-cleanup-1');
    expect(envelopes.length).toBe(1);
    expect(envelopes[0].status).toBe('completed');
    expect(envelopes[0].completedAt).toBeTruthy();

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('cleanupOnStop without sessionId skips envelope finalization', () => {
    const result = cleanupOnStop(testDir, 'pkt-no-session', 'completed', tempDbPath());
    expect(result.envelopeCompleted).toBe(false);
  });

  it('cleanupOrphanWorktrees identifies orphans correctly', () => {
    const worktreeDir = join(testDir, '.multi-claude', 'worktrees');
    mkdirSync(join(worktreeDir, 'active-pkt-1'), { recursive: true });
    mkdirSync(join(worktreeDir, 'active-pkt-2'), { recursive: true });
    mkdirSync(join(worktreeDir, 'orphan-stale'), { recursive: true });
    mkdirSync(join(worktreeDir, 'orphan-leftover'), { recursive: true });

    const result = cleanupOrphanWorktrees(testDir, ['active-pkt-1', 'active-pkt-2']);
    expect(result.total).toBe(4);
    expect(result.orphans).toHaveLength(2);
    expect(result.orphans).toContain('orphan-stale');
    expect(result.orphans).toContain('orphan-leftover');
    expect(result.orphans).not.toContain('active-pkt-1');
  });

  it('cleanupOrphanWorktrees with no worktree dir returns empty', () => {
    const result = cleanupOrphanWorktrees(testDir, ['anything']);
    expect(result.total).toBe(0);
    expect(result.orphans).toEqual([]);
  });
});

// ─── 5. Envelope Lifecycle ──────────────────────────────────────────

describe('Envelope lifecycle (end-to-end)', () => {
  it('create -> complete -> verify terminal status', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-e2e-1', 'pkt-e2e-1', 'worker-1', 'builder', 'sonnet',
      ['Read', 'Write', 'Bash'], '/tmp/cwd', '/tmp/out', 'prompt-hash-1',
    );

    expect(envelope.status).toBe('running');
    expect(envelope.sessionId).toBeTruthy();

    const completeResult = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'completed');
    expect(completeResult.ok).toBe(true);

    // Verify terminal state in DB
    const envelopes = getEnvelopes(dbPath, 'run-e2e-1');
    expect(envelopes.length).toBe(1);
    expect(envelopes[0].status).toBe('completed');
    expect(envelopes[0].stopReason).toBe('completed');
    expect(envelopes[0].completedAt).toBeTruthy();

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('completeEnvelopeOnExit on already-completed envelope returns ok: false without throwing', () => {
    const dbPath = tempDbPath();
    const envelope = createEnvelope(
      dbPath, 'run-double', 'pkt-double', 'worker-1', 'builder', 'sonnet',
      ['Read'], '/tmp', '/tmp/out', 'hash-double',
    );

    // Complete once
    const first = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'completed');
    expect(first.ok).toBe(true);

    // Attempt again: should not throw, should return ok: false
    const second = completeEnvelopeOnExit(dbPath, envelope.sessionId, 'failed');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toContain('already completed');
    }

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  it('completeEnvelopeOnExit on nonexistent session returns ok: false without throwing', () => {
    const dbPath = tempDbPath();
    // Create DB with envelope table but no matching session
    createEnvelope(dbPath, 'run-other', 'pkt-other', 'w', 'builder', 'sonnet', [], '/tmp', '/tmp/out', 'h');

    const result = completeEnvelopeOnExit(dbPath, 'totally-fake-session-id', 'failed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not found');
    }

    try { rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });
});

// ─── 6. Cross-system integration ────────────────────────────────────

describe('Cross-system retry + cleanup + envelope integration', () => {
  let dir: string;
  let dbPath: string;
  let testDir: string;
  const PACKET_ID = 'anchor-propagation--contract-types';

  beforeEach(() => {
    dir = tempDir();
    testDir = tempDir();
    dbPath = join(dir, '.multi-claude', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    seedProofFeature(dbPath);
    runPacketReady(dbPath, [PACKET_ID], 'mike');
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('full retry cycle: claim -> fail -> endAttempt -> cleanup -> reclaim', () => {
    // Create envelope for session tracking
    const envelope = createEnvelope(
      dbPath, 'run-full-cycle', PACKET_ID, 'builder-1', 'builder', 'sonnet',
      ['Read', 'Write'], testDir, join(testDir, 'out'), 'hash-cycle',
    );

    // Claim the packet
    const claim1 = runClaim(dbPath, PACKET_ID, 'builder-1');
    expect(claim1.ok).toBe(true);
    if (!claim1.ok) return;
    expect(claim1.result.attempt_number).toBe(1);

    // Worker fails
    const end1 = endAttempt(dbPath, PACKET_ID, 'failed');
    expect(end1.ok).toBe(true);
    expect(end1.alreadyEnded).toBe(false);

    // Cleanup with envelope completion
    const cleanup = cleanupOnStop(testDir, PACKET_ID, 'failed', dbPath, envelope.sessionId);
    expect(cleanup.cleaned).toBe(false); // failed preserves evidence
    expect(cleanup.envelopeCompleted).toBe(true);

    // Verify envelope is terminal
    const envelopes = getEnvelopes(dbPath, 'run-full-cycle');
    expect(envelopes[0].status).toBe('failed');

    // Release and reclaim
    releaseAndReady(dbPath, PACKET_ID);
    const claim2 = runClaim(dbPath, PACKET_ID, 'builder-2');
    expect(claim2.ok).toBe(true);
    if (!claim2.ok) return;
    expect(claim2.result.attempt_number).toBe(2);
  });

  it('policy evaluation matches DB retry count after multiple failures', () => {
    // Run MAX_RETRIES claim-fail cycles
    for (let i = 1; i <= MAX_RETRIES; i++) {
      const claim = runClaim(dbPath, PACKET_ID, `builder-${i}`);
      expect(claim.ok).toBe(true);
      endAttempt(dbPath, PACKET_ID, 'failed');
      releaseAndReady(dbPath, PACKET_ID);
    }

    // Read actual retry count from DB
    const db = openDb(dbPath);
    let retryCount: number;
    try {
      const row = db.prepare(
        `SELECT COUNT(*) as cnt FROM packet_attempts WHERE packet_id = ?`,
      ).get(PACKET_ID) as { cnt: number };
      retryCount = row.cnt;
    } finally {
      db.close();
    }

    expect(retryCount).toBe(MAX_RETRIES);

    // Now evaluate policy with the actual retry count
    const event = makeEvent('packet.failed', PACKET_ID);
    const cond = makeConditions({ failureClass: 'deterministic', retryCount });
    const result = evaluatePolicy(event, cond);

    // At MAX_RETRIES, rule_4b fires first (launch_verifier)
    expect(result).not.toBeNull();
    expect(result!.decision.action).not.toBe('retry_once');
  });
});
