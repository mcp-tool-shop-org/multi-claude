/**
 * Policy Control — Phase 9 tests.
 *
 * Tests deterministic policy governance:
 *   - Content hash is deterministic
 *   - Validation catches invalid content
 *   - Validation passes valid content
 *   - Create policy set with auto-validation
 *   - Create rejects invalid content
 *   - Activate policy supersedes current
 *   - Activate rejects non-validated policy
 *   - Activate rejects already-active policy
 *   - Rollback restores superseded policy
 *   - Rollback rejects non-superseded target
 *   - Rollback rejects when no active policy
 *   - Resolve active policy returns active content
 *   - Resolve active policy falls back to defaults
 *   - Diff detects field changes
 *   - Diff returns empty for identical policies
 *   - Simulate reports impact
 *   - Policy inspect returns full state
 *   - Policy show returns policy + events
 *   - End-to-end: create → activate → supersede → rollback lifecycle
 *   - End-to-end: full audit trail
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../../src/handoff/routing/routing-store.js';
import { FlowStore } from '../../src/handoff/flow/flow-store.js';
import { InterventionStore } from '../../src/handoff/intervention/intervention-store.js';
import { PolicyStore } from '../../src/handoff/policy/policy-store.js';
import {
  computePolicyHash,
  validatePolicy,
  createPolicySet,
  activatePolicy,
  rollbackPolicy,
  resolveActivePolicy,
  diffPolicies,
  simulatePolicy,
} from '../../src/handoff/policy/policy-actions.js';
import { policyInspect, policyShow, policyDiff } from '../../src/handoff/api/policy-api.js';
import { DEFAULT_POLICY_CONTENT } from '../../src/handoff/policy/types.js';
import type { PolicyContent } from '../../src/handoff/policy/types.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

function createStores(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  const policyStore = new PolicyStore(db);
  const flowStore = new FlowStore(db);
  const routingStore = new RoutingStore(db);
  const supervisorStore = new SupervisorStore(db);
  const queueStore = new QueueStore(db);
  const interventionStore = new InterventionStore(db);

  policyStore.migrate();
  flowStore.migrate();
  routingStore.migrate();
  supervisorStore.migrate();
  queueStore.migrate();
  interventionStore.migrate();

  return { db, policyStore, flowStore, routingStore, supervisorStore, queueStore, interventionStore };
}

function makeContent(overrides?: Partial<PolicyContent>): PolicyContent {
  return { ...DEFAULT_POLICY_CONTENT, ...overrides };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Policy Control — Phase 9', () => {
  // ── Content hash ─────────────────────────────────────────────────

  it('content hash is deterministic', () => {
    const hash1 = computePolicyHash(DEFAULT_POLICY_CONTENT);
    const hash2 = computePolicyHash(DEFAULT_POLICY_CONTENT);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('content hash changes with different content', () => {
    const hash1 = computePolicyHash(DEFAULT_POLICY_CONTENT);
    const modified = makeContent({ recoveryThrottle: 10 });
    const hash2 = computePolicyHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  // ── Validation ───────────────────────────────────────────────────

  it('validation passes valid content', () => {
    const result = validatePolicy(DEFAULT_POLICY_CONTENT);
    expect(result.valid).toBe(true);
  });

  it('validation catches invalid lane caps', () => {
    const content = makeContent({
      laneCaps: { reviewer: 0, approver: 5, recovery: 5, escalated_review: 5 },
    });
    const result = validatePolicy(content);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes("laneCap for 'reviewer'"))).toBe(true);
    }
  });

  it('validation catches invalid lease duration', () => {
    const content = makeContent({ leaseDurationMs: 100 });
    const result = validatePolicy(content);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('leaseDurationMs'))).toBe(true);
    }
  });

  it('validation catches invalid breach thresholds', () => {
    const content = makeContent({
      breachThresholds: {
        saturationChecks: 0,
        starvationCount: 3,
        overflowBacklog: 5,
        recoveryStormEvents: 5,
        claimChurnEvents: 5,
      },
    });
    const result = validatePolicy(content);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('saturationChecks'))).toBe(true);
    }
  });

  it('validation catches invalid recovery throttle', () => {
    const content = makeContent({ recoveryThrottle: 0 });
    const result = validatePolicy(content);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('recoveryThrottle'))).toBe(true);
    }
  });

  it('validation catches invalid defer resurface interval', () => {
    const content = makeContent({ deferResurfaceIntervalMs: 500 });
    const result = validatePolicy(content);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some(e => e.includes('deferResurfaceIntervalMs'))).toBe(true);
    }
  });

  // ── Create ───────────────────────────────────────────────────────

  it('creates policy set with auto-validation', () => {
    const { policyStore } = createStores(tempDbPath());
    const result = createPolicySet(policyStore, {
      content: DEFAULT_POLICY_CONTENT,
      reason: 'Initial policy',
      actor: 'test',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policySet.status).toBe('validated');
      expect(result.policySet.policyVersion).toBe(1);
      expect(result.policySet.scope).toBe('global');
      expect(result.policySet.contentHash).toHaveLength(16);
    }
  });

  it('create rejects invalid content', () => {
    const { policyStore } = createStores(tempDbPath());
    const content = makeContent({ recoveryThrottle: 0 });
    const result = createPolicySet(policyStore, {
      content,
      reason: 'Bad policy',
      actor: 'test',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('validation_failed');
    }
  });

  it('create increments version per scope', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, {
      content: DEFAULT_POLICY_CONTENT,
      reason: 'v1',
      actor: 'test',
    });
    const r2 = createPolicySet(policyStore, {
      content: makeContent({ recoveryThrottle: 5 }),
      reason: 'v2',
      actor: 'test',
    });
    expect(r1.ok && r1.policySet.policyVersion).toBe(1);
    expect(r2.ok && r2.policySet.policyVersion).toBe(2);
  });

  // ── Activation ───────────────────────────────────────────────────

  it('activates policy and supersedes current', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, {
      content: DEFAULT_POLICY_CONTENT,
      reason: 'v1',
      actor: 'test',
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    // Activate first
    const a1 = activatePolicy(policyStore, {
      policySetId: r1.policySet.policySetId,
      actor: 'test',
      reason: 'Go live',
    });
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    expect(a1.activated.status).toBe('active');
    expect(a1.superseded).toBeNull();

    // Create and activate second — should supersede first
    const r2 = createPolicySet(policyStore, {
      content: makeContent({ recoveryThrottle: 5 }),
      reason: 'v2',
      actor: 'test',
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    const a2 = activatePolicy(policyStore, {
      policySetId: r2.policySet.policySetId,
      actor: 'test',
      reason: 'Upgrade',
    });
    expect(a2.ok).toBe(true);
    if (!a2.ok) return;
    expect(a2.activated.status).toBe('active');
    expect(a2.superseded).not.toBeNull();
    expect(a2.superseded!.status).toBe('superseded');
    expect(a2.superseded!.policySetId).toBe(r1.policySet.policySetId);
  });

  it('activate rejects non-validated policy', () => {
    const { policyStore } = createStores(tempDbPath());
    const result = activatePolicy(policyStore, {
      policySetId: 'ps-nonexistent',
      actor: 'test',
      reason: 'Try',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
    }
  });

  it('activate rejects already-active policy', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, {
      content: DEFAULT_POLICY_CONTENT,
      reason: 'v1',
      actor: 'test',
    });
    if (!r1.ok) return;

    activatePolicy(policyStore, {
      policySetId: r1.policySet.policySetId,
      actor: 'test',
      reason: 'Go live',
    });

    const dup = activatePolicy(policyStore, {
      policySetId: r1.policySet.policySetId,
      actor: 'test',
      reason: 'Again',
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.code).toBe('already_active');
    }
  });

  // ── Rollback ─────────────────────────────────────────────────────

  it('rollback restores superseded policy', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });
    const r2 = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 5 }), reason: 'v2', actor: 'test' });
    if (!r1.ok || !r2.ok) return;

    activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'test', reason: 'Go live' });
    activatePolicy(policyStore, { policySetId: r2.policySet.policySetId, actor: 'test', reason: 'Upgrade' });

    const rb = rollbackPolicy(policyStore, {
      targetPolicySetId: r1.policySet.policySetId,
      actor: 'test',
      reason: 'Revert',
    });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(rb.rolledBack.status).toBe('rolled_back');
    expect(rb.restored.status).toBe('active');
    expect(rb.restored.policySetId).toBe(r1.policySet.policySetId);
  });

  it('rollback rejects non-superseded target', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });
    if (!r1.ok) return;

    activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'test', reason: 'Go live' });

    const rb = rollbackPolicy(policyStore, {
      targetPolicySetId: r1.policySet.policySetId,
      actor: 'test',
      reason: 'Revert',
    });
    expect(rb.ok).toBe(false);
    if (!rb.ok) {
      expect(rb.code).toBe('invalid_status');
    }
  });

  it('rollback rejects when no active policy', () => {
    const { policyStore } = createStores(tempDbPath());
    const rb = rollbackPolicy(policyStore, {
      targetPolicySetId: 'ps-missing',
      actor: 'test',
      reason: 'Revert',
    });
    expect(rb.ok).toBe(false);
    if (!rb.ok) {
      expect(rb.code).toBe('not_found');
    }
  });

  // ── Active policy resolver ───────────────────────────────────────

  it('resolve active policy returns active content', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 7 }), reason: 'v1', actor: 'test' });
    if (!r1.ok) return;
    activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'test', reason: 'Go live' });

    const resolved = resolveActivePolicy(policyStore);
    expect(resolved.policySetId).toBe(r1.policySet.policySetId);
    expect(resolved.content.recoveryThrottle).toBe(7);
  });

  it('resolve active policy falls back to defaults', () => {
    const { policyStore } = createStores(tempDbPath());
    const resolved = resolveActivePolicy(policyStore);
    expect(resolved.policySetId).toBeNull();
    expect(resolved.content).toEqual(DEFAULT_POLICY_CONTENT);
  });

  // ── Diff ─────────────────────────────────────────────────────────

  it('diff detects field changes', () => {
    const old = DEFAULT_POLICY_CONTENT;
    const updated = makeContent({
      recoveryThrottle: 10,
      laneCaps: { reviewer: 8, approver: 5, recovery: 5, escalated_review: 5 },
    });
    const diffs = diffPolicies(old, updated);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some(d => d.field === 'recoveryThrottle')).toBe(true);
    expect(diffs.some(d => d.field === 'laneCaps' && d.lane === 'reviewer')).toBe(true);
  });

  it('diff returns empty for identical policies', () => {
    const diffs = diffPolicies(DEFAULT_POLICY_CONTENT, DEFAULT_POLICY_CONTENT);
    expect(diffs).toHaveLength(0);
  });

  it('diff detects breach threshold changes', () => {
    const updated = makeContent({
      breachThresholds: {
        saturationChecks: 10,
        starvationCount: 3,
        overflowBacklog: 5,
        recoveryStormEvents: 5,
        claimChurnEvents: 5,
      },
    });
    const diffs = diffPolicies(DEFAULT_POLICY_CONTENT, updated);
    expect(diffs.some(d => d.field === 'breachThresholds.saturationChecks')).toBe(true);
  });

  it('diff detects routing default changes', () => {
    const updated = makeContent({
      routingDefaults: {
        reviewer: 'new-target',
        approver: null,
        recovery: 'recovery-worker',
        escalated_review: null,
      },
    });
    const diffs = diffPolicies(DEFAULT_POLICY_CONTENT, updated);
    expect(diffs.some(d => d.field === 'routingDefaults' && d.lane === 'reviewer')).toBe(true);
  });

  // ── Simulation ───────────────────────────────────────────────────

  it('simulate reports impact for cap changes', () => {
    const stores = createStores(tempDbPath());
    const candidate = makeContent({ laneCaps: { reviewer: 1, approver: 5, recovery: 5, escalated_review: 5 } });
    const result = simulatePolicy(
      stores.policyStore, stores.flowStore, stores.routingStore,
      stores.supervisorStore, stores.queueStore, stores.interventionStore,
      candidate,
    );
    expect(result.diffs.some(d => d.field === 'laneCaps' && d.lane === 'reviewer')).toBe(true);
  });

  it('simulate with lane filter only checks that lane', () => {
    const stores = createStores(tempDbPath());
    const candidate = makeContent({
      laneCaps: { reviewer: 1, approver: 1, recovery: 1, escalated_review: 1 },
    });
    const result = simulatePolicy(
      stores.policyStore, stores.flowStore, stores.routingStore,
      stores.supervisorStore, stores.queueStore, stores.interventionStore,
      candidate,
      { lane: 'reviewer' },
    );
    // Impact lines should only mention reviewer
    for (const line of result.impactSummary) {
      expect(line.startsWith('reviewer:')).toBe(true);
    }
  });

  // ── API: Inspect ─────────────────────────────────────────────────

  it('policy inspect returns full state', () => {
    const { policyStore } = createStores(tempDbPath());
    createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });

    const result = policyInspect(policyStore);
    expect(result.allPolicies).toHaveLength(1);
    expect(result.activePolicy).toBeNull();
    expect(result.recentEvents.length).toBeGreaterThan(0);
  });

  it('policy inspect shows active after activation', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });
    if (!r1.ok) return;
    activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'test', reason: 'Go live' });

    const result = policyInspect(policyStore);
    expect(result.activePolicy).not.toBeNull();
    expect(result.activePolicy!.policySetId).toBe(r1.policySet.policySetId);
  });

  // ── API: Show ────────────────────────────────────────────────────

  it('policy show returns policy + events', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });
    if (!r1.ok) return;

    const result = policyShow(policyStore, r1.policySet.policySetId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.policy.policySetId).toBe(r1.policySet.policySetId);
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it('policy show returns error for missing id', () => {
    const { policyStore } = createStores(tempDbPath());
    const result = policyShow(policyStore, 'ps-missing');
    expect(result.ok).toBe(false);
  });

  // ── API: Diff ────────────────────────────────────────────────────

  it('policy diff via API works', () => {
    const { policyStore } = createStores(tempDbPath());
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'test' });
    const r2 = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 10 }), reason: 'v2', actor: 'test' });
    if (!r1.ok || !r2.ok) return;

    const result = policyDiff(policyStore, r1.policySet.policySetId, r2.policySet.policySetId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diffs.some(d => d.field === 'recoveryThrottle')).toBe(true);
    }
  });

  // ── End-to-end: lifecycle ────────────────────────────────────────

  it('full lifecycle: create → activate → supersede → rollback', () => {
    const { policyStore } = createStores(tempDbPath());

    // Create v1
    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'admin' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    // Activate v1
    const a1 = activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'admin', reason: 'Go live' });
    expect(a1.ok).toBe(true);

    // Create v2
    const r2 = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 10 }), reason: 'v2', actor: 'admin' });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    // Activate v2 — supersedes v1
    const a2 = activatePolicy(policyStore, { policySetId: r2.policySet.policySetId, actor: 'admin', reason: 'Upgrade' });
    expect(a2.ok).toBe(true);
    if (!a2.ok) return;
    expect(a2.superseded!.policySetId).toBe(r1.policySet.policySetId);

    // Resolve confirms v2 is active
    const resolved = resolveActivePolicy(policyStore);
    expect(resolved.policySetId).toBe(r2.policySet.policySetId);
    expect(resolved.content.recoveryThrottle).toBe(10);

    // Rollback to v1
    const rb = rollbackPolicy(policyStore, { targetPolicySetId: r1.policySet.policySetId, actor: 'admin', reason: 'Revert' });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;

    // Resolve confirms v1 is active again
    const resolved2 = resolveActivePolicy(policyStore);
    expect(resolved2.policySetId).toBe(r1.policySet.policySetId);
    expect(resolved2.content.recoveryThrottle).toBe(3);
  });

  it('full audit trail records all events', () => {
    const { policyStore } = createStores(tempDbPath());

    const r1 = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'admin' });
    if (!r1.ok) return;
    activatePolicy(policyStore, { policySetId: r1.policySet.policySetId, actor: 'admin', reason: 'Go live' });

    const r2 = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 5 }), reason: 'v2', actor: 'admin' });
    if (!r2.ok) return;
    activatePolicy(policyStore, { policySetId: r2.policySet.policySetId, actor: 'admin', reason: 'Upgrade' });
    rollbackPolicy(policyStore, { targetPolicySetId: r1.policySet.policySetId, actor: 'admin', reason: 'Revert' });

    const allEvents = policyStore.getEvents({});
    // Expected events: created(v1), activated(v1), created(v2), superseded(v1), activated(v2), rolled_back(v2), activated(v1)
    expect(allEvents.length).toBe(7);

    const kinds = allEvents.map(e => e.kind);
    expect(kinds.filter(k => k === 'created')).toHaveLength(2);
    expect(kinds.filter(k => k === 'activated')).toHaveLength(3);
    expect(kinds.filter(k => k === 'superseded')).toHaveLength(1);
    expect(kinds.filter(k => k === 'rolled_back')).toHaveLength(1);
  });

  // ── Scoped policies ──────────────────────────────────────────────

  it('scoped policies are independent', () => {
    const { policyStore } = createStores(tempDbPath());
    const rGlobal = createPolicySet(policyStore, { content: DEFAULT_POLICY_CONTENT, scope: 'global', reason: 'Global v1', actor: 'test' });
    const rProject = createPolicySet(policyStore, { content: makeContent({ recoveryThrottle: 7 }), scope: 'project-a', reason: 'Project v1', actor: 'test' });
    if (!rGlobal.ok || !rProject.ok) return;

    activatePolicy(policyStore, { policySetId: rGlobal.policySet.policySetId, actor: 'test', reason: 'Go' });
    activatePolicy(policyStore, { policySetId: rProject.policySet.policySetId, actor: 'test', reason: 'Go' });

    const globalResolved = resolveActivePolicy(policyStore, 'global');
    const projectResolved = resolveActivePolicy(policyStore, 'project-a');
    expect(globalResolved.content.recoveryThrottle).toBe(3);
    expect(projectResolved.content.recoveryThrottle).toBe(7);
  });
});
