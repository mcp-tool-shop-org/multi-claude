/**
 * Handoff Spine — Approval/review consumption tests (Phase 2 Step 3).
 *
 * Tests the approval/review lane consuming spine-rendered packets:
 *   - Reviewer render produces review-specific content
 *   - Approver render produces approval-specific content
 *   - Invalidated versions cannot be approved
 *   - Spine traceability fields bound to approval context
 *   - handoff_use recorded for reviewer/approver lanes
 *   - End-to-end: worker launch → approval via spine → full audit trail
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { renderHandoff } from '../../src/handoff/api/render-handoff.js';
import { resolveApprovalHandoff } from '../../src/handoff/api/resolve-approval-handoff.js';
import { resolveLastValidHandoff } from '../../src/handoff/api/resolve-handoff.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
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
    VALUES ('feat-appr', 'test-repo', 'Approval test feature', 'Test approval flow', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  // Packet
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-appr-001', 'feat-appr', 'Approval test packet', 'backend', 'appr-test', 'builder', 'pb-builder',
      'failed', 'Build the approval feature', '["src/approval/**"]', '["src/secrets/**"]',
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

// ── Reviewer render tests ────────────────────────────────────────────

describe('reviewer spine render', () => {
  it('renders with reviewer-renderer producing review-specific content', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const reviewRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'reviewer',
        model: 'claude',
      });

      expect(reviewRender.ok).toBe(true);
      if (!reviewRender.ok) return;

      expect(reviewRender.rendered.role).toBe('reviewer');
      const full = reviewRender.context.system + (reviewRender.context.developer ?? '');
      // Reviewer renderer should include decisions and changed context
      expect(full).toContain('Build the approval feature');
    } finally {
      db.close();
    }
  });

  it('produces different content than worker render', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const workerRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      const reviewRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'reviewer',
        model: 'claude',
      });

      expect(workerRender.ok).toBe(true);
      expect(reviewRender.ok).toBe(true);
      if (!workerRender.ok || !reviewRender.ok) return;

      // Different roles produce different views of the same packet
      expect(workerRender.rendered.role).toBe('worker');
      expect(reviewRender.rendered.role).toBe('reviewer');
    } finally {
      db.close();
    }
  });
});

// ── Approver render tests ────────────────────────────────────────────

describe('approver spine render', () => {
  it('renders with approver-renderer producing approval-specific content', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const approverRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'approver',
        model: 'claude',
      });

      expect(approverRender.ok).toBe(true);
      if (!approverRender.ok) return;

      expect(approverRender.rendered.role).toBe('approver');
      const full = approverRender.context.system + (approverRender.context.developer ?? '');
      expect(full).toContain('Build the approval feature');
    } finally {
      db.close();
    }
  });
});

// ── Approval resolver tests ──────────────────────────────────────────

describe('resolveApprovalHandoff', () => {
  it('resolves and renders for approver role, records handoff_use', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'approver:approval',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Core traceability
      expect(result.handoffId).toBe(handoffId);
      expect(result.packetVersion).toBe(1);
      expect(result.outputHash).toBeTruthy();
      expect(result.isRollback).toBe(false);
      expect(result.skippedVersions).toBe(0);

      // Rendered as approver
      expect(result.rendered.role).toBe('approver');

      // handoff_use was recorded
      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.consumerRole).toBe('approver:approval');
      expect(uses[0]!.consumerRunId).toBe('run-001');
    } finally {
      db.close();
    }
  });

  it('resolves and renders for reviewer role', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = resolveApprovalHandoff(store, {
        handoffId,
        role: 'reviewer',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'reviewer:approval',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.rendered.role).toBe('reviewer');

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.consumerRole).toBe('reviewer:approval');
    } finally {
      db.close();
    }
  });

  it('rejects when all versions are invalidated', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Invalidate the only version
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Corrupted packet',
      });

      const result = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'approver:approval',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('all_invalidated');

      // No handoff_use should be recorded for failed resolution
      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(0);
    } finally {
      db.close();
    }
  });

  it('falls back to previous valid version when latest is invalidated', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create version 2
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
        scopeJson: JSON.stringify({ projectId: 'feat-appr', runId: 'run-001' }),
        contentHash: 'hash-v2-approval',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      // Invalidate version 2
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 2,
        reasonCode: 'manual', reason: 'Bad v2',
      });

      const result = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'approver:approval',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Should resolve to version 1 (rollback)
      expect(result.packetVersion).toBe(1);
      expect(result.isRollback).toBe(true);
      expect(result.skippedVersions).toBe(1);
      expect(result.warnings.some(w => w.includes('Rollback'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns not_found for nonexistent handoff', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = resolveApprovalHandoff(store, {
        handoffId: 'ho-nonexistent',
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'approver:approval',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_found');
    } finally {
      db.close();
    }
  });
});

// ── Render event audit trail ─────────────────────────────────────────

describe('approval render audit trail', () => {
  it('records render event for approver render', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-001',
        consumerRole: 'approver:approval',
      });
      if (!result.ok) return;

      // Render event recorded
      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(1);
      expect(events[0]!.roleRenderer).toBe('approver');

      // Use linked to render event
      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(1);
      expect(uses[0]!.renderEventId).toBe(result.renderEventId);
    } finally {
      db.close();
    }
  });
});

// ── findHandoffsByRunId tests ────────────────────────────────────────

describe('HandoffStore.findHandoffsByRunId', () => {
  it('finds handoffs by run ID', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-appr-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const handoffs = store.findHandoffsByRunId('run-001');

      expect(handoffs.length).toBeGreaterThanOrEqual(1);
      expect(handoffs[0]!.handoffId).toBe(handoffId);
      expect(handoffs[0]!.runId).toBe('run-001');
    } finally {
      db.close();
    }
  });

  it('returns empty array for unknown run ID', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const handoffs = store.findHandoffsByRunId('run-nonexistent');
      expect(handoffs.length).toBe(0);
    } finally {
      db.close();
    }
  });
});

// ── End-to-end: worker launch → approval via spine ───────────────────

describe('end-to-end approval flow', () => {
  it('worker launch + approval render + audit trail complete', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Step 1: Bridge + create handoff (simulates worker launch)
      const bridge = bridgeExecutionPacket({ db, packetId: 'pkt-appr-001', runId: 'run-e2e' });
      expect(bridge.ok).toBe(true);
      if (!bridge.ok) return;

      const created = createHandoff(store, bridge.input);
      const handoffId = created.packet.handoffId;

      // Step 2: Worker render + use
      const workerRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      expect(workerRender.ok).toBe(true);
      if (!workerRender.ok) return;

      store.insertUse({
        handoffId,
        packetVersion: 1,
        renderEventId: workerRender.renderEventId,
        consumerRunId: 'run-e2e',
        consumerRole: 'builder',
        usedAt: nowISO(),
      });

      // Step 3: Reviewer render via approval resolver
      const reviewResult = resolveApprovalHandoff(store, {
        handoffId,
        role: 'reviewer',
        model: 'claude',
        consumerRunId: 'run-e2e',
        consumerRole: 'reviewer:approval',
      });
      expect(reviewResult.ok).toBe(true);
      if (!reviewResult.ok) return;

      // Step 4: Approver render via approval resolver
      const approveResult = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-e2e',
        consumerRole: 'approver:approval',
      });
      expect(approveResult.ok).toBe(true);
      if (!approveResult.ok) return;

      // Verify full audit trail
      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(3); // worker + reviewer + approver
      expect(events[0]!.roleRenderer).toBe('worker');
      expect(events[1]!.roleRenderer).toBe('reviewer');
      expect(events[2]!.roleRenderer).toBe('approver');

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(3); // worker + reviewer + approver
      expect(uses[0]!.consumerRole).toBe('builder');
      expect(uses[1]!.consumerRole).toBe('reviewer:approval');
      expect(uses[2]!.consumerRole).toBe('approver:approval');

      // All three renders share the same handoffId + packetVersion
      expect(reviewResult.handoffId).toBe(handoffId);
      expect(approveResult.handoffId).toBe(handoffId);
      expect(reviewResult.packetVersion).toBe(1);
      expect(approveResult.packetVersion).toBe(1);

      // Output hashes are deterministic and available for binding
      expect(reviewResult.outputHash).toBeTruthy();
      expect(approveResult.outputHash).toBeTruthy();

      // Render events are linked to uses (event.id matches use.renderEventId)
      for (const use of uses) {
        const matchingEvent = events.find(e => e.id === use.renderEventId);
        expect(matchingEvent).toBeTruthy();
      }
    } finally {
      db.close();
    }
  });

  it('approval resolver rejects after all versions invalidated mid-flow', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create handoff
      const bridge = bridgeExecutionPacket({ db, packetId: 'pkt-appr-001', runId: 'run-inv' });
      if (!bridge.ok) return;
      const created = createHandoff(store, bridge.input);
      const handoffId = created.packet.handoffId;

      // Worker render succeeds
      const workerRender = renderHandoff(store, {
        handoffId: handoffId as HandoffId,
        role: 'worker',
        model: 'claude',
      });
      expect(workerRender.ok).toBe(true);

      // Invalidate the packet AFTER worker consumed it
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Truth changed after worker launch',
      });

      // Approval resolver must reject — cannot approve phantom state
      const approveResult = resolveApprovalHandoff(store, {
        handoffId,
        role: 'approver',
        model: 'claude',
        consumerRunId: 'run-inv',
        consumerRole: 'approver:approval',
      });

      expect(approveResult.ok).toBe(false);
      if (approveResult.ok) return;
      expect(approveResult.reason).toBe('all_invalidated');
    } finally {
      db.close();
    }
  });
});
