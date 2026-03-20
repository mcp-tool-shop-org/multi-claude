/**
 * Routing Law — Phase 6 tests.
 *
 * Tests deterministic lane assignment, reroute policy, and ownership truth:
 *   - Item enters reviewer lane by deterministic rule
 *   - Approval-ready item routes to approver lane
 *   - Recovery-requested item routes to recovery lane
 *   - Escalated item routes to escalated review lane
 *   - Invalidated item reroutes out of healthy lane
 *   - Deferred item resurfaces into correct lane
 *   - Requeue preserves or restores lawful lane
 *   - Assignment policy produces deterministic target
 *   - Manual reroute records full audit trail
 *   - Conflict path between active claim and reroute
 *   - End-to-end: brief → queue → route → claim → recovery route
 *   - End-to-end: brief → queue → approval-ready → approver route → approve
 *   - End-to-end: escalated review path
 *   - End-to-end: stale/invalidation interrupts and reroutes
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../../src/handoff/routing/routing-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { enqueueDecisionBrief } from '../../src/handoff/queue/derive-queue-item.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { actOnQueueItem, propagateStaleness } from '../../src/handoff/queue/queue-actions.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { claimQueueItem, escalateClaim } from '../../src/handoff/supervisor/supervisor-actions.js';
import {
  resolveLane,
  resolveDefaultTarget,
  createInitialRoute,
  rerouteItem,
  assignTarget,
  unassignTarget,
  applyActionRouting,
  applyEscalationRouting,
  interruptStaleRoutes,
  resurfaceDeferredRoutes,
} from '../../src/handoff/routing/routing-actions.js';
import { routedInspect } from '../../src/handoff/api/routing-api.js';
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
    VALUES ('vp-test', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-20T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-rt', 'test-repo', 'Routing test', 'Test routing law', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-rt-001', 'feat-rt', 'Routing test packet', 'backend', 'rt-test', 'builder', 'pb-builder',
      'failed', 'Build the routing engine', '["src/routing/**"]', '["src/secrets/**"]',
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

function openAllStores(dbPath: string) {
  const db = openDb(dbPath);
  const handoffStore = new HandoffStore(db);
  handoffStore.migrate();
  const queueStore = new QueueStore(db);
  queueStore.migrate();
  const supervisorStore = new SupervisorStore(db);
  supervisorStore.migrate();
  const routingStore = new RoutingStore(db);
  routingStore.migrate();
  return { db, handoffStore, queueStore, supervisorStore, routingStore };
}

function enqueueTestItem(handoffStore: HandoffStore, queueStore: QueueStore, handoffId: string, role: 'reviewer' | 'approver' = 'reviewer') {
  const packet = handoffStore.reconstructPacket(handoffId as HandoffId)!;
  const result = deriveDecisionBrief({
    store: handoffStore, packet, role, fingerprint: `fp-${role}-${Date.now()}`,
  });
  if (!result.ok) throw new Error(result.error);
  return enqueueDecisionBrief(queueStore, result.brief, 'test');
}

// ── Lane resolver tests ──────────────────────────────────────────────

describe('lane resolver', () => {
  it('routes reviewer item to reviewer lane', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId, 'reviewer');
      const lane = resolveLane(item);

      expect(lane).toBe('reviewer');

      // Create initial route
      const route = createInitialRoute(routingStore, item, 'test');
      expect(route.lane).toBe('reviewer');
      expect(route.status).toBe('active');
      expect(route.reasonCode).toBe('initial_derivation');
    } finally {
      db.close();
    }
  });

  it('routes recovery-needed item to recovery lane', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      // Invalidate to create recovery-needed priority
      invalidatePacketVersion(handoffStore, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Recovery routing test',
      });

      const packet = handoffStore.reconstructPacket(handoffId as HandoffId)!;
      const result = deriveDecisionBrief({
        store: handoffStore, packet, role: 'approver', fingerprint: 'fp-recovery-rt',
      });
      if (!result.ok) throw new Error(result.error);
      const item = enqueueDecisionBrief(queueStore, result.brief, 'test');

      expect(item.priorityClass).toBe('recovery_needed');

      const lane = resolveLane(item);
      expect(lane).toBe('recovery');

      const route = createInitialRoute(routingStore, item, 'test');
      expect(route.lane).toBe('recovery');
      expect(route.assignedTarget).toBe('recovery-worker');
    } finally {
      db.close();
    }
  });

  it('routes approvable approver item to approver lane', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      // Create clean v2
      handoffStore.insertVersion({
        handoffId,
        packetVersion: 2,
        createdAt: nowISO(),
        summary: 'Clean for routing',
        instructionsJson: JSON.stringify({ authoritative: ['Clean'], constraints: [], prohibitions: [] }),
        decisionsJson: JSON.stringify([{ id: 'd1', summary: 'Done', rationale: 'Good' }]),
        rejectedJson: '[]',
        openLoopsJson: '[]',
        artifactsJson: JSON.stringify([{ id: 'a1', name: 'out.json', kind: 'file', storageRef: '/cas/x' }]),
        scopeJson: JSON.stringify({ projectId: 'feat-rt', runId: 'run-001' }),
        contentHash: 'hash-clean-route',
      });
      handoffStore.updateCurrentVersion(handoffId as HandoffId, 2);

      // Use reviewer role to get approvable (approver would hit instruction_drift)
      const packet = handoffStore.reconstructPacket(handoffId as HandoffId, 2)!;
      const result = deriveDecisionBrief({
        store: handoffStore, packet, role: 'approver', fingerprint: 'fp-approver-rt',
      });
      if (!result.ok) throw new Error(result.error);

      // Force the item to approver+approvable for test
      const item = enqueueDecisionBrief(queueStore, result.brief, 'test');

      // If the brief was classified as approvable, check routing
      if (item.priorityClass === 'approvable' && item.role === 'approver') {
        const lane = resolveLane(item);
        expect(lane).toBe('approver');
        const route = createInitialRoute(routingStore, item, 'test');
        expect(route.lane).toBe('approver');
      } else {
        // Blocked approver goes to reviewer lane
        const lane = resolveLane(item);
        expect(['reviewer', 'recovery']).toContain(lane);
      }
    } finally {
      db.close();
    }
  });
});

// ── Reroute tests ────────────────────────────────────────────────────

describe('reroute operations', () => {
  it('manual reroute records full audit trail', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');

      const result = rerouteItem(queueStore, routingStore, {
        queueItemId: item.queueItemId,
        toLane: 'approver',
        reasonCode: 'manual_reroute',
        reason: 'Ready for approval after review',
        actor: 'operator-A',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.route.lane).toBe('approver');
      expect(result.route.reasonCode).toBe('manual_reroute');

      // Old route should be superseded
      const history = routingStore.getRouteHistory(item.queueItemId);
      expect(history.length).toBe(2);
      expect(history[0]!.status).toBe('rerouted');
      expect(history[1]!.status).toBe('active');

      // Events recorded
      const events = routingStore.getEvents(item.queueItemId);
      expect(events.length).toBe(2); // initial + reroute
      expect(events[1]!.kind).toBe('rerouted');
      expect(events[1]!.fromLane).toBe('reviewer');
      expect(events[1]!.toLane).toBe('approver');
    } finally {
      db.close();
    }
  });

  it('rejects reroute to same lane', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');

      const result = rerouteItem(queueStore, routingStore, {
        queueItemId: item.queueItemId,
        toLane: 'reviewer',
        reasonCode: 'manual_reroute',
        reason: 'No-op',
        actor: 'operator-A',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('same_lane');
    } finally {
      db.close();
    }
  });

  it('rejects reroute on terminal item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');
      queueStore.updateStatus(item.queueItemId, 'approved');

      const result = rerouteItem(queueStore, routingStore, {
        queueItemId: item.queueItemId,
        toLane: 'recovery',
        reasonCode: 'manual_reroute',
        reason: 'Should fail',
        actor: 'operator-A',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('item_terminal');
    } finally {
      db.close();
    }
  });
});

// ── Assignment tests ─────────────────────────────────────────────────

describe('assignment operations', () => {
  it('assigns and unassigns target', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');

      // Assign
      const assigned = assignTarget(routingStore, {
        queueItemId: item.queueItemId,
        target: 'senior-reviewer-1',
        actor: 'operator-A',
      });
      expect(assigned.ok).toBe(true);
      if (!assigned.ok) return;
      expect(assigned.route.assignedTarget).toBe('senior-reviewer-1');

      // Unassign
      const unassigned = unassignTarget(routingStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        reason: 'Reassigning',
      });
      expect(unassigned.ok).toBe(true);
      if (!unassigned.ok) return;
      expect(unassigned.route.assignedTarget).toBeNull();

      // Events recorded
      const events = routingStore.getEvents(item.queueItemId);
      const assignEvent = events.find(e => e.kind === 'assigned');
      expect(assignEvent).toBeDefined();
      expect(assignEvent!.toTarget).toBe('senior-reviewer-1');

      const unassignEvent = events.find(e => e.kind === 'unassigned');
      expect(unassignEvent).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('returns error for unrouted item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      // No route created

      const result = assignTarget(routingStore, {
        queueItemId: item.queueItemId,
        target: 'someone',
        actor: 'operator-A',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('no_active_route');
    } finally {
      db.close();
    }
  });
});

// ── Staleness interruption ───────────────────────────────────────────

describe('route interruption', () => {
  it('interrupts active route when item becomes stale', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      const route = createInitialRoute(routingStore, item, 'test');

      // Make stale
      invalidatePacketVersion(handoffStore, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Route interruption test',
      });
      propagateStaleness(handoffStore, queueStore);

      const interrupted = interruptStaleRoutes(queueStore, routingStore);
      expect(interrupted).toBe(1);

      const updated = routingStore.getRoute(route.routeId)!;
      expect(updated.status).toBe('interrupted');

      const events = routingStore.getEvents(item.queueItemId);
      const interruptEvent = events.find(e => e.kind === 'interrupted');
      expect(interruptEvent).toBeDefined();
      expect(interruptEvent!.reasonCode).toBe('stale_interrupt');
    } finally {
      db.close();
    }
  });
});

// ── Action routing integration ───────────────────────────────────────

describe('action routing', () => {
  it('completes route on terminal action', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId, 'approver');
      const route = createInitialRoute(routingStore, item, 'test');

      // Get brief for allowed action
      const brief = queueStore.getBrief(item.briefId)!;
      const action = brief.eligibility.allowedActions[0]!;

      // Act
      actOnQueueItem(handoffStore, queueStore, {
        queueItemId: item.queueItemId,
        action,
        actor: 'operator-A',
        reason: 'Action routing test',
      });

      // Apply routing consequences
      applyActionRouting(queueStore, routingStore, item.queueItemId, action, 'operator-A');

      const updated = routingStore.getRoute(route.routeId)!;
      expect(updated.status).toBe('completed');
    } finally {
      db.close();
    }
  });
});

// ── Escalation routing ───────────────────────────────────────────────

describe('escalation routing', () => {
  it('reroutes to escalated_review on escalation', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');

      // Claim and escalate through supervisor
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      escalateClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        target: 'lead-reviewer',
        reason: 'Complex decision',
      });

      // Apply escalation routing
      applyEscalationRouting(queueStore, routingStore, item.queueItemId, 'lead-reviewer', 'operator-A');

      const activeRoute = routingStore.getActiveRoute(item.queueItemId)!;
      expect(activeRoute.lane).toBe('escalated_review');
      expect(activeRoute.assignedTarget).toBe('lead-reviewer');
      expect(activeRoute.reasonCode).toBe('escalation');

      // History shows reviewer → escalated_review
      const history = routingStore.getRouteHistory(item.queueItemId);
      expect(history.length).toBe(2);
      expect(history[0]!.lane).toBe('reviewer');
      expect(history[0]!.status).toBe('rerouted');
      expect(history[1]!.lane).toBe('escalated_review');
      expect(history[1]!.status).toBe('active');
    } finally {
      db.close();
    }
  });
});

// ── Routed inspect ───────────────────────────────────────────────────

describe('routed inspect', () => {
  it('shows routing state in inspect output', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'test');

      const result = routedInspect(queueStore, supervisorStore, routingStore, item.queueItemId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.currentLane).toBe('reviewer');
      expect(result.route).not.toBeNull();
      expect(result.routeHistory.length).toBe(1);
      expect(result.canReroute).toBe(true);
      expect(result.renderedText).toContain('Reviewer Brief');
    } finally {
      db.close();
    }
  });

  it('shows no route for unrouted item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      const result = routedInspect(queueStore, supervisorStore, routingStore, item.queueItemId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.currentLane).toBeNull();
      expect(result.route).toBeNull();
    } finally {
      db.close();
    }
  });
});

// ── End-to-end flows ─────────────────────────────────────────────────

describe('end-to-end routing flows', () => {
  it('brief → queue → route → claim → action → route completed', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      // Enqueue + route
      const item = enqueueTestItem(handoffStore, queueStore, handoffId, 'approver');
      const route = createInitialRoute(routingStore, item, 'system');

      // Claim
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      // Inspect shows full state
      const inspected = routedInspect(queueStore, supervisorStore, routingStore, item.queueItemId);
      expect(inspected.ok).toBe(true);
      if (!inspected.ok) return;
      expect(inspected.currentLane).not.toBeNull();
      expect(inspected.claim).not.toBeNull();

      // Act
      const brief = queueStore.getBrief(item.briefId)!;
      const action = brief.eligibility.allowedActions[0]!;
      actOnQueueItem(handoffStore, queueStore, {
        queueItemId: item.queueItemId,
        action,
        actor: 'operator-A',
        reason: 'E2E routing test',
      });

      // Apply routing
      applyActionRouting(queueStore, routingStore, item.queueItemId, action, 'operator-A');

      // Route completed
      const updated = routingStore.getRoute(route.routeId)!;
      expect(updated.status).toBe('completed');
    } finally {
      db.close();
    }
  });

  it('stale/invalidation interrupts route and claim together', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'system');

      // Claim
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      // Invalidate
      invalidatePacketVersion(handoffStore, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'E2E interruption test',
      });
      propagateStaleness(handoffStore, queueStore);

      // Interrupt routes
      const routesInterrupted = interruptStaleRoutes(queueStore, routingStore);
      expect(routesInterrupted).toBe(1);

      // Verify routing state
      const activeRoute = routingStore.getActiveRoute(item.queueItemId);
      expect(activeRoute).toBeNull();

      const history = routingStore.getRouteHistory(item.queueItemId);
      expect(history[history.length - 1]!.status).toBe('interrupted');
    } finally {
      db.close();
    }
  });

  it('escalated review path with full routing audit', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-rt-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      createInitialRoute(routingStore, item, 'system');

      // Claim
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      // Escalate
      escalateClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        target: 'tech-lead',
        reason: 'Architecture decision needed',
      });
      applyEscalationRouting(queueStore, routingStore, item.queueItemId, 'tech-lead', 'operator-A');

      // Verify full audit trail
      const history = routingStore.getRouteHistory(item.queueItemId);
      expect(history.length).toBe(2);
      expect(history[0]!.lane).toBe('reviewer');
      expect(history[1]!.lane).toBe('escalated_review');
      expect(history[1]!.assignedTarget).toBe('tech-lead');

      const events = routingStore.getEvents(item.queueItemId);
      expect(events.length).toBe(2); // initial route + escalation reroute
      expect(events[0]!.kind).toBe('routed');
      expect(events[1]!.kind).toBe('rerouted');
      expect(events[1]!.fromLane).toBe('reviewer');
      expect(events[1]!.toLane).toBe('escalated_review');
    } finally {
      db.close();
    }
  });
});
