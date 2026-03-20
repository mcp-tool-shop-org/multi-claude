/**
 * Handoff Spine — Bridge tests.
 *
 * Tests the execution DB → DeriveHandoffInput bridge
 * and the full spine integration: bridge → create → render → use.
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { renderHandoff } from '../../src/handoff/api/render-handoff.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture: seed execution DB with a feature + packet ──────────

function seedExecutionDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);

  // Insert verification profile
  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-test', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-19T00:00:00Z')
  `).run();

  // Insert feature
  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-001', 'test-repo', 'Add user auth', 'Implement user authentication flow', 'in_progress', 'main', '["Login works", "Logout works"]', 'test-user')
  `).run();

  // Insert packets
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, acceptance_criteria, context, allowed_files, forbidden_files,
      forbidden_rationale, reference_files, module_family,
      protected_file_access, seam_file_access, verification_profile_id,
      contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-001', 'feat-001', 'Backend auth', 'backend', 'backend-auth', 'builder', 'pb-builder',
      'in_progress', 'Implement JWT auth middleware', '["Token validation", "Refresh tokens"]',
      'Use existing user table', '["src/auth/**", "src/middleware/**"]',
      '["src/db/schema.sql", "src/config/**"]',
      '{"src/db/schema.sql": "Owned by contract layer", "src/config/**": "Shared configuration"}',
      '["src/auth/existing-auth.ts"]', 'auth',
      'none', 'declare_only', 'vp-test',
      'declare', 1, 'test-user'
    )
  `).run();

  // Insert a second packet for dependency testing
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, verification_profile_id,
      contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-002', 'feat-001', 'Auth contract', 'contract', 'auth-contract', 'architect', 'pb-contract',
      'merged', 'Define auth contract types', '["src/types/auth.ts"]', 'vp-test',
      'author', 0, 'test-user'
    )
  `).run();

  // Add dependency: pkt-001 depends on pkt-002
  db.prepare(`
    INSERT INTO packet_dependencies (packet_id, depends_on_packet_id, dependency_type)
    VALUES ('pkt-001', 'pkt-002', 'hard')
  `).run();

  db.close();
  return dbPath;
}

function seedWithFailedAttempts(dbPath: string) {
  const db = openDb(dbPath);

  // Add a failed attempt
  db.prepare(`
    INSERT INTO packet_attempts (attempt_id, packet_id, attempt_number, started_by, role, end_reason, ended_at)
    VALUES ('att-001', 'pkt-001', 1, 'auto-builder', 'builder', 'failed', '2026-03-19T01:00:00Z')
  `).run();

  db.close();
}

// ── Bridge tests ─────────────────────────────────────────────────────

describe('bridgeExecutionPacket', () => {
  it('bridges a valid execution packet to DeriveHandoffInput', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-test-001' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.packetTitle).toBe('Backend auth');
      expect(result.input.projectId).toBe('feat-001');
      expect(result.input.runId).toBe('run-test-001');
      expect(result.input.lane).toBe('worker');
      expect(result.input.sourcePacketId).toBe('pkt-001');
    } finally {
      db.close();
    }
  });

  it('maps goal to authoritative instructions', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-001' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const auth = result.input.instructions.authoritative;
      expect(auth[0]).toBe('Implement JWT auth middleware');
      expect(auth.some(i => i.includes('Token validation'))).toBe(true);
      expect(auth.some(i => i.includes('Use existing user table'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('maps forbidden files to prohibitions', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-001' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const prohibitions = result.input.instructions.prohibitions;
      expect(prohibitions.length).toBeGreaterThan(0);
      expect(prohibitions.some(p => p.includes('src/db/schema.sql'))).toBe(true);
      expect(prohibitions.some(p => p.includes('Owned by contract layer'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('maps allowed files and access rules to constraints', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-001' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const constraints = result.input.instructions.constraints;
      expect(constraints.some(c => c.includes('src/auth/**'))).toBe(true);
      expect(constraints.some(c => c.includes('declare_only'))).toBe(true);
      expect(constraints.some(c => c.includes('Knowledge writeback required'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns error for missing packet', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'nonexistent', runId: 'run-001' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('not found');
    } finally {
      db.close();
    }
  });

  it('includes failed attempt context as open loop', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);
    seedWithFailedAttempts(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-001' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should have custom open loops from failed attempts
      expect(result.input.openLoopSource.customLoops).toBeDefined();
      expect(result.input.openLoopSource.customLoops!.length).toBe(1);
      expect(result.input.openLoopSource.customLoops![0]!.summary).toContain('previous attempt');
    } finally {
      db.close();
    }
  });

  it('passes repoRoot and custom lane through', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const result = bridgeExecutionPacket({
        db, packetId: 'pkt-001', runId: 'run-001',
        repoRoot: '/test/repo', lane: 'recovery',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.input.repoRoot).toBe('/test/repo');
      expect(result.input.lane).toBe('recovery');
    } finally {
      db.close();
    }
  });
});

// ── Full spine integration: bridge → create → render → use ──────────

describe('spine integration (bridge → create → render → use)', () => {
  it('produces working context from execution DB packet', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      // 1. Bridge
      const bridgeResult = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-int-001' });
      expect(bridgeResult.ok).toBe(true);
      if (!bridgeResult.ok) return;

      // 2. Set up handoff store on same DB
      migrateHandoffSchema(db);
      const store = new HandoffStore(db);

      // 3. Create handoff
      const createResult = createHandoff(store, bridgeResult.input);
      expect(createResult.ok).toBe(true);
      expect(createResult.packet.handoffId).toBeTruthy();
      expect(createResult.packet.contentHash).toBeTruthy();

      // 4. Render via spine
      const renderResult = renderHandoff(store, {
        handoffId: createResult.packet.handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      expect(renderResult.ok).toBe(true);
      if (!renderResult.ok) return;

      // 5. Verify working context contains packet truth
      const ctx = renderResult.context;
      expect(ctx.system).toContain('JWT auth middleware');
      expect(ctx.metadata.handoffId).toBe(createResult.packet.handoffId);
      expect(ctx.metadata.packetVersion).toBe(1);

      // 6. Verify render event was recorded
      expect(renderResult.renderEventId).toBeDefined();
      const events = store.getRenderEvents(createResult.packet.handoffId);
      expect(events.length).toBe(1);
      expect(events[0]!.roleRenderer).toBe('worker');
      expect(events[0]!.modelAdapter).toBe('claude');
    } finally {
      db.close();
    }
  });

  it('records handoff_use for audit trail', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const bridgeResult = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-use-001' });
      if (!bridgeResult.ok) return;

      migrateHandoffSchema(db);
      const store = new HandoffStore(db);

      const createResult = createHandoff(store, bridgeResult.input);
      const renderResult = renderHandoff(store, {
        handoffId: createResult.packet.handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      if (!renderResult.ok) return;

      // Record use
      store.insertUse({
        handoffId: createResult.packet.handoffId,
        packetVersion: createResult.packet.packetVersion,
        renderEventId: renderResult.renderEventId,
        consumerRunId: 'run-use-001',
        consumerRole: 'builder',
        usedAt: '2026-03-19T02:00:00Z',
      });

      // Verify use was recorded
      const uses = store.getUses(createResult.packet.handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.consumerRunId).toBe('run-use-001');
      expect(uses[0]!.renderEventId).toBe(renderResult.renderEventId);
    } finally {
      db.close();
    }
  });

  it('renders different content for reviewer vs worker role', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const bridgeResult = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-roles-001' });
      if (!bridgeResult.ok) return;

      migrateHandoffSchema(db);
      const store = new HandoffStore(db);
      const createResult = createHandoff(store, bridgeResult.input);

      const workerRender = renderHandoff(store, {
        handoffId: createResult.packet.handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });

      const reviewerRender = renderHandoff(store, {
        handoffId: createResult.packet.handoffId as HandoffId,
        role: 'reviewer',
        model: 'claude',
      });

      expect(workerRender.ok).toBe(true);
      expect(reviewerRender.ok).toBe(true);
      if (!workerRender.ok || !reviewerRender.ok) return;

      // Different renderers produce different output
      expect(workerRender.rendered.role).toBe('worker');
      expect(reviewerRender.rendered.role).toBe('reviewer');

      // Both contain the goal truth
      const workerFull = workerRender.context.system + (workerRender.context.developer ?? '');
      const reviewerFull = reviewerRender.context.system + (reviewerRender.context.developer ?? '');
      expect(workerFull).toContain('JWT auth middleware');
      expect(reviewerFull).toContain('JWT auth middleware');

      // Worker has prohibitions, reviewer has review framing
      expect(workerFull).toContain('DO NOT');
      expect(reviewerFull).toContain('Review');
    } finally {
      db.close();
    }
  });

  it('full traceability chain: bridge → create → render → use → verify', () => {
    const dbPath = tempDbPath();
    seedExecutionDb(dbPath);

    const db = openDb(dbPath);
    try {
      const bridgeResult = bridgeExecutionPacket({ db, packetId: 'pkt-001', runId: 'run-trace-001' });
      if (!bridgeResult.ok) return;

      migrateHandoffSchema(db);
      const store = new HandoffStore(db);

      // Create
      const createResult = createHandoff(store, bridgeResult.input);
      const handoffId = createResult.packet.handoffId;

      // Render
      const renderResult = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      if (!renderResult.ok) return;

      // Use
      store.insertUse({
        handoffId,
        packetVersion: 1,
        renderEventId: renderResult.renderEventId,
        consumerRunId: 'run-trace-001',
        consumerRole: 'builder',
        usedAt: '2026-03-19T03:00:00Z',
      });

      // Verify full chain
      const packet = store.reconstructPacket(handoffId);
      expect(packet).not.toBeNull();
      expect(packet!.contentHash).toBeTruthy();

      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(1);
      expect(events[0]!.outputHash).toBeTruthy();

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.renderEventId).toBe(events[0]!.id);

      // The chain is complete: packetId → handoffId → renderEventId → useRecord
      // All linked by exact IDs, no fuzzy lookup
    } finally {
      db.close();
    }
  });
});
