import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';

import {
  queryFitnessView,
  queryPacketMaturation,
  queryEvidence,
} from '../../src/console/fitness-view.js';

// ── Test DB Setup ───────────────────────────────────────────────────

let tmpCounter = 0;

function createTestDb(): { db: Database.Database; path: string } {
  mkdirSync(join(import.meta.dirname, '../../.multi-claude'), { recursive: true });
  const path = join(
    import.meta.dirname,
    `../../.multi-claude/test-fitness-view-${tmpCounter++}-${Date.now()}.db`
  );

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply main schema
  const schemaPath = join(import.meta.dirname, '../../src/db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Apply fitness schema
  const fitnessSchemaPath = join(import.meta.dirname, '../../src/fitness/schema.sql');
  const fitnessSchema = readFileSync(fitnessSchemaPath, 'utf-8');
  db.exec(fitnessSchema);

  return { db, path };
}

const NOW = '2026-03-19T12:00:00Z';
const EARLIER = '2026-03-19T11:00:00Z';
const LATER = '2026-03-19T13:00:00Z';
const FEATURE_ID = 'test-feat-1';
const RUN_ID = 'run-001';

function seedFeature(db: Database.Database): void {
  db.prepare(
    `INSERT INTO features (feature_id, repo_slug, title, objective, status, priority,
      merge_target, acceptance_criteria, created_by, created_at, updated_at)
     VALUES (?, 'test-repo', 'Test Feature', 'Objective', 'in_progress', 'normal',
      'main', '[]', 'operator', ?, ?)`
  ).run(FEATURE_ID, NOW, NOW);
}

function seedPacket(
  db: Database.Database,
  id: string,
  opts: { layer?: string; role?: string; status?: string; updatedAt?: string } = {}
): void {
  const layer = opts.layer ?? 'state';
  const role = opts.role ?? 'builder';
  const status = opts.status ?? 'submitted';
  const updatedAt = opts.updatedAt ?? NOW;
  const ruleProfile = layer === 'integration' ? 'integration' : 'builder';

  db.prepare(
    `INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role,
      playbook_id, status, goal, allowed_files, forbidden_files,
      verification_profile_id, rule_profile, contract_delta_policy,
      created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'impl', ?, 'playbook', ?, 'goal', '[]', '[]',
      'profile', ?, 'declare', 'operator', ?, ?)`
  ).run(id, FEATURE_ID, `Packet ${id}`, layer, role, status, ruleProfile, NOW, updatedAt);
}

function seedRunScore(
  db: Database.Database,
  opts: {
    quality?: number;
    lawfulness?: number;
    collaboration?: number;
    velocity?: number;
    grade?: string;
    penalties?: string;
    computedAt?: string;
  } = {}
): void {
  const q = opts.quality ?? 35;
  const l = opts.lawfulness ?? 22;
  const c = opts.collaboration ?? 18;
  const v = opts.velocity ?? 12;
  const total = q + l + c + v;

  db.prepare(
    `INSERT INTO run_scores (run_id, feature_id, total_score, quality_score,
      lawfulness_score, collaboration_score, velocity_score, grade, status,
      penalties_json, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'computed', ?, ?)`
  ).run(
    RUN_ID, FEATURE_ID, total, q, l, c, v,
    opts.grade ?? 'B',
    opts.penalties ?? '[]',
    opts.computedAt ?? NOW
  );
}

function seedPacketScore(
  db: Database.Database,
  packetId: string,
  opts: {
    maturationStage?: string;
    submitScore?: number;
    verifyScore?: number;
    integrateScore?: number;
    finalScore?: number;
    penalties?: number;
    packetClass?: string;
    durationSeconds?: number | null;
  } = {}
): void {
  db.prepare(
    `INSERT INTO packet_scores (packet_id, run_id, packet_class, submit_score,
      verify_score, integrate_score, penalties, final_score, maturation_stage,
      duration_seconds, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    packetId, RUN_ID,
    opts.packetClass ?? 'state_domain',
    opts.submitScore ?? 0.2,
    opts.verifyScore ?? 0.3,
    opts.integrateScore ?? 0.5,
    opts.penalties ?? 0,
    opts.finalScore ?? 1.0,
    opts.maturationStage ?? 'none',
    opts.durationSeconds ?? null,
    NOW
  );
}

function seedSubmission(
  db: Database.Database,
  packetId: string,
  opts: { summary?: string; mergeReady?: boolean; submittedAt?: string } = {}
): void {
  const attemptId = `att-${packetId}`;
  const submissionId = `sub-${packetId}`;

  db.prepare(
    `INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number,
      started_by, started_at, ended_at, end_reason, role, summary)
     VALUES (?, ?, 1, 'builder', ?, ?, 'submitted', 'builder', 'done')`
  ).run(attemptId, packetId, NOW, NOW);

  db.prepare(
    `INSERT INTO packet_submissions (submission_id, packet_id, attempt_id,
      submitted_by, submitted_at, artifact_manifest, writeback,
      declared_merge_ready, builder_summary)
     VALUES (?, ?, ?, 'builder', ?, '{}', '{}', ?, ?)`
  ).run(
    submissionId, packetId, attemptId,
    opts.submittedAt ?? NOW,
    opts.mergeReady ? 1 : 0,
    opts.summary ?? 'Built the thing'
  );
}

function seedVerification(
  db: Database.Database,
  packetId: string,
  opts: {
    status?: string;
    summary?: string;
    checks?: string;
    failures?: string;
    completedAt?: string;
  } = {}
): void {
  const attemptId = `att-${packetId}`;
  const submissionId = `sub-${packetId}`;
  const vrId = `vr-${packetId}`;

  // Ensure attempt and submission exist
  const attemptExists = db.prepare(
    `SELECT 1 FROM packet_attempts WHERE attempt_id = ?`
  ).get(attemptId);
  if (!attemptExists) {
    seedSubmission(db, packetId);
  }

  db.prepare(
    `INSERT INTO verification_results (verification_result_id, packet_id,
      attempt_id, submission_id, verified_by, verifier_role, started_at,
      completed_at, status, rule_profile, checks, failures, summary)
     VALUES (?, ?, ?, ?, 'verifier', 'verifier-checklist', ?, ?, ?, 'builder', ?, ?, ?)`
  ).run(
    vrId, packetId, attemptId, submissionId,
    NOW,
    opts.completedAt ?? NOW,
    opts.status ?? 'verified',
    opts.checks ?? '{}',
    opts.failures ?? null,
    opts.summary ?? 'All checks pass'
  );
}

function seedIntegrationRun(
  db: Database.Database,
  opts: {
    id?: string;
    status?: string;
    summary?: string;
    packetsIncluded?: string;
    completedAt?: string;
  } = {}
): void {
  db.prepare(
    `INSERT INTO integration_runs (integration_run_id, feature_id, status,
      started_by, started_at, completed_at, packets_included, merge_target, summary)
     VALUES (?, ?, ?, 'integrator', ?, ?, ?, 'main', ?)`
  ).run(
    opts.id ?? 'ir-001',
    FEATURE_ID,
    opts.status ?? 'merged',
    NOW,
    opts.completedAt ?? NOW,
    opts.packetsIncluded ?? '["pkt-1"]',
    opts.summary ?? 'Integration complete'
  );
}

// ── Tests ───────────────────────────────────────────────────────────

let testDb: Database.Database;
let testDbPath: string;

beforeEach(() => {
  const { db, path } = createTestDb();
  testDb = db;
  testDbPath = path;
  seedFeature(testDb);
});

afterEach(() => {
  testDb.close();
  try { unlinkSync(testDbPath); } catch { /* ignore */ }
});

describe('queryFitnessView', () => {
  it('returns null runScore when no scores exist', () => {
    seedPacket(testDb, 'pkt-1');
    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore).toBeNull();
    expect(result.queriedAt).toBeTruthy();
  });

  it('returns correct runScore when scores exist', () => {
    seedPacket(testDb, 'pkt-1');
    seedRunScore(testDb, {
      quality: 36, lawfulness: 20, collaboration: 17, velocity: 10, grade: 'B',
    });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore).not.toBeNull();
    expect(result.runScore!.grade).toBe('B');
    expect(result.runScore!.overall).toBe(83);
    expect(result.runScore!.quality).toBe(36);
    expect(result.runScore!.lawfulness).toBe(20);
    expect(result.runScore!.collaboration).toBe(17);
    expect(result.runScore!.velocity).toBe(10);
    expect(result.runScore!.runId).toBe(RUN_ID);
    expect(result.runScore!.featureId).toBe(FEATURE_ID);
  });

  it('computes maturationSummary counts correctly', () => {
    seedPacket(testDb, 'pkt-1');
    seedPacket(testDb, 'pkt-2');
    seedPacket(testDb, 'pkt-3');
    seedPacket(testDb, 'pkt-4');

    seedPacketScore(testDb, 'pkt-1', { maturationStage: 'none' });
    seedPacketScore(testDb, 'pkt-2', { maturationStage: 'submitted' });
    seedPacketScore(testDb, 'pkt-3', { maturationStage: 'verified' });
    seedPacketScore(testDb, 'pkt-4', { maturationStage: 'integrated' });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.maturationSummary).toEqual({
      none: 1,
      submitted: 1,
      verified: 1,
      integrated: 1,
    });
  });
});

describe('queryPacketMaturation', () => {
  it('returns packets with correct maturation stages', () => {
    seedPacket(testDb, 'pkt-a', { layer: 'state', role: 'builder', status: 'submitted' });
    seedPacket(testDb, 'pkt-b', { layer: 'ui', role: 'builder', status: 'verified' });

    seedPacketScore(testDb, 'pkt-a', { maturationStage: 'submitted', packetClass: 'state_domain' });
    seedPacketScore(testDb, 'pkt-b', { maturationStage: 'verified', packetClass: 'ui_component' });

    const packets = queryPacketMaturation(testDbPath, FEATURE_ID);
    expect(packets).toHaveLength(2);

    const pktA = packets.find(p => p.packetId === 'pkt-a')!;
    expect(pktA.maturationStage).toBe('submitted');
    expect(pktA.layer).toBe('state');
    expect(pktA.role).toBe('builder');
    expect(pktA.currentStatus).toBe('submitted');
    expect(pktA.packetClass).toBe('state_domain');

    const pktB = packets.find(p => p.packetId === 'pkt-b')!;
    expect(pktB.maturationStage).toBe('verified');
    expect(pktB.packetClass).toBe('ui_component');
  });

  it('returns packets with none stage when no packet_scores exist', () => {
    seedPacket(testDb, 'pkt-x', { layer: 'backend', role: 'builder', status: 'in_progress' });
    // Don't seed packet_scores — but the table exists. The LEFT JOIN yields nulls.
    const packets = queryPacketMaturation(testDbPath, FEATURE_ID);
    expect(packets).toHaveLength(1);
    expect(packets[0]!.maturationStage).toBe('none');
    expect(packets[0]!.submitScore).toBe(0);
  });

  it('returns score details from packet_scores', () => {
    seedPacket(testDb, 'pkt-s');
    seedPacketScore(testDb, 'pkt-s', {
      submitScore: 0.2,
      verifyScore: 0.3,
      integrateScore: 0.5,
      finalScore: 0.85,
      penalties: 0.1,
      durationSeconds: 300,
    });

    const packets = queryPacketMaturation(testDbPath, FEATURE_ID);
    const p = packets[0]!;
    expect(p.submitScore).toBeCloseTo(0.2);
    expect(p.verifyScore).toBeCloseTo(0.3);
    expect(p.integrateScore).toBeCloseTo(0.5);
    expect(p.finalScore).toBeCloseTo(0.85);
    expect(p.penalties).toBeCloseTo(0.1);
    expect(p.durationSeconds).toBe(300);
  });
});

describe('evidence', () => {
  it('includes verification_results evidence', () => {
    seedPacket(testDb, 'pkt-v1');
    seedVerification(testDb, 'pkt-v1', {
      status: 'verified',
      summary: 'All 10 checks pass',
      checks: '{"total": 10, "passed": 10}',
    });

    const evidence = queryEvidence(testDbPath, FEATURE_ID);
    const vrItem = evidence.find(e => e.type === 'verification');
    expect(vrItem).toBeDefined();
    expect(vrItem!.entityId).toBe('vr-pkt-v1');
    expect(vrItem!.packetId).toBe('pkt-v1');
    expect(vrItem!.status).toBe('verified');
    expect(vrItem!.summary).toBe('All 10 checks pass');
    expect(vrItem!.details).toEqual({ checks: { total: 10, passed: 10 } });
  });

  it('includes packet_submissions evidence', () => {
    seedPacket(testDb, 'pkt-s1');
    seedSubmission(testDb, 'pkt-s1', {
      summary: 'Implemented state slice',
      mergeReady: true,
      submittedAt: NOW,
    });

    const evidence = queryEvidence(testDbPath, FEATURE_ID);
    const subItem = evidence.find(e => e.type === 'submission');
    expect(subItem).toBeDefined();
    expect(subItem!.entityId).toBe('sub-pkt-s1');
    expect(subItem!.packetId).toBe('pkt-s1');
    expect(subItem!.status).toBe('merge_ready');
    expect(subItem!.summary).toBe('Implemented state slice');
    expect(subItem!.details).toEqual({ declaredMergeReady: true });
  });

  it('includes integration_runs evidence', () => {
    seedIntegrationRun(testDb, {
      id: 'ir-100',
      status: 'merged',
      summary: 'All packets merged cleanly',
      completedAt: LATER,
    });

    const evidence = queryEvidence(testDbPath, FEATURE_ID);
    const irItem = evidence.find(e => e.type === 'integration');
    expect(irItem).toBeDefined();
    expect(irItem!.entityId).toBe('ir-100');
    expect(irItem!.packetId).toBeNull();
    expect(irItem!.status).toBe('merged');
    expect(irItem!.summary).toBe('All packets merged cleanly');
  });

  it('sorts evidence newest-first', () => {
    seedPacket(testDb, 'pkt-t1');
    seedSubmission(testDb, 'pkt-t1', { submittedAt: EARLIER });
    seedVerification(testDb, 'pkt-t1', { completedAt: LATER });
    seedIntegrationRun(testDb, { completedAt: NOW });

    const evidence = queryEvidence(testDbPath, FEATURE_ID);
    expect(evidence.length).toBeGreaterThanOrEqual(3);

    // Verify descending order
    for (let i = 1; i < evidence.length; i++) {
      expect(evidence[i]!.timestamp <= evidence[i - 1]!.timestamp).toBe(true);
    }
  });

  it('respects limit parameter', () => {
    seedPacket(testDb, 'pkt-l1');
    seedPacket(testDb, 'pkt-l2');
    seedSubmission(testDb, 'pkt-l1', { submittedAt: EARLIER });
    seedSubmission(testDb, 'pkt-l2', { submittedAt: NOW });
    seedVerification(testDb, 'pkt-l1', { completedAt: LATER });

    const evidence = queryEvidence(testDbPath, FEATURE_ID, { limit: 2 });
    expect(evidence).toHaveLength(2);
  });

  it('respects packetId filter', () => {
    seedPacket(testDb, 'pkt-f1');
    seedPacket(testDb, 'pkt-f2');
    seedSubmission(testDb, 'pkt-f1');
    seedSubmission(testDb, 'pkt-f2');

    const evidence = queryEvidence(testDbPath, FEATURE_ID, { packetId: 'pkt-f1' });
    // Should only have evidence for pkt-f1
    for (const item of evidence) {
      if (item.packetId !== null) {
        expect(item.packetId).toBe('pkt-f1');
      }
    }
    expect(evidence.some(e => e.packetId === 'pkt-f1')).toBe(true);
  });
});

describe('stale detection', () => {
  it('stale=true when packet updated after score computed', () => {
    seedPacket(testDb, 'pkt-stale', { updatedAt: LATER });
    seedRunScore(testDb, { computedAt: NOW });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore).not.toBeNull();
    expect(result.runScore!.stale).toBe(true);
  });

  it('stale=false when score is fresh', () => {
    seedPacket(testDb, 'pkt-fresh', { updatedAt: EARLIER });
    seedRunScore(testDb, { computedAt: NOW });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore).not.toBeNull();
    expect(result.runScore!.stale).toBe(false);
  });
});

describe('penalties parsing', () => {
  it('parses penalties_json correctly', () => {
    seedPacket(testDb, 'pkt-pen');
    const penaltiesJson = JSON.stringify([
      { type: 'deduction', category: 'quality', description: 'Missing tests', points: -5 },
      { type: 'deduction', category: 'lawfulness', description: 'File violation', points: -10 },
    ]);
    seedRunScore(testDb, { penalties: penaltiesJson });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore!.penalties).toHaveLength(2);
    expect(result.runScore!.penalties[0]).toEqual({
      type: 'deduction',
      category: 'quality',
      description: 'Missing tests',
      points: -5,
    });
    expect(result.runScore!.penalties[1]).toEqual({
      type: 'deduction',
      category: 'lawfulness',
      description: 'File violation',
      points: -10,
    });
  });

  it('returns empty array for invalid penalties JSON', () => {
    seedPacket(testDb, 'pkt-bad');
    seedRunScore(testDb, { penalties: 'not-json' });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore!.penalties).toEqual([]);
  });

  it('returns empty array for null-like penalties', () => {
    seedPacket(testDb, 'pkt-null');
    seedRunScore(testDb, { penalties: '[]' });

    const result = queryFitnessView(testDbPath, RUN_ID, FEATURE_ID);
    expect(result.runScore!.penalties).toEqual([]);
  });
});
