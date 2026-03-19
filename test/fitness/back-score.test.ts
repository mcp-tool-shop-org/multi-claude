/**
 * Back-score Phase 6 and Phase 6A against the fitness engine.
 *
 * Uses fixture data matching the real Phase 6 run:
 * - Wave 1: SF5-101 (3.1 min), SF5-102 (4.4 min) — healthy packets
 * - Wave 2: SF5-103 (16.4 min), SF5-104 (15.7 min) — oversized UI packets
 * - Verifier: SF5-201 (19/20 pass)
 * - Integrator: SF5-301 (passed)
 * - Stop drill: not proven in Phase 6 (proven in 6A)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreRun } from '../../src/fitness/engine.js';
import { PACKET_CLASS_BUDGETS } from '../../src/fitness/types.js';

let tmpCounter = 0;

function createFixtureDb(): { db: Database.Database; path: string } {
  const { mkdirSync } = require('fs');
  mkdirSync(join(import.meta.dirname, '../../.multi-claude'), { recursive: true });
  const path = join(import.meta.dirname, `../../.multi-claude/test-fixture-${tmpCounter++}-${Date.now()}.db`);

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

  // Ensure hook_decisions table exists
  db.exec(`CREATE TABLE IF NOT EXISTS hook_decisions (
    id TEXT PRIMARY KEY, timestamp TEXT, event TEXT, event_entity_id TEXT,
    feature_id TEXT, conditions_json TEXT, rule_matched TEXT, action TEXT,
    packets_json TEXT DEFAULT '[]', mode TEXT, operator_decision TEXT DEFAULT 'pending',
    executed INTEGER DEFAULT 0, reason TEXT
  )`);

  return { db, path };
}

function seedPhase6Data(db: Database.Database) {
  const now = '2026-03-19T12:00:00Z';

  // Feature
  db.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, status, priority, merge_target, acceptance_criteria, created_by, created_at, updated_at)
    VALUES ('sf5-phase5', 'studioflow', 'Phase 5 Viewport+Selection', 'Viewport and multi-selection', 'complete', 'high', 'main', '[]', 'operator', ?, ?)`).run(now, now);

  // Packets — matching real Phase 6 data
  const packets = [
    { id: 'sf5-101', layer: 'state', role: 'builder', status: 'merged' },
    { id: 'sf5-102', layer: 'state', role: 'builder', status: 'merged' },
    { id: 'sf5-103', layer: 'ui', role: 'builder', status: 'merged' },
    { id: 'sf5-104', layer: 'ui', role: 'builder', status: 'merged' },
    { id: 'sf5-201', layer: 'integration', role: 'verifier', status: 'merged' },
    { id: 'sf5-301', layer: 'integration', role: 'integrator', status: 'merged' },
  ];

  for (const p of packets) {
    const ruleProfile = p.layer === 'integration' ? 'integration' : 'builder';
    db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, status, goal, allowed_files, forbidden_files, verification_profile_id, rule_profile, contract_delta_policy, created_by, created_at, updated_at)
      VALUES (?, 'sf5-phase5', ?, ?, 'impl', ?, 'playbook', ?, 'goal', '[]', '[]', 'profile', ?, 'declare', 'operator', ?, ?)`).run(p.id, `Packet ${p.id}`, p.layer, p.role, p.status, ruleProfile, now, now);
  }

  // Attempts, claims, submissions, verification — with proper FK chains
  for (const p of packets) {
    const attId = `att-${p.id}`;
    const subId = `sub-${p.id}`;

    // Attempt
    db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, started_at, ended_at, end_reason, role, summary)
      VALUES (?, ?, 1, 'auto-builder', ?, ?, 'submitted', ?, 'Done')`).run(attId, p.id, now, now, p.role);

    // Submission
    db.prepare(`INSERT INTO packet_submissions (submission_id, packet_id, attempt_id, submitted_by, submitted_at, artifact_manifest, writeback, declared_merge_ready, builder_summary)
      VALUES (?, ?, ?, 'builder', ?, '{}', '{}', 1, 'Done')`).run(subId, p.id, attId, now);

    // Verification
    db.prepare(`INSERT INTO verification_results (verification_result_id, packet_id, attempt_id, submission_id, verified_by, verifier_role, started_at, completed_at, status, rule_profile, checks, summary)
      VALUES (?, ?, ?, ?, 'verifier', 'verifier-checklist', ?, ?, 'verified', 'builder', '{}', 'Passed')`).run(`vr-${p.id}`, p.id, attId, subId, now, now);
  }

  // Hook decisions — some logged
  db.prepare(`INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id, conditions_json, mode, operator_decision, executed)
    VALUES ('h1', ?, 'packet.ready', 'sf5-101', 'sf5-phase5', '{}', 'autonomous', 'auto', 1)`).run(now);
  db.prepare(`INSERT INTO hook_decisions (id, timestamp, event, event_entity_id, feature_id, conditions_json, mode, operator_decision, executed)
    VALUES ('h2', ?, 'packet.ready', 'sf5-102', 'sf5-phase5', '{}', 'autonomous', 'auto', 1)`).run(now);

  // State transitions — all lawful
  for (const p of packets) {
    db.prepare(`INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
      VALUES (?, 'packet', ?, 'ready', 'merged', 'system', 'auto', 'lawful', ?)`).run(`tr-${p.id}`, p.id, now);
  }
}

describe('Back-score Phase 6', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    const fixture = createFixtureDb();
    db = fixture.db;
    dbPath = fixture.path;
    seedPhase6Data(db);
    db.close();
  });

  it('scores Phase 6 as a real run', () => {
    const score = scoreRun(dbPath, 'phase6-run', 'sf5-phase5');

    console.log('Phase 6 Score:', JSON.stringify(score, null, 2));

    // Quality should be high — all packets merged, all verified
    expect(score.quality).toBeGreaterThan(30);

    // Lawfulness should be reasonable
    expect(score.lawfulness).toBeGreaterThan(15);

    // Overall should be at least B grade
    expect(score.overall).toBeGreaterThan(60);
    expect(['A', 'B']).toContain(score.grade);

    // All packets should have maturation stage 'integrated'
    for (const p of score.packets) {
      expect(p.maturationStage).toBe('integrated');
      expect(p.maturedPoints).toBe(100); // full maturation
    }

    // No hard penalties expected
    const hardPenalties = score.penalties.filter(p => p.type === 'hard');
    expect(hardPenalties.length).toBe(0);

    require('fs').unlinkSync(dbPath);
  });

  it('anti-rush: velocity is smallest bucket contribution', () => {
    const score = scoreRun(dbPath, 'antirush-run', 'sf5-phase5');

    // Velocity should be capped at 15 max
    expect(score.velocity).toBeLessThanOrEqual(15);

    // Quality should always be the largest contributor
    expect(score.quality).toBeGreaterThan(score.velocity);

    require('fs').unlinkSync(dbPath);
  });

  it('maturation: submitted packets earn less than integrated packets', () => {
    const fixture2 = createFixtureDb();
    const db2 = fixture2.db;

    const now = '2026-03-19T12:00:00Z';
    db2.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, status, priority, merge_target, acceptance_criteria, created_by, created_at, updated_at)
      VALUES ('partial-feature', 'studioflow', 'Partial', 'test', 'in_progress', 'normal', 'main', '[]', 'op', ?, ?)`).run(now, now);

    db2.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, status, goal, allowed_files, forbidden_files, verification_profile_id, rule_profile, contract_delta_policy, created_by, created_at, updated_at)
      VALUES ('merged-pkt', 'partial-feature', 'Merged', 'state', 'impl', 'builder', 'pb', 'merged', 'g', '[]', '[]', 'p', 'builder', 'declare', 'op', ?, ?)`).run(now, now);
    db2.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, status, goal, allowed_files, forbidden_files, verification_profile_id, rule_profile, contract_delta_policy, created_by, created_at, updated_at)
      VALUES ('submitted-pkt', 'partial-feature', 'Submitted', 'state', 'impl', 'builder', 'pb', 'submitted', 'g', '[]', '[]', 'p', 'builder', 'declare', 'op', ?, ?)`).run(now, now);

    db2.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, started_at, ended_at, end_reason, role, summary) VALUES ('a1', 'merged-pkt', 1, 'b', ?, ?, 'submitted', 'builder', 'ok')`).run(now, now);
    db2.prepare(`INSERT INTO packet_submissions (submission_id, packet_id, attempt_id, submitted_by, submitted_at, artifact_manifest, writeback, declared_merge_ready, builder_summary) VALUES ('s1', 'merged-pkt', 'a1', 'b', ?, '{}', '{}', 1, 'ok')`).run(now);
    db2.prepare(`INSERT INTO verification_results (verification_result_id, packet_id, attempt_id, submission_id, verified_by, verifier_role, started_at, completed_at, status, rule_profile, checks, summary)
      VALUES ('vr-m', 'merged-pkt', 'a1', 's1', 'v', 'verifier-checklist', ?, ?, 'verified', 'builder', '{}', 'ok')`).run(now, now);

    db2.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, started_at, role, summary) VALUES ('a2', 'submitted-pkt', 1, 'b', ?, 'builder', 'wip')`).run(now);
    db2.prepare(`INSERT INTO packet_submissions (submission_id, packet_id, attempt_id, submitted_by, submitted_at, artifact_manifest, writeback, declared_merge_ready, builder_summary) VALUES ('s2', 'submitted-pkt', 'a2', 'b', ?, '{}', '{}', 1, 'ok')`).run(now);

    db2.close();
    const tmpPath = fixture2.path;

    const score = scoreRun(tmpPath, 'maturation-run', 'partial-feature');

    const mergedPkt = score.packets.find(p => p.packetId === 'merged-pkt');
    const submittedPkt = score.packets.find(p => p.packetId === 'submitted-pkt');

    expect(mergedPkt).toBeDefined();
    expect(submittedPkt).toBeDefined();

    // Merged packet should have full maturation (100 points)
    expect(mergedPkt!.maturedPoints).toBe(100);
    expect(mergedPkt!.maturationStage).toBe('integrated');

    // Submitted packet should have only 20% credit
    expect(submittedPkt!.maturedPoints).toBe(20);
    expect(submittedPkt!.maturationStage).toBe('submitted');

    // Anti-rush: submitted packet earns dramatically less
    expect(submittedPkt!.maturedPoints).toBeLessThan(mergedPkt!.maturedPoints * 0.5);

    require('fs').unlinkSync(tmpPath);
    require('fs').unlinkSync(dbPath);
  });
});
