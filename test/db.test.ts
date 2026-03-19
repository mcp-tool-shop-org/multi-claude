import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { openDb, migrateDb, healthCheck, setSchemaVersion, getSchemaVersion } from '../src/db/connection.js';
import type Database from 'better-sqlite3';

function tempDbPath(): string {
  const dir = join(tmpdir(), 'multi-claude-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return join(dir, 'test.db');
}

describe('Database schema', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = tempDbPath();
    db = openDb(dbPath);
    migrateDb(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    // Clean up WAL/SHM files
    for (const ext of ['-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('creates all 17 tables', () => {
    const health = healthCheck(db);
    expect(health.tables).toBe(17);
  });

  it('enables WAL mode', () => {
    const health = healthCheck(db);
    expect(health.walMode).toBe(true);
  });

  it('enables foreign keys', () => {
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('sets schema version', () => {
    setSchemaVersion(db, 1);
    expect(getSchemaVersion(db)).toBe(1);
  });

  it('enforces feature status check constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
        VALUES ('test', 'org/repo', 'Test', 'obj', 'invalid_status', 'main', '[]', 'human')
      `).run();
    }).toThrow();
  });

  it('enforces packet status check constraint', () => {
    // First create a valid feature
    db.prepare(`
      INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
      VALUES ('test-feat', 'org/repo', 'Test', 'obj', 'approved', 'main', '[]', 'human')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, status, goal, allowed_files, verification_profile_id, rule_profile, contract_delta_policy, created_by)
        VALUES ('test--backend-x', 'test-feat', 'T', 'backend', 'x', 'builder', 'bp', 'bogus_state', 'g', '[]', 'vp', 'builder', 'declare', 'coord')
      `).run();
    }).toThrow();
  });

  it('enforces unique active claim per packet', () => {
    // Setup: feature → packet → attempt → first claim
    db.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, merge_target, acceptance_criteria, created_by) VALUES ('f1', 'org/r', 'T', 'O', 'main', '[]', 'h')`).run();
    db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, goal, allowed_files, verification_profile_id, created_by) VALUES ('f1--backend-a', 'f1', 'T', 'backend', 'a', 'builder', 'bp', 'g', '[]', 'vp', 'c')`).run();
    db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role) VALUES ('att1', 'f1--backend-a', 1, 'w1', 'builder')`).run();
    db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role) VALUES ('att2', 'f1--backend-a', 2, 'w2', 'builder')`).run();
    db.prepare(`INSERT INTO claims (claim_id, packet_id, attempt_id, claimed_by, lease_expires_at, is_active) VALUES ('c1', 'f1--backend-a', 'att1', 'w1', '2099-01-01T00:00:00Z', 1)`).run();

    // Second active claim must fail
    expect(() => {
      db.prepare(`INSERT INTO claims (claim_id, packet_id, attempt_id, claimed_by, lease_expires_at, is_active) VALUES ('c2', 'f1--backend-a', 'att2', 'w2', '2099-01-01T00:00:00Z', 1)`).run();
    }).toThrow();

    // But releasing the first and adding a new one works
    db.prepare(`UPDATE claims SET is_active = 0 WHERE claim_id = 'c1'`).run();
    expect(() => {
      db.prepare(`INSERT INTO claims (claim_id, packet_id, attempt_id, claimed_by, lease_expires_at, is_active) VALUES ('c2', 'f1--backend-a', 'att2', 'w2', '2099-01-01T00:00:00Z', 1)`).run();
    }).not.toThrow();
  });

  it('enforces unique attempt number per packet', () => {
    db.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, merge_target, acceptance_criteria, created_by) VALUES ('f1', 'org/r', 'T', 'O', 'main', '[]', 'h')`).run();
    db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, goal, allowed_files, verification_profile_id, created_by) VALUES ('f1--backend-a', 'f1', 'T', 'backend', 'a', 'builder', 'bp', 'g', '[]', 'vp', 'c')`).run();
    db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role) VALUES ('att1', 'f1--backend-a', 1, 'w1', 'builder')`).run();

    expect(() => {
      db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role) VALUES ('att2', 'f1--backend-a', 1, 'w2', 'builder')`).run();
    }).toThrow();
  });

  it('prevents self-dependencies', () => {
    db.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, merge_target, acceptance_criteria, created_by) VALUES ('f1', 'org/r', 'T', 'O', 'main', '[]', 'h')`).run();
    db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, goal, allowed_files, verification_profile_id, created_by) VALUES ('f1--backend-a', 'f1', 'T', 'backend', 'a', 'builder', 'bp', 'g', '[]', 'vp', 'c')`).run();

    expect(() => {
      db.prepare(`INSERT INTO packet_dependencies (packet_id, depends_on_packet_id, dependency_type) VALUES ('f1--backend-a', 'f1--backend-a', 'hard')`).run();
    }).toThrow();
  });

  it('enforces foreign key from packets to features', () => {
    expect(() => {
      db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, goal, allowed_files, verification_profile_id, created_by) VALUES ('p1--backend-x', 'nonexistent', 'T', 'backend', 'x', 'builder', 'bp', 'g', '[]', 'vp', 'c')`).run();
    }).toThrow();
  });

  it('enforces one submission per attempt', () => {
    db.prepare(`INSERT INTO features (feature_id, repo_slug, title, objective, merge_target, acceptance_criteria, created_by) VALUES ('f1', 'org/r', 'T', 'O', 'main', '[]', 'h')`).run();
    db.prepare(`INSERT INTO packets (packet_id, feature_id, title, layer, descriptor, role, playbook_id, goal, allowed_files, verification_profile_id, created_by) VALUES ('f1--backend-a', 'f1', 'T', 'backend', 'a', 'builder', 'bp', 'g', '[]', 'vp', 'c')`).run();
    db.prepare(`INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role) VALUES ('att1', 'f1--backend-a', 1, 'w1', 'builder')`).run();
    db.prepare(`INSERT INTO packet_submissions (submission_id, packet_id, attempt_id, submitted_by, artifact_manifest, writeback, declared_merge_ready, builder_summary) VALUES ('sub1', 'f1--backend-a', 'att1', 'w1', '{}', '{}', 1, 'done')`).run();

    expect(() => {
      db.prepare(`INSERT INTO packet_submissions (submission_id, packet_id, attempt_id, submitted_by, artifact_manifest, writeback, declared_merge_ready, builder_summary) VALUES ('sub2', 'f1--backend-a', 'att1', 'w1', '{}', '{}', 1, 'done again')`).run();
    }).toThrow();
  });
});
