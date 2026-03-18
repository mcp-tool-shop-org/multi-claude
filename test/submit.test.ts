import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runInit } from '../src/commands/init.js';
import { runFeatureCreate, runFeatureApprove } from '../src/commands/feature.js';
import { runPacketCreate, runPacketReady, type PacketDef } from '../src/commands/packet.js';
import { runClaim, runProgress } from '../src/commands/claim.js';
import { runSubmit } from '../src/commands/submit.js';
import { runRender } from '../src/commands/render.js';
import { openDb } from '../src/db/connection.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mcf-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedAndClaim(dbPath: string): { packetId: string } {
  runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works'], 'mcp-tool-shop-org/GlyphStudio');
  runFeatureApprove(dbPath, 'anchor-propagation', 'mike');
  const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
  const packets: PacketDef[] = JSON.parse(fixtureData);
  runPacketCreate(dbPath, 'anchor-propagation', packets);
  runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
  runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1', undefined, 'sonnet');
  runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-1');
  return { packetId: 'anchor-propagation--contract-types' };
}

const VALID_ARTIFACTS = JSON.stringify({
  files_created: ['packages/domain/src/anchor.ts'],
  files_modified: [],
  files_deleted: [],
  test_files: ['packages/domain/src/anchor.test.ts'],
});

const VALID_WRITEBACK = JSON.stringify({
  writeback: {
    module: 'packages/domain/src/anchor',
    change_type: 'added',
    summary: 'Added PropagationMode, PropagationScope, PropagationResult types',
    files_touched: ['packages/domain/src/anchor.ts'],
    contract_delta: 'none',
    risks: [],
    dependencies_affected: ['backend-engine', 'state-store'],
    tests_added: ['packages/domain/src/anchor.test.ts'],
    docs_required: false,
    architecture_impact: 'New propagation type system added to domain package',
    relationship_suggestions: [],
    prose: {
      what_changed: 'Added propagation type definitions to the domain package',
      why_changed: 'Required for the anchor propagation feature across all layers',
      what_to_watch: 'Backend and state packages will import these types',
      what_affects_next: 'Backend engine and state store packets depend on these types',
    },
  },
});

describe('mcf submit', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('submits a valid packet', () => {
    seedAndClaim(dbPath);
    const result = runSubmit(
      dbPath, 'anchor-propagation--contract-types', 'builder-1',
      VALID_ARTIFACTS, VALID_WRITEBACK, true,
      'Added propagation type definitions',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.submission_id).toBe('anchor-propagation--contract-types--sub-1');
    expect(result.result.merge_ready).toBe(true);
    expect(result.result.artifacts_count).toBe(1);
    expect(result.result.tests_count).toBe(1);
  });

  it('releases claim and closes attempt on submit', () => {
    seedAndClaim(dbPath);
    runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', VALID_ARTIFACTS, VALID_WRITEBACK, true, 'done');

    const db = openDb(dbPath);
    try {
      const claim = db.prepare(`SELECT is_active, release_reason FROM claims WHERE packet_id = 'anchor-propagation--contract-types'`).get() as { is_active: number; release_reason: string };
      expect(claim.is_active).toBe(0);
      expect(claim.release_reason).toBe('submitted');

      const attempt = db.prepare(`SELECT end_reason FROM packet_attempts WHERE packet_id = 'anchor-propagation--contract-types'`).get() as { end_reason: string };
      expect(attempt.end_reason).toBe('submitted');

      const packet = db.prepare(`SELECT status FROM packets WHERE packet_id = 'anchor-propagation--contract-types'`).get() as { status: string };
      expect(packet.status).toBe('submitted');
    } finally {
      db.close();
    }
  });

  it('rejects if not in_progress', () => {
    runFeatureCreate(dbPath, 'f1', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f1', 'mike');
    runPacketCreate(dbPath, 'f1', [{
      packet_id: 'f1--backend-x',
      title: 'T', layer: 'backend', descriptor: 'x', role: 'builder',
      playbook_id: 'bp', goal: 'g', allowed_files: ['src/x.ts'],
      verification_profile_id: 'vp',
    }]);
    runPacketReady(dbPath, ['f1--backend-x'], 'mike');
    // Claimed but not progressed
    runClaim(dbPath, 'f1--backend-x', 'builder-1');

    const result = runSubmit(dbPath, 'f1--backend-x', 'builder-1', VALID_ARTIFACTS, VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_IN_PROGRESS');
  });

  it('rejects if wrong owner', () => {
    seedAndClaim(dbPath);
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-2', VALID_ARTIFACTS, VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('NOT_OWNER');
  });

  it('rejects invalid artifact manifest', () => {
    seedAndClaim(dbPath);
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', '{"bad": true}', VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_ARTIFACTS');
  });

  it('rejects empty writeback', () => {
    seedAndClaim(dbPath);
    const emptyWriteback = JSON.stringify({ writeback: { module: '', change_type: '', summary: '', files_touched: [], prose: {} } });
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', VALID_ARTIFACTS, emptyWriteback, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_WRITEBACK');
  });

  it('rejects generic writeback summary', () => {
    seedAndClaim(dbPath);
    const genericWriteback = VALID_WRITEBACK.replace(
      'Added PropagationMode, PropagationScope, PropagationResult types',
      'implemented the feature',
    );
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', VALID_ARTIFACTS, genericWriteback, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_WRITEBACK');
  });

  it('rejects submission with no tests', () => {
    seedAndClaim(dbPath);
    const noTests = JSON.stringify({
      files_created: ['packages/domain/src/anchor.ts'],
      files_modified: [],
      files_deleted: [],
      test_files: [],
    });
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', noTests, VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('NO_TESTS');
  });

  it('rejects file outside allowed scope', () => {
    seedAndClaim(dbPath);
    const outOfScope = JSON.stringify({
      files_created: ['src/totally/wrong/place.ts'],
      files_modified: [],
      files_deleted: [],
      test_files: ['src/test.ts'],
    });
    const result = runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', outOfScope, VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('SCOPE_VIOLATION');
  });

  it('rejects forbidden file', () => {
    // Create a packet with forbidden files
    runFeatureCreate(dbPath, 'f2', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f2', 'mike');
    runPacketCreate(dbPath, 'f2', [{
      packet_id: 'f2--backend-x',
      title: 'T', layer: 'backend', descriptor: 'x', role: 'builder',
      playbook_id: 'bp', goal: 'g',
      allowed_files: ['src/**'],
      forbidden_files: ['src/lib.rs'],
      verification_profile_id: 'vp',
    }]);
    runPacketReady(dbPath, ['f2--backend-x'], 'mike');
    runClaim(dbPath, 'f2--backend-x', 'builder-1');
    runProgress(dbPath, 'f2--backend-x', 'builder-1');

    const touchesForbidden = JSON.stringify({
      files_created: [],
      files_modified: ['src/lib.rs'],
      files_deleted: [],
      test_files: ['src/test.ts'],
    });
    const result = runSubmit(dbPath, 'f2--backend-x', 'builder-1', touchesForbidden, VALID_WRITEBACK, true, 'done');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('FORBIDDEN_FILE_TOUCHED');
  });

  it('writes transition log on submit', () => {
    seedAndClaim(dbPath);
    runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', VALID_ARTIFACTS, VALID_WRITEBACK, true, 'done');

    const db = openDb(dbPath);
    try {
      const transition = db.prepare(`
        SELECT from_state, to_state, actor_id FROM state_transition_log
        WHERE entity_id = 'anchor-propagation--contract-types' AND to_state = 'submitted'
      `).get() as { from_state: string; to_state: string; actor_id: string };
      expect(transition.from_state).toBe('in_progress');
      expect(transition.to_state).toBe('submitted');
      expect(transition.actor_id).toBe('builder-1');
    } finally {
      db.close();
    }
  });
});

describe('mcf render', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works'], 'mcp-tool-shop-org/GlyphStudio');
    runFeatureApprove(dbPath, 'anchor-propagation', 'mike');
    const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
    runPacketCreate(dbPath, 'anchor-propagation', JSON.parse(fixtureData));
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('renders a packet to markdown', () => {
    const result = runRender(dbPath, 'anchor-propagation--contract-types');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('# PACKET: anchor-propagation--contract-types');
  });

  it('includes goal', () => {
    const result = runRender(dbPath, 'anchor-propagation--contract-types');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('PropagationMode');
  });

  it('shows allowed files', () => {
    const result = runRender(dbPath, 'anchor-propagation--contract-types');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('packages/domain/src/anchor.ts');
  });

  it('shows dependencies with status', () => {
    const result = runRender(dbPath, 'anchor-propagation--backend-engine');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('anchor-propagation--contract-types');
    expect(result.result.markdown).toContain('hard');
  });

  it('shows contract delta policy', () => {
    const result = runRender(dbPath, 'anchor-propagation--contract-types');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('author');
    expect(result.result.markdown).toContain('contract packet');
  });

  it('shows knowledge writeback requirements', () => {
    const result = runRender(dbPath, 'anchor-propagation--backend-engine');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('Required');
    expect(result.result.markdown).toContain('module');
  });

  it('shows verification rule profile', () => {
    const result = runRender(dbPath, 'anchor-propagation--contract-types');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('contract');
  });

  it('shows access rules', () => {
    const result = runRender(dbPath, 'anchor-propagation--integration-wiring');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.markdown).toContain('merge_only');
    expect(result.result.markdown).toContain('modify');
  });

  it('fails for nonexistent packet', () => {
    const result = runRender(dbPath, 'nonexistent--packet-id');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('PACKET_NOT_FOUND');
  });
});
