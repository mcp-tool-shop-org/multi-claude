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
import { runVerify } from '../src/commands/verify.js';
import { openDb } from '../src/db/connection.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mcf-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
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
    dependencies_affected: [],
    tests_added: ['packages/domain/src/anchor.test.ts'],
    docs_required: false,
    architecture_impact: null,
    relationship_suggestions: [],
    prose: {
      what_changed: 'Added propagation type definitions',
      why_changed: 'Required for anchor propagation feature',
      what_to_watch: 'Downstream packages will import these',
      what_affects_next: 'Backend and state packets depend on this',
    },
  },
});

const PASSING_CHECKS = JSON.stringify({
  code_exists: true,
  tests_exist: true,
  no_forbidden_files: true,
  no_protected_files: true,
  no_seam_files_modified: true,
  writeback_present: true,
  merge_readiness_declared: true,
});

const FAILING_CHECKS = JSON.stringify({
  code_exists: true,
  tests_exist: false,
  no_forbidden_files: true,
  no_protected_files: true,
  no_seam_files_modified: true,
  writeback_present: true,
  merge_readiness_declared: true,
});

function seedSubmittedPacket(dbPath: string): string {
  runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate', ['Works'], 'org/r');
  runFeatureApprove(dbPath, 'anchor-propagation', 'mike');
  const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
  runPacketCreate(dbPath, 'anchor-propagation', JSON.parse(fixtureData));
  runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');
  runClaim(dbPath, 'anchor-propagation--contract-types', 'builder-1', undefined, 'sonnet');
  runProgress(dbPath, 'anchor-propagation--contract-types', 'builder-1');
  runSubmit(dbPath, 'anchor-propagation--contract-types', 'builder-1', VALID_ARTIFACTS, VALID_WRITEBACK, true, 'Added types');
  return 'anchor-propagation--contract-types';
}

describe('mcf verify', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    runInit('org/r', dbPath);
  });

  afterEach(() => {
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('passes verification with passing checks', () => {
    seedSubmittedPacket(dbPath);
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', PASSING_CHECKS, 'pass', 'All checks passed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.verdict).toBe('pass');
    expect(result.result.checks_passed).toBe(7);
    expect(result.result.checks_failed).toBe(0);
  });

  it('moves packet to verified on pass', () => {
    seedSubmittedPacket(dbPath);
    runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', PASSING_CHECKS, 'pass', 'OK');

    const db = openDb(dbPath);
    try {
      const packet = db.prepare('SELECT status FROM packets WHERE packet_id = ?').get('anchor-propagation--contract-types') as { status: string };
      expect(packet.status).toBe('verified');
    } finally {
      db.close();
    }
  });

  it('moves packet to failed on fail', () => {
    seedSubmittedPacket(dbPath);
    const failures = JSON.stringify({ tests_exist: 'No test files found' });
    runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', FAILING_CHECKS, 'fail', 'Missing tests', failures);

    const db = openDb(dbPath);
    try {
      const packet = db.prepare('SELECT status FROM packets WHERE packet_id = ?').get('anchor-propagation--contract-types') as { status: string };
      expect(packet.status).toBe('failed');
    } finally {
      db.close();
    }
  });

  it('rejects same-session verifier (independence)', () => {
    seedSubmittedPacket(dbPath);
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'builder-1', 'verifier-checklist', PASSING_CHECKS, 'pass', 'OK');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INDEPENDENCE_VIOLATION');
  });

  it('rejects analysis without prior checklist failure', () => {
    seedSubmittedPacket(dbPath);
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-analysis', FAILING_CHECKS, 'fail', 'Analysis', '{}', '{}', 'retry');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('CHECKLIST_REQUIRED_FIRST');
  });

  it('allows analysis after checklist failure', () => {
    seedSubmittedPacket(dbPath);
    // First: checklist fails
    const failures = JSON.stringify({ tests_exist: 'No test files found' });
    runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', FAILING_CHECKS, 'fail', 'Failed', failures);

    // Manually set packet back to submitted for analysis (simulating retry workflow)
    const db = openDb(dbPath);
    db.prepare(`UPDATE packets SET status = 'submitted' WHERE packet_id = 'anchor-propagation--contract-types'`).run();
    db.close();

    const analysis = JSON.stringify({ root_cause: 'Missing tests', recommendation: 'retry' });
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-2', 'verifier-analysis', FAILING_CHECKS, 'fail', 'Needs tests', failures, analysis, 'retry');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.verifier_role).toBe('verifier-analysis');
    expect(result.result.retry_recommendation).toBe('retry');
  });

  it('rejects pass verdict with failed checks', () => {
    seedSubmittedPacket(dbPath);
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', FAILING_CHECKS, 'pass', 'OK');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('VERDICT_MISMATCH');
  });

  it('rejects fail verdict without failure details', () => {
    seedSubmittedPacket(dbPath);
    const result = runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', FAILING_CHECKS, 'fail', 'Failed');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('MISSING_FAILURES');
  });

  it('writes transition log', () => {
    seedSubmittedPacket(dbPath);
    runVerify(dbPath, 'anchor-propagation--contract-types', 'verifier-1', 'verifier-checklist', PASSING_CHECKS, 'pass', 'OK');

    const db = openDb(dbPath);
    try {
      const transition = db.prepare(`
        SELECT from_state, to_state, actor_type, actor_id FROM state_transition_log
        WHERE entity_id = 'anchor-propagation--contract-types' AND to_state = 'verified'
      `).get() as { from_state: string; to_state: string; actor_type: string; actor_id: string };
      expect(transition.from_state).toBe('submitted');
      expect(transition.actor_type).toBe('verifier');
      expect(transition.actor_id).toBe('verifier-1');
    } finally {
      db.close();
    }
  });
});
