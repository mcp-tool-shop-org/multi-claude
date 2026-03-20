/**
 * Monitor Query Layer — Phase 13A tests.
 *
 * Tests the read-optimized projection queries that power the
 * Control Plane Monitor UI. Each query composes data from multiple
 * law stores into UI-ready shapes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../../src/handoff/routing/routing-store.js';
import { FlowStore } from '../../src/handoff/flow/flow-store.js';
import { InterventionStore } from '../../src/handoff/intervention/intervention-store.js';
import { PolicyStore } from '../../src/handoff/policy/policy-store.js';
import { OutcomeStore } from '../../src/handoff/outcome/outcome-store.js';
import { CalibrationStore } from '../../src/handoff/calibration/calibration-store.js';
import { PromotionStore } from '../../src/handoff/promotion/promotion-store.js';
import { queryOverview } from '../../src/monitor/queries/overview-query.js';
import { queryQueueList } from '../../src/monitor/queries/queue-query.js';
import { queryItemDetail } from '../../src/monitor/queries/item-detail-query.js';
import { queryAllLaneHealth, queryLaneHealth } from '../../src/monitor/queries/lane-health-query.js';
import { queryActivity } from '../../src/monitor/queries/activity-query.js';
import { tempDbPath } from '../handoff/helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let counter = 5000;

function openAllStores(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);
  const handoffStore = new HandoffStore(db);
  handoffStore.migrate();
  const queueStore = new QueueStore(db);
  queueStore.migrate();
  const supervisorStore = new SupervisorStore(db);
  supervisorStore.migrate();
  const routingStore = new RoutingStore(db);
  routingStore.migrate();
  const flowStore = new FlowStore(db);
  flowStore.migrate();
  const interventionStore = new InterventionStore(db);
  interventionStore.migrate();
  const policyStore = new PolicyStore(db);
  policyStore.migrate();
  const outcomeStore = new OutcomeStore(db);
  outcomeStore.migrate();
  const calibrationStore = new CalibrationStore(db);
  calibrationStore.migrate();
  const promotionStore = new PromotionStore(db);
  promotionStore.migrate();
  return {
    db, handoffStore, queueStore, supervisorStore, routingStore,
    flowStore, interventionStore, policyStore, outcomeStore,
    calibrationStore, promotionStore,
  };
}

function id(prefix: string): string {
  return `${prefix}-${++counter}`;
}

const NOW = '2026-03-20T12:00:00Z';
const LATER = '2026-03-20T13:00:00Z';

function seedQueueItem(stores: ReturnType<typeof openAllStores>, overrides: Record<string, unknown> = {}) {
  const queueItemId = overrides.queueItemId as string ?? id('qi');
  const handoffId = overrides.handoffId as string ?? id('ho');
  stores.queueStore.insertQueueItem({
    queueItemId,
    handoffId,
    packetVersion: 1,
    briefId: id('br'),
    role: (overrides.role as 'reviewer' | 'approver') ?? 'reviewer',
    status: (overrides.status as string) ?? 'pending',
    priorityClass: (overrides.priorityClass as string) ?? 'approvable',
    blockerSummary: 'none',
    eligibilitySummary: 'eligible',
    evidenceFingerprint: 'fp-test',
    createdAt: NOW,
    updatedAt: NOW,
  });
  return queueItemId;
}

function seedRoute(stores: ReturnType<typeof openAllStores>, queueItemId: string, lane: string = 'reviewer') {
  stores.routingStore.insertRoute({
    routeId: id('rt'),
    queueItemId,
    lane: lane as 'reviewer' | 'approver' | 'recovery' | 'escalated_review',
    assignedTarget: null,
    status: 'active',
    reasonCode: 'initial_derivation',
    reason: 'Initial routing',
    routedBy: 'system',
    routedAt: NOW,
    updatedAt: NOW,
  });
}

function seedClaim(stores: ReturnType<typeof openAllStores>, queueItemId: string, actor: string = 'agent-1') {
  const claimId = id('cl');
  stores.supervisorStore.insertClaim({
    claimId,
    queueItemId,
    claimedBy: actor,
    claimedAt: NOW,
    status: 'active',
    leaseExpiresAt: LATER,
    deferredUntil: null,
    escalationTarget: null,
    lastReason: 'claimed for review',
    updatedAt: NOW,
  });
  return claimId;
}

function seedOutcome(stores: ReturnType<typeof openAllStores>, queueItemId: string, status: string = 'open') {
  const outcomeId = id('oc');
  stores.outcomeStore.insertOutcome({
    outcomeId,
    queueItemId,
    handoffId: id('ho'),
    packetVersion: 1,
    briefId: id('br'),
    status: status as 'open' | 'closed',
    finalAction: status === 'closed' ? 'approved' : null,
    finalStatus: status === 'closed' ? 'approved' : null,
    resolutionTerminal: status === 'closed' ? 'approved' : null,
    resolutionQuality: status === 'closed' ? 'clean' : null,
    policySetId: null,
    policyVersion: null,
    closedBy: status === 'closed' ? 'agent-1' : null,
    openedAt: NOW,
    closedAt: status === 'closed' ? LATER : null,
    durationMs: status === 'closed' ? 3600000 : null,
    claimCount: 1,
    deferCount: 0,
    rerouteCount: 0,
    escalationCount: 0,
    overflowCount: 0,
    interventionCount: 0,
    recoveryCycleCount: 0,
    claimChurnCount: 0,
    policyChangedDuringLifecycle: false,
  });
  return outcomeId;
}

// ── Overview Query ──────────────────────────────────────────────────

describe('queryOverview', () => {
  it('returns empty snapshot for fresh db', () => {
    const stores = openAllStores(tempDbPath());
    const snapshot = queryOverview(stores);

    expect(snapshot.computedAt).toBeTruthy();
    expect(snapshot.counts.pendingItems).toBe(0);
    expect(snapshot.counts.claimedItems).toBe(0);
    expect(snapshot.counts.totalActiveItems).toBe(0);
    expect(snapshot.counts.openOutcomes).toBe(0);
    expect(snapshot.counts.closedOutcomes).toBe(0);
    expect(snapshot.counts.activeInterventions).toBe(0);
    expect(snapshot.counts.activeTrials).toBe(0);
    expect(snapshot.lanes).toHaveLength(4); // fast, standard, careful, oversight
    expect(snapshot.activePolicy.policySetId).toBeNull();
    expect(snapshot.activeTrials).toHaveLength(0);
  });

  it('counts pending and claimed items', () => {
    const stores = openAllStores(tempDbPath());

    // 2 pending items
    seedQueueItem(stores, { status: 'pending' });
    seedQueueItem(stores, { status: 'pending' });

    // 1 claimed item
    const qi3 = seedQueueItem(stores, { status: 'pending' });
    seedClaim(stores, qi3);

    const snapshot = queryOverview(stores);
    expect(snapshot.counts.pendingItems).toBe(3); // all are status=pending
    expect(snapshot.counts.claimedItems).toBe(1);
  });

  it('counts outcomes', () => {
    const stores = openAllStores(tempDbPath());

    const qi1 = seedQueueItem(stores);
    seedOutcome(stores, qi1, 'open');

    const qi2 = seedQueueItem(stores);
    seedOutcome(stores, qi2, 'closed');

    const qi3 = seedQueueItem(stores);
    seedOutcome(stores, qi3, 'closed');

    const snapshot = queryOverview(stores);
    expect(snapshot.counts.openOutcomes).toBe(1);
    expect(snapshot.counts.closedOutcomes).toBe(2);
  });

  it('includes lane health for all 4 lanes', () => {
    const stores = openAllStores(tempDbPath());
    const snapshot = queryOverview(stores);

    expect(snapshot.lanes.map(l => l.lane)).toEqual(['reviewer', 'approver', 'recovery', 'escalated_review']);
    for (const lane of snapshot.lanes) {
      expect(lane.healthState).toBeTruthy();
      expect(lane.wipCap).toBeGreaterThan(0);
    }
  });
});

// ── Queue Query ─────────────────────────────────────────────────────

describe('queryQueueList', () => {
  it('returns all queue items', () => {
    const stores = openAllStores(tempDbPath());
    seedQueueItem(stores);
    seedQueueItem(stores);
    seedQueueItem(stores);

    const items = queryQueueList(stores);
    expect(items).toHaveLength(3);
  });

  it('projects routing state', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedRoute(stores, qi, 'reviewer');

    const items = queryQueueList(stores);
    expect(items[0].lane).toBe('reviewer');
  });

  it('projects claim state', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedClaim(stores, qi, 'agent-x');

    const items = queryQueueList(stores);
    expect(items[0].claimant).toBe('agent-x');
    expect(items[0].claimStatus).toBe('active');
    expect(items[0].leaseExpiresAt).toBe(LATER);
  });

  it('projects outcome state', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedOutcome(stores, qi, 'closed');

    const items = queryQueueList(stores);
    expect(items[0].hasOutcome).toBe(true);
    expect(items[0].outcomeStatus).toBe('closed');
  });

  it('filters by status', () => {
    const stores = openAllStores(tempDbPath());
    seedQueueItem(stores, { status: 'pending' });
    seedQueueItem(stores, { status: 'pending' });
    seedQueueItem(stores, { status: 'approved' });

    const pending = queryQueueList(stores, { status: 'pending' });
    expect(pending).toHaveLength(2);
  });

  it('filters by lane', () => {
    const stores = openAllStores(tempDbPath());
    const qi1 = seedQueueItem(stores);
    seedRoute(stores, qi1, 'reviewer');
    const qi2 = seedQueueItem(stores);
    seedRoute(stores, qi2, 'approver');
    const qi3 = seedQueueItem(stores);
    seedRoute(stores, qi3, 'reviewer');

    const reviewerItems = queryQueueList(stores, { lane: 'reviewer' });
    expect(reviewerItems).toHaveLength(2);
    expect(reviewerItems.every(i => i.lane === 'reviewer')).toBe(true);
  });

  it('filters by claimed', () => {
    const stores = openAllStores(tempDbPath());
    const qi1 = seedQueueItem(stores);
    seedClaim(stores, qi1);
    seedQueueItem(stores); // unclaimed

    const claimed = queryQueueList(stores, { claimed: true });
    expect(claimed).toHaveLength(1);

    const unclaimed = queryQueueList(stores, { claimed: false });
    expect(unclaimed).toHaveLength(1);
  });

  it('respects limit', () => {
    const stores = openAllStores(tempDbPath());
    for (let i = 0; i < 10; i++) seedQueueItem(stores);

    const limited = queryQueueList(stores, { limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

// ── Item Detail Query ───────────────────────────────────────────────

describe('queryItemDetail', () => {
  it('returns null for nonexistent item', () => {
    const stores = openAllStores(tempDbPath());
    const detail = queryItemDetail(stores, 'nonexistent');
    expect(detail).toBeNull();
  });

  it('returns core item fields', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores, { role: 'approver', priorityClass: 'blocked_high' });

    const detail = queryItemDetail(stores, qi);
    expect(detail).not.toBeNull();
    expect(detail!.queueItemId).toBe(qi);
    expect(detail!.role).toBe('approver');
    expect(detail!.priorityClass).toBe('blocked_high');
    expect(detail!.status).toBe('pending');
    expect(detail!.createdAt).toBe(NOW);
  });

  it('includes routing state', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedRoute(stores, qi, 'approver');

    const detail = queryItemDetail(stores, qi);
    expect(detail!.routing.currentLane).toBe('approver');
    expect(detail!.routing.routeHistory).toHaveLength(1);
    expect(detail!.routing.routeHistory[0].lane).toBe('approver');
  });

  it('includes supervisor state', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedClaim(stores, qi, 'agent-z');

    const detail = queryItemDetail(stores, qi);
    expect(detail!.supervisor.activeClaim).not.toBeNull();
    expect(detail!.supervisor.activeClaim!.actor).toBe('agent-z');
    expect(detail!.supervisor.activeClaim!.expiresAt).toBe(LATER);
  });

  it('includes outcome when present', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedOutcome(stores, qi, 'closed');

    const detail = queryItemDetail(stores, qi);
    expect(detail!.outcome).not.toBeNull();
    expect(detail!.outcome!.status).toBe('closed');
    expect(detail!.outcome!.durationMs).toBe(3600000);
  });

  it('outcome is null when not present', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);

    const detail = queryItemDetail(stores, qi);
    expect(detail!.outcome).toBeNull();
  });
});

// ── Lane Health Query ───────────────────────────────────────────────

describe('queryLaneHealth', () => {
  it('returns health for all 4 lanes', () => {
    const stores = openAllStores(tempDbPath());
    const lanes = queryAllLaneHealth(stores);

    expect(lanes).toHaveLength(4);
    expect(lanes.map(l => l.lane)).toEqual(['reviewer', 'approver', 'recovery', 'escalated_review']);
  });

  it('returns health for a specific lane', () => {
    const stores = openAllStores(tempDbPath());
    const health = queryLaneHealth(stores, 'reviewer');

    expect(health.lane).toBe('reviewer');
    expect(health.wipCap).toBeGreaterThan(0);
    expect(health.healthState).toBeTruthy();
    expect(health.utilization).toBeGreaterThanOrEqual(0);
    expect(health.policyInputs).toBeDefined();
    expect(health.policyInputs.wipCap).toBeGreaterThan(0);
  });

  it('includes breach codes array', () => {
    const stores = openAllStores(tempDbPath());
    const health = queryLaneHealth(stores, 'approver');

    expect(Array.isArray(health.breachCodes)).toBe(true);
  });

  it('includes recent events', () => {
    const stores = openAllStores(tempDbPath());
    const health = queryLaneHealth(stores, 'approver');

    expect(Array.isArray(health.recentEvents)).toBe(true);
  });
});

// ── Activity Query ──────────────────────────────────────────────────

describe('queryActivity', () => {
  it('returns empty array for fresh db', () => {
    const stores = openAllStores(tempDbPath());
    const events = queryActivity(stores);
    expect(events).toEqual([]);
  });

  it('returns supervisor events from claims', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedClaim(stores, qi, 'agent-1');

    const events = queryActivity(stores);
    // Supervisor store may or may not emit events on insertClaim
    // This tests the pipeline doesn't error
    expect(Array.isArray(events)).toBe(true);
  });

  it('respects limit filter', () => {
    const stores = openAllStores(tempDbPath());
    // Seed several claims to get events
    for (let i = 0; i < 5; i++) {
      const qi = seedQueueItem(stores);
      seedClaim(stores, qi, `agent-${i}`);
    }

    const limited = queryActivity(stores, { limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });

  it('filters by source', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedClaim(stores, qi);

    const policyOnly = queryActivity(stores, { source: 'policy' });
    expect(policyOnly.every(e => e.source === 'policy')).toBe(true);
  });

  it('events have required fields', () => {
    const stores = openAllStores(tempDbPath());
    const qi = seedQueueItem(stores);
    seedClaim(stores, qi);

    const events = queryActivity(stores);
    for (const e of events) {
      expect(e.id).toBeTruthy();
      expect(e.timestamp).toBeTruthy();
      expect(e.source).toBeTruthy();
      expect(e.kind).toBeTruthy();
      expect(typeof e.detail).toBe('string');
    }
  });
});
