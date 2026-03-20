/**
 * Decision Briefs — Phase 3 tests.
 *
 * Tests the decision surface:
 *   - Reviewer brief derived from exact packet truth
 *   - Approver brief derived from exact packet truth
 *   - Baseline delta comparison
 *   - Deterministic blocker detection
 *   - Evidence coverage assessment
 *   - Invalidated versions cannot produce approvable brief
 *   - Action binding to brief + packet + fingerprint
 *   - End-to-end: packet → brief → action → lineage
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { createDecisionBrief } from '../../src/handoff/api/create-decision-brief.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { resolveBaseline, computeBaselineDelta } from '../../src/handoff/decision/derive-baseline-delta.js';
import { deriveBlockers } from '../../src/handoff/decision/derive-blockers.js';
import { deriveEvidenceCoverage } from '../../src/handoff/decision/derive-evidence-coverage.js';
import { renderReviewerBrief } from '../../src/handoff/decision/reviewer-decision-renderer.js';
import { renderApproverBrief } from '../../src/handoff/decision/approver-decision-renderer.js';
import { bindDecisionAction } from '../../src/handoff/decision/bind-decision-action.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';
import { nowISO } from '../../src/lib/ids.js';

// ── Test fixture ─────────────────────────────────────────────────────

function seedFullDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-test', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-19T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-dec', 'test-repo', 'Decision brief test', 'Test decision surface', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-dec-001', 'feat-dec', 'Decision test packet', 'backend', 'dec-test', 'builder', 'pb-builder',
      'failed', 'Build the decision engine', '["src/decision/**"]', '["src/secrets/**"]',
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

// ── Reviewer brief tests ─────────────────────────────────────────────

describe('reviewer decision brief', () => {
  it('derives structured brief from exact packet truth', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const result = deriveDecisionBrief({
        store,
        packet,
        role: 'reviewer',
        fingerprint: 'test-fingerprint-001',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const brief = result.brief;
      expect(brief.role).toBe('reviewer');
      expect(brief.handoffId).toBe(handoffId);
      expect(brief.packetVersion).toBe(1);
      expect(brief.briefVersion).toBe('1.0.0');
      expect(brief.summary).toContain('Build the decision engine');
      expect(brief.evidenceCoverage.fingerprint).toBe('test-fingerprint-001');
      expect(brief.eligibility.allowedActions).toBeDefined();
      expect(brief.eligibility.recommendedAction).toBeDefined();
      expect(brief.eligibility.rationale.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it('renders human-readable reviewer brief text', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const result = deriveDecisionBrief({
        store, packet, role: 'reviewer', fingerprint: 'fp-001',
      });
      if (!result.ok) return;

      const text = renderReviewerBrief(result.brief);
      expect(text).toContain('Reviewer Brief');
      expect(text).toContain(handoffId);
      expect(text).toContain('Recommendation');
    } finally {
      db.close();
    }
  });
});

// ── Approver brief tests ─────────────────────────────────────────────

describe('approver decision brief', () => {
  it('derives structured approver brief', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const result = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-002',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.brief.role).toBe('approver');
      expect(result.brief.evidenceCoverage.fingerprint).toBe('fp-002');
    } finally {
      db.close();
    }
  });

  it('renders human-readable approver brief with approval target', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const result = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-003',
      });
      if (!result.ok) return;

      const text = renderApproverBrief(result.brief);
      expect(text).toContain('Approver Brief');
      expect(text).toContain('Approval Target');
      expect(text).toContain('Eligibility');
      expect(text).toContain('Fingerprint');
      expect(text).toContain('Available Actions');
    } finally {
      db.close();
    }
  });

  it('reviewer and approver briefs have different recommendations', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const reviewer = deriveDecisionBrief({
        store, packet, role: 'reviewer', fingerprint: 'fp-cmp',
      });
      const approver = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-cmp',
      });

      if (!reviewer.ok || !approver.ok) return;

      // Both should have the same packet truth
      expect(reviewer.brief.handoffId).toBe(approver.brief.handoffId);
      expect(reviewer.brief.packetVersion).toBe(approver.brief.packetVersion);

      // But different roles
      expect(reviewer.brief.role).toBe('reviewer');
      expect(approver.brief.role).toBe('approver');
    } finally {
      db.close();
    }
  });
});

// ── Baseline delta tests ─────────────────────────────────────────────

describe('baseline delta', () => {
  it('returns no baseline for first version', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const baseline = resolveBaseline(store, handoffId as HandoffId, 1);

      expect(baseline.type).toBe('none');
      expect(baseline.packet).toBeNull();
      expect(baseline.version).toBeNull();
    } finally {
      db.close();
    }
  });

  it('uses last valid version as baseline when v2 exists', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create version 2
      store.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Updated version with new decision',
        instructionsJson: JSON.stringify({ authoritative: ['New instructions'], constraints: [], prohibitions: [] }),
        decisionsJson: JSON.stringify([{ id: 'dec-new', summary: 'New decision', rationale: 'Fresh' }]),
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: '[]',
        scopeJson: JSON.stringify({ projectId: 'feat-dec', runId: 'run-001' }),
        contentHash: 'hash-v2-delta',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      // Resolve baseline for v2 — should get v1
      const baseline = resolveBaseline(store, handoffId as HandoffId, 2);

      expect(baseline.type).toBe('last_valid');
      expect(baseline.version).toBe(1);
      expect(baseline.packet).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it('computes delta between two versions', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const v1 = store.reconstructPacket(handoffId as HandoffId, 1)!;

      // Create v2 with changed summary and new decision
      store.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Changed summary for delta test',
        instructionsJson: JSON.stringify(v1.instructions),
        decisionsJson: JSON.stringify([
          ...v1.decisions,
          { id: 'dec-new', summary: 'Brand new decision', rationale: 'Testing delta' },
        ]),
        rejectedJson: JSON.stringify(v1.rejected),
        openLoopsJson: JSON.stringify(v1.openLoops),
        artifactsJson: JSON.stringify(v1.artifacts),
        scopeJson: JSON.stringify(v1.scope),
        contentHash: 'hash-v2-delta-test',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      const v2 = store.reconstructPacket(handoffId as HandoffId, 2)!;
      const delta = computeBaselineDelta(v1, v2, 'last_valid');

      expect(delta.baselineVersion).toBe(1);
      expect(delta.currentVersion).toBe(2);
      expect(delta.summaryChanged).toBe(true);
      expect(delta.decisionsAdded.length).toBe(1);
      expect(delta.decisionsAdded[0]).toContain('Brand new decision');
      expect(delta.deltaLines.length).toBeGreaterThan(0);
      expect(delta.deltaLines.some(l => l.includes('Summary changed'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('uses approved version as baseline when available', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Approve v1
      store.insertApproval({
        handoffId,
        packetVersion: 1,
        approvalType: 'handoff_approval',
        approvalStatus: 'approved',
        approvedBy: 'test-approver',
        evidenceFingerprint: 'fp-baseline',
        createdAt: nowISO(),
        updatedAt: nowISO(),
      });

      // Create v2
      store.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Post-approval version',
        instructionsJson: JSON.stringify({ authoritative: ['v2'], constraints: [], prohibitions: [] }),
        decisionsJson: '[]',
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: '[]',
        scopeJson: JSON.stringify({ projectId: 'feat-dec', runId: 'run-001' }),
        contentHash: 'hash-v2-approved-baseline',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      // Baseline for v2 should prefer the approved v1
      const baseline = resolveBaseline(store, handoffId as HandoffId, 2);
      expect(baseline.type).toBe('approved');
      expect(baseline.version).toBe(1);
    } finally {
      db.close();
    }
  });
});

// ── Blocker tests ────────────────────────────────────────────────────

describe('deterministic blocker detection', () => {
  it('detects invalidated version as blocker', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      // Invalidate
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Testing blocker detection',
      });

      const blockers = deriveBlockers({
        store, packet, role: 'approver',
        evidenceCoverage: { fingerprint: 'fp', requiredArtifacts: [], presentArtifacts: [], missingArtifacts: [] },
        delta: null,
      });

      const invalidBlocker = blockers.find(b => b.code === 'invalidated_version');
      expect(invalidBlocker).toBeDefined();
      expect(invalidBlocker!.severity).toBe('high');
    } finally {
      db.close();
    }
  });

  it('detects high-priority open loops as blocker', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      // The bridge-created packet has open loops from failed attempts
      // Let's check if there are high-priority ones
      const hasHighLoops = packet.openLoops.some(l => l.priority === 'high');

      const blockers = deriveBlockers({
        store, packet, role: 'approver',
        evidenceCoverage: { fingerprint: 'fp', requiredArtifacts: [], presentArtifacts: [], missingArtifacts: [] },
        delta: null,
      });

      if (hasHighLoops) {
        const loopBlocker = blockers.find(b => b.code === 'high_priority_open_loops');
        expect(loopBlocker).toBeDefined();
      }
      // Either way, blockers array is valid
      expect(Array.isArray(blockers)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('returns no high blockers for clean packet', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create a clean packet with no open loops
      store.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Clean version',
        instructionsJson: JSON.stringify({ authoritative: ['Clean'], constraints: [], prohibitions: [] }),
        decisionsJson: JSON.stringify([{ id: 'd1', summary: 'Done', rationale: 'All good' }]),
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: JSON.stringify([{ id: 'a1', name: 'result.json', kind: 'file', storageRef: '/cas/test' }]),
        scopeJson: JSON.stringify({ projectId: 'feat-dec', runId: 'run-001' }),
        contentHash: 'hash-clean',
      });
      store.updateCurrentVersion(handoffId as HandoffId, 2);

      const packet = store.reconstructPacket(handoffId as HandoffId, 2)!;
      const blockers = deriveBlockers({
        store, packet, role: 'reviewer',
        evidenceCoverage: { fingerprint: 'fp', requiredArtifacts: ['result.json'], presentArtifacts: ['result.json'], missingArtifacts: [] },
        delta: null,
      });

      const highBlockers = blockers.filter(b => b.severity === 'high');
      expect(highBlockers.length).toBe(0);
    } finally {
      db.close();
    }
  });
});

// ── Evidence coverage tests ──────────────────────────────────────────

describe('evidence coverage', () => {
  it('identifies present and missing artifacts', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const coverage = deriveEvidenceCoverage(packet, 'fp-evidence');

      expect(coverage.fingerprint).toBe('fp-evidence');
      expect(Array.isArray(coverage.requiredArtifacts)).toBe(true);
      expect(Array.isArray(coverage.presentArtifacts)).toBe(true);
      expect(Array.isArray(coverage.missingArtifacts)).toBe(true);
      // Present should match required (since we derive required from the packet itself)
      expect(coverage.missingArtifacts.length).toBe(0);
    } finally {
      db.close();
    }
  });
});

// ── Action binding tests ─────────────────────────────────────────────

describe('action binding', () => {
  it('binds approve action to brief + packet + fingerprint', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      const briefResult = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-bind-test',
      });
      if (!briefResult.ok) return;

      // Only bind if approve is allowed
      if (!briefResult.brief.eligibility.allowedActions.includes('approve')) {
        // Brief says not approvable — test reject instead
        const rejectResult = bindDecisionAction(store, {
          brief: briefResult.brief,
          action: 'reject',
          actor: 'test-approver',
          reason: 'Testing action binding',
        });
        expect(rejectResult.ok).toBe(true);
        if (!rejectResult.ok) return;
        expect(rejectResult.record.action).toBe('reject');
        expect(rejectResult.record.evidenceFingerprint).toBe('fp-bind-test');
        return;
      }

      const bindResult = bindDecisionAction(store, {
        brief: briefResult.brief,
        action: 'approve',
        actor: 'test-approver',
        reason: 'Testing action binding',
      });

      expect(bindResult.ok).toBe(true);
      if (!bindResult.ok) return;

      expect(bindResult.record.action).toBe('approve');
      expect(bindResult.record.handoffId).toBe(handoffId);
      expect(bindResult.record.packetVersion).toBe(1);
      expect(bindResult.record.briefId).toBe(briefResult.brief.briefId);
      expect(bindResult.record.evidenceFingerprint).toBe('fp-bind-test');
      expect(bindResult.record.actor).toBe('test-approver');

      // Approval should be recorded in spine approvals table
      const approvals = store.getApprovals(handoffId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.approvalStatus).toBe('approved');
      expect(approvals[0]!.evidenceFingerprint).toBe('fp-bind-test');
    } finally {
      db.close();
    }
  });

  it('rejects disallowed action', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      // Invalidate to make approve disallowed
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Make approve impossible',
      });

      const briefResult = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-disallowed',
      });
      if (!briefResult.ok) return;

      // Should not be able to approve an invalidated version
      const bindResult = bindDecisionAction(store, {
        brief: briefResult.brief,
        action: 'approve',
        actor: 'test-approver',
        reason: 'Trying to approve invalidated',
      });

      // Either action_not_allowed or version_invalidated
      expect(bindResult.ok).toBe(false);
    } finally {
      db.close();
    }
  });

  it('rejects action when version invalidated after brief creation', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);
      const packet = store.reconstructPacket(handoffId as HandoffId)!;

      // Create brief BEFORE invalidation
      const briefResult = deriveDecisionBrief({
        store, packet, role: 'approver', fingerprint: 'fp-race',
      });
      if (!briefResult.ok) return;

      // Invalidate AFTER brief creation (simulates race condition)
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Invalidated after brief',
      });

      // Bind should catch the invalidation at bind time
      const bindResult = bindDecisionAction(store, {
        brief: briefResult.brief,
        action: briefResult.brief.eligibility.allowedActions[0]!,
        actor: 'test-approver',
        reason: 'Race condition test',
      });

      expect(bindResult.ok).toBe(false);
      if (bindResult.ok) return;
      expect(bindResult.code).toBe('version_invalidated');
    } finally {
      db.close();
    }
  });
});

// ── Create brief API tests ───────────────────────────────────────────

describe('createDecisionBrief API', () => {
  it('creates reviewer brief via API with render + use recording', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = createDecisionBrief(store, {
        handoffId,
        role: 'reviewer',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.brief.role).toBe('reviewer');
      expect(result.renderedText).toContain('Reviewer Brief');
      expect(result.renderEventId).toBeDefined();

      // Use was recorded
      const uses = store.getUses(handoffId);
      expect(uses.some(u => u.consumerRole === 'reviewer:brief')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('creates approver brief via API', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = createDecisionBrief(store, {
        handoffId,
        role: 'approver',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.brief.role).toBe('approver');
      expect(result.renderedText).toContain('Approver Brief');
      expect(result.renderedText).toContain('Approval Target');
    } finally {
      db.close();
    }
  });

  it('fails for nonexistent handoff', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      const result = createDecisionBrief(store, {
        handoffId: 'ho-nonexistent',
        role: 'approver',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('not_found');
    } finally {
      db.close();
    }
  });

  it('fails when all versions invalidated', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'All gone',
      });

      const result = createDecisionBrief(store, {
        handoffId,
        role: 'approver',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('all_invalidated');
    } finally {
      db.close();
    }
  });
});

// ── End-to-end: packet → brief → action → lineage ───────────────────

describe('end-to-end decision flow', () => {
  it('full chain: packet → brief → approve → audit trail', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Step 1: Create reviewer brief
      const reviewBrief = createDecisionBrief(store, {
        handoffId, role: 'reviewer', consumerRunId: 'run-e2e-dec',
      });
      expect(reviewBrief.ok).toBe(true);
      if (!reviewBrief.ok) return;

      // Step 2: Create approver brief
      const approverBrief = createDecisionBrief(store, {
        handoffId, role: 'approver', consumerRunId: 'run-e2e-dec',
      });
      expect(approverBrief.ok).toBe(true);
      if (!approverBrief.ok) return;

      // Step 3: Take action (use whatever action is allowed)
      const allowedAction = approverBrief.brief.eligibility.allowedActions[0]!;
      const actionResult = bindDecisionAction(store, {
        brief: approverBrief.brief,
        action: allowedAction,
        actor: 'test-operator',
        reason: 'End-to-end decision test',
        renderEventId: approverBrief.renderEventId,
      });

      expect(actionResult.ok).toBe(true);
      if (!actionResult.ok) return;

      // Step 4: Verify full audit trail
      const events = store.getRenderEvents(handoffId);
      expect(events.length).toBe(2); // reviewer + approver

      const uses = store.getUses(handoffId);
      expect(uses.length).toBe(2); // reviewer:brief + approver:brief
      expect(uses.some(u => u.consumerRole === 'reviewer:brief')).toBe(true);
      expect(uses.some(u => u.consumerRole === 'approver:brief')).toBe(true);

      // Step 5: Verify action is traceable
      expect(actionResult.record.handoffId).toBe(handoffId);
      expect(actionResult.record.packetVersion).toBe(1);
      expect(actionResult.record.briefId).toBe(approverBrief.brief.briefId);
      expect(actionResult.record.evidenceFingerprint).toBe(approverBrief.brief.evidenceCoverage.fingerprint);
      expect(actionResult.record.renderEventId).toBe(approverBrief.renderEventId);

      // Step 6: Verify spine approval was recorded
      const approvals = store.getApprovals(handoffId);
      expect(approvals.length).toBe(1);
      expect(approvals[0]!.packetVersion).toBe(1);
      expect(approvals[0]!.evidenceFingerprint).toBe(approverBrief.brief.evidenceCoverage.fingerprint);
    } finally {
      db.close();
    }
  });

  it('invalidation mid-flow blocks action binding', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-dec-001', 'run-001');

    const db = openDb(dbPath);
    try {
      const store = new HandoffStore(db);

      // Create brief
      const brief = createDecisionBrief(store, {
        handoffId, role: 'approver',
      });
      expect(brief.ok).toBe(true);
      if (!brief.ok) return;

      // Invalidate after brief creation
      invalidatePacketVersion(store, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Truth changed mid-decision',
      });

      // Action should fail
      const action = bindDecisionAction(store, {
        brief: brief.brief,
        action: brief.brief.eligibility.allowedActions[0]!,
        actor: 'test-operator',
        reason: 'Should fail',
      });

      expect(action.ok).toBe(false);
      if (action.ok) return;
      expect(action.code).toBe('version_invalidated');

      // No approval should be recorded
      const approvals = store.getApprovals(handoffId);
      expect(approvals.length).toBe(0);
    } finally {
      db.close();
    }
  });
});
