/**
 * Handoff Spine — Recovery resolution tests.
 *
 * Tests the trust model under interruption, invalidation, and partial progress:
 *   - Latest version valid → resolved directly
 *   - Latest version invalidated → previous valid used (rollback)
 *   - All versions invalidated → explicit error with reason
 *   - Recovery render uses recovery-renderer (not worker-renderer)
 *   - Fallback evidence is structured and attributable
 *   - Recovery audit trail includes handoffId + renderEventId
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { renderHandoff } from '../../src/handoff/api/render-handoff.js';
import { resolveLastValidHandoff, resolveLastValidHandoffForPacket } from '../../src/handoff/api/resolve-handoff.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { createFallbackEvidence } from '../../src/handoff/bridge/fallback-evidence.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';
import { nowISO } from '../../src/lib/ids.js';

// ── Test fixture: seed execution DB + spine ──────────────────────────

function seedFullDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  // Verification profile
  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-test', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-19T00:00:00Z')
  `).run();

  // Feature
  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-rec', 'test-repo', 'Recovery test feature', 'Test recovery flow', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  // Packet
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-rec-001', 'feat-rec', 'Recovery test packet', 'backend', 'rec-test', 'builder', 'pb-builder',
      'failed', 'Build the recovery feature', '["src/recovery/**"]', '[]',
      'vp-test', 'declare', 0, 'test'
    )
  `).run();

  db.close();
  return dbPath;
}

function createHandoffForPacket(dbPath: string, packetId: string, runId: string): string {
  const db = openDb(dbPath);
  try {
    const store = new HandoffStore(db);
    const bridge = bridgeExecutionPacket({ db, packetId, runId });
    if (!bridge.ok) throw new Error(bridge.error);
    const result = createHandoff(store, bridge.input);
    return result.packet.handoffId;
  } finally {
    db.close();
  }
}

// ── Resolver tests ───────────────────────────────────────────────────

describe('resolveLastValidHandoff', () => {
  it('resolves latest version when valid', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const result = resolveLastValidHandoff(store, handoffId as HandoffId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolvedVersion).toBe(1);
      expect(result.isRollback).toBe(false);
      expect(result.skippedVersions).toBe(0);
      expect(result.packet.handoffId).toBe(handoffId);
    } finally {
      db.close();
    }
  });

  it('skips invalidated latest version and resolves previous valid', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create version 2 by inserting a new version
      store.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Updated version',
        instructionsJson: JSON.stringify({ authoritative: ['v2 instructions'], constraints: [], prohibitions: [] }),
        decisionsJson: '[]',
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: '[]',
        scopeJson: JSON.stringify({ projectId: 'feat-rec', runId: 'run-001' }),
        contentHash: 'hash-v2',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      // Invalidate version 2
      invalidatePacketVersion(store, { handoffId, packetVersion: 2, reasonCode: 'manual', reason: 'Bad instructions in v2' });

      // Resolve — should get version 1
      const result = resolveLastValidHandoff(store, handoffId as HandoffId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.resolvedVersion).toBe(1);
      expect(result.isRollback).toBe(true);
      expect(result.skippedVersions).toBe(1);
    } finally {
      db.close();
    }
  });

  it('returns error when all versions are invalidated', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Invalidate the only version
      invalidatePacketVersion(store, { handoffId, packetVersion: 1, reasonCode: 'manual', reason: 'All bad' });

      const result = resolveLastValidHandoff(store, handoffId as HandoffId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('all_invalidated');
      expect(result.error).toContain('invalidated');
    } finally {
      db.close();
    }
  });

  it('returns error for nonexistent handoff', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const result = resolveLastValidHandoff(store, 'ho-nonexistent' as HandoffId);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_found');
    } finally {
      db.close();
    }
  });
});

// ── Resolver by source packet ID ────────────────────────────────────

describe('resolveLastValidHandoffForPacket', () => {
  it('finds handoff by source packet ID and resolves', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const result = resolveLastValidHandoffForPacket(store, 'pkt-rec-001', 'feat-rec');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.packet.handoffId).toBe(handoffId);
      expect(result.resolvedVersion).toBe(1);
    } finally {
      db.close();
    }
  });

  it('returns not_found for packet with no prior handoff', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const result = resolveLastValidHandoffForPacket(store, 'pkt-nonexistent', 'feat-rec');

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_found');
    } finally {
      db.close();
    }
  });
});

// ── Recovery render uses recovery-renderer ──────────────────────────

describe('recovery rendering', () => {
  it('renders with recovery-renderer producing recovery-specific content', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const workerRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });

      const recoveryRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'recovery',
        model: 'claude',
      });

      expect(workerRender.ok).toBe(true);
      expect(recoveryRender.ok).toBe(true);
      if (!workerRender.ok || !recoveryRender.ok) return;

      // Recovery renderer produces recovery-specific framing
      expect(recoveryRender.rendered.role).toBe('recovery');
      expect(workerRender.rendered.role).toBe('worker');

      // Recovery context should contain "Do NOT invent state"
      const recoveryFull = recoveryRender.context.system + (recoveryRender.context.developer ?? '');
      expect(recoveryFull).toContain('Do NOT invent state');
      expect(recoveryFull).toContain('Recovery');

      // Both contain the packet truth
      const workerFull = workerRender.context.system + (workerRender.context.developer ?? '');
      expect(workerFull).toContain('Build the recovery feature');
      expect(recoveryFull).toContain('Build the recovery feature');
    } finally {
      db.close();
    }
  });

  it('records render event and use for recovery launches', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const renderResult = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'recovery',
        model: 'claude',
      });
      if (!renderResult.ok) return;

      // Record use (as auto.ts would)
      store.insertUse({
        handoffId,
        packetVersion: 1,
        renderEventId: renderResult.renderEventId,
        consumerRunId: 'run-recovery-001',
        consumerRole: 'recovery:builder',
        usedAt: nowISO(),
      });

      // Verify audit trail
      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(1);
      expect(events[0]!.roleRenderer).toBe('recovery');

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.consumerRole).toBe('recovery:builder');
      expect(uses[0]!.renderEventId).toBe(renderResult.renderEventId);
    } finally {
      db.close();
    }
  });
});

// ── Fallback evidence ────────────────────────────────────────────────

describe('fallback evidence', () => {
  it('creates structured evidence for bridge failure', () => {
    const evidence = createFallbackEvidence(
      'pkt-001', 'run-001', 'bridge_failed',
      'Packet not found in execution DB', 'legacy_render',
    );

    expect(evidence.packetId).toBe('pkt-001');
    expect(evidence.runId).toBe('run-001');
    expect(evidence.reason).toBe('bridge_failed');
    expect(evidence.fallbackPath).toBe('legacy_render');
    expect(evidence.equivalence).toBe('degraded');
    expect(evidence.timestamp).toBeTruthy();
  });

  it('creates structured evidence for all-invalidated recovery', () => {
    const evidence = createFallbackEvidence(
      'pkt-001', 'run-001', 'all_versions_invalidated',
      'All 3 versions of handoff ho-123 are invalidated',
      'fresh_spine_render',
      { attemptedHandoffId: 'ho-123', attemptedVersion: 3 },
    );

    expect(evidence.reason).toBe('all_versions_invalidated');
    expect(evidence.fallbackPath).toBe('fresh_spine_render');
    expect(evidence.equivalence).toBe('equivalent');
    expect(evidence.attemptedHandoffId).toBe('ho-123');
    expect(evidence.attemptedVersion).toBe(3);
  });

  it('marks legacy fallback as degraded, spine fallback as equivalent', () => {
    const legacy = createFallbackEvidence(
      'pkt-001', 'run-001', 'bridge_failed', 'fail', 'legacy_render',
    );
    const spine = createFallbackEvidence(
      'pkt-001', 'run-001', 'spine_render_failed', 'fail', 'fresh_spine_render',
    );

    expect(legacy.equivalence).toBe('degraded');
    expect(spine.equivalence).toBe('equivalent');
  });
});

// ── End-to-end recovery flow ────────────────────────────────────────

describe('end-to-end recovery flow', () => {
  it('first launch creates handoff, retry resolves and renders with recovery', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Step 1: First launch — bridge + create + worker render
      const bridge1 = bridgeExecutionPacket({ db, packetId: 'pkt-rec-001', runId: 'run-first' });
      expect(bridge1.ok).toBe(true);
      if (!bridge1.ok) return;

      const create1 = createHandoff(store, bridge1.input);
      const handoffId = create1.packet.handoffId;

      const render1 = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      expect(render1.ok).toBe(true);
      if (!render1.ok) return;

      store.insertUse({
        handoffId,
        packetVersion: 1,
        renderEventId: render1.renderEventId,
        consumerRunId: 'run-first',
        consumerRole: 'builder',
        usedAt: nowISO(),
      });

      // Step 2: Packet fails. Retry — resolve last valid + recovery render.
      const resolved = resolveLastValidHandoffForPacket(store, 'pkt-rec-001', 'feat-rec');
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.packet.handoffId).toBe(handoffId);

      const render2 = renderHandoff(store, {
        handoffId: resolved.packet.handoffId as HandoffId,
        version: resolved.resolvedVersion,
        role: 'recovery',
        model: 'claude',
      });
      expect(render2.ok).toBe(true);
      if (!render2.ok) return;

      store.insertUse({
        handoffId: resolved.packet.handoffId,
        packetVersion: resolved.resolvedVersion,
        renderEventId: render2.renderEventId,
        consumerRunId: 'run-retry',
        consumerRole: 'recovery:builder',
        usedAt: nowISO(),
      });

      // Step 3: Verify full audit trail
      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(2);
      expect(events[0]!.roleRenderer).toBe('worker');
      expect(events[1]!.roleRenderer).toBe('recovery');

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(2);
      expect(uses[0]!.consumerRole).toBe('builder');
      expect(uses[1]!.consumerRole).toBe('recovery:builder');

      // Recovery render has different content framing
      const recoveryFull = render2.context.system + (render2.context.developer ?? '');
      expect(recoveryFull).toContain('Recovery');
      expect(recoveryFull).toContain('Do NOT invent state');
    } finally {
      db.close();
    }
  });
});
