import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runInit } from '../src/commands/init.js';
import { runFeatureCreate, runFeatureApprove } from '../src/commands/feature.js';
import { runPacketCreate, runPacketReady, type PacketDef } from '../src/commands/packet.js';
import { runClaim, runProgress } from '../src/commands/claim.js';
import { openDb } from '../src/db/connection.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mcf-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedProofFeature(dbPath: string) {
  runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works'], 'mcp-tool-shop-org/GlyphStudio');
  runFeatureApprove(dbPath, 'anchor-propagation', 'mike');
  const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
  const packets: PacketDef[] = JSON.parse(fixtureData);
  runPacketCreate(dbPath, 'anchor-propagation', packets);
}

describe('mcf claim', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    seedProofFeature(dbPath);
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('claims a ready packet with no unmet deps', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1', undefined, 'sonnet');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.packet_id).toBe('anchor-propagation--contract-types');
    expect(result.result.attempt_number).toBe(1);
    expect(result.result.role).toBe('architect');
    expect(result.result.lease_expires_at).toBeDefined();
    expect(result.result.allowed_files).toContain('packages/domain/src/anchor.ts');
  });

  it('fails if packet is not ready (still draft)', () => {
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_READY');
  });

  it('fails if hard deps are not merged', () => {
    // Ready the contract packet AND the backend packet
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
    runPacketReady(dbPath, ['anchor-propagation--backend-engine'], 'mike');

    // Try to claim backend — contract-types is ready but not merged
    const result = runClaim(dbPath, 'anchor-propagation--backend-engine', 'builder-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('DEPENDENCIES_NOT_MET');
    expect((result.context as { unmet: unknown[] }).unmet).toHaveLength(1);
  });

  it('fails if already claimed (packet is no longer ready)', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
    runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');

    // Second claim fails because packet status is 'claimed', not 'ready'
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_READY');
    expect((result.context as { current_status: string }).current_status).toBe('claimed');
  });

  it('fails on nonexistent packet', () => {
    const result = runClaim(dbPath, 'nonexistent--packet-id', 'builder-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_FOUND');
  });

  it('creates attempt and claim atomically', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const db = openDb(dbPath);
    try {
      // Verify attempt exists
      const attempt = db.prepare(`SELECT * FROM packet_attempts WHERE packet_id = 'anchor-propagation--contract-types'`).get() as Record<string, unknown>;
      expect(attempt).toBeDefined();
      expect(attempt.attempt_number).toBe(1);
      expect(attempt.started_by).toBe('builder-1');

      // Verify claim exists
      const claim = db.prepare(`SELECT * FROM claims WHERE packet_id = 'anchor-propagation--contract-types' AND is_active = 1`).get() as Record<string, unknown>;
      expect(claim).toBeDefined();
      expect(claim.claimed_by).toBe('builder-1');
      expect(claim.lease_expires_at).toBeDefined();

      // Verify packet status
      const packet = db.prepare(`SELECT status FROM packets WHERE packet_id = 'anchor-propagation--contract-types'`).get() as { status: string };
      expect(packet.status).toBe('claimed');

      // Verify transition log
      const transition = db.prepare(`
        SELECT * FROM state_transition_log
        WHERE entity_id = 'anchor-propagation--contract-types' AND to_state = 'claimed'
      `).get() as Record<string, unknown>;
      expect(transition).toBeDefined();
      expect(transition.from_state).toBe('ready');
    } finally {
      db.close();
    }
  });

  it('sets lease to approximately 2 hours from now', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const leaseTime = new Date(result.result.lease_expires_at).getTime();
    const now = Date.now();
    const twoHoursMs = 2 * 60 * 60 * 1000;
    // Allow 10 second tolerance
    expect(Math.abs(leaseTime - now - twoHoursMs)).toBeLessThan(10_000);
  });

  it('allows reclaim after release', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');

    // First claim
    runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');

    // Manually release (simulating expiry)
    const db = openDb(dbPath);
    db.prepare(`UPDATE claims SET is_active = 0, release_reason = 'expired' WHERE packet_id = 'anchor-propagation--contract-types'`).run();
    db.prepare(`UPDATE packets SET status = 'ready' WHERE packet_id = 'anchor-propagation--contract-types'`).run();
    db.close();

    // Second claim by different worker
    const result = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.attempt_number).toBe(2);
    expect(result.result.claim_id).not.toBe('');
  });

  it('increments attempt number on reclaim', () => {
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');

    const first = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.attempt_number).toBe(1);

    // Release
    const db = openDb(dbPath);
    db.prepare(`UPDATE claims SET is_active = 0 WHERE packet_id = 'anchor-propagation--contract-types'`).run();
    db.prepare(`UPDATE packets SET status = 'ready' WHERE packet_id = 'anchor-propagation--contract-types'`).run();
    db.close();

    const second = runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-2');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.attempt_number).toBe(2);
  });
});

describe('mcf progress', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    seedProofFeature(dbPath);
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('moves claimed packet to in_progress', () => {
    runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    const result = runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.status).toBe('in_progress');
  });

  it('fails if not claimed', () => {
    const result = runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_CLAIMED');
  });

  it('fails if wrong owner', () => {
    runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    const result = runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('NOT_OWNER');
  });

  it('writes transition log', () => {
    runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1');
    runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-1');

    const db = openDb(dbPath);
    try {
      const transition = db.prepare(`
        SELECT from_state, to_state FROM state_transition_log
        WHERE entity_id = 'anchor-propagation--contract-types' AND to_state = 'in_progress'
      `).get() as { from_state: string; to_state: string };
      expect(transition.from_state).toBe('claimed');
      expect(transition.to_state).toBe('in_progress');
    } finally {
      db.close();
    }
  });
});
