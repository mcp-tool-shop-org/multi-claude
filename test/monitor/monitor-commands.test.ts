/**
 * Monitor Command Layer — Phase 13B tests.
 *
 * Tests the operator command endpoints and action eligibility policy.
 * Verifies that commands go through canonical law actions and that
 * eligibility is computed correctly from item state.
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
import { computeEligibility } from '../../src/monitor/policies/action-eligibility.js';
import { executeClaimItem } from '../../src/monitor/commands/claim-item.js';
import { executeReleaseItem } from '../../src/monitor/commands/release-item.js';
import { executeDeferItem } from '../../src/monitor/commands/defer-item.js';
import { executeRequeueItem } from '../../src/monitor/commands/requeue-item.js';
import { executeEscalateItem } from '../../src/monitor/commands/escalate-item.js';
import { queryQueueList } from '../../src/monitor/queries/queue-query.js';
import { queryItemDetail } from '../../src/monitor/queries/item-detail-query.js';
import { tempDbPath } from '../handoff/helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let counter = 8000;

function openAllStores(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);
  const handoffStore = new HandoffStore(db); handoffStore.migrate();
  const queueStore = new QueueStore(db); queueStore.migrate();
  const supervisorStore = new SupervisorStore(db); supervisorStore.migrate();
  const routingStore = new RoutingStore(db); routingStore.migrate();
  const flowStore = new FlowStore(db); flowStore.migrate();
  const interventionStore = new InterventionStore(db); interventionStore.migrate();
  const policyStore = new PolicyStore(db); policyStore.migrate();
  const outcomeStore = new OutcomeStore(db); outcomeStore.migrate();
  const calibrationStore = new CalibrationStore(db); calibrationStore.migrate();
  const promotionStore = new PromotionStore(db); promotionStore.migrate();
  return {
    db, handoffStore, queueStore, supervisorStore, routingStore,
    flowStore, interventionStore, policyStore, outcomeStore,
    calibrationStore, promotionStore,
  };
}

function uid(prefix: string): string {
  return `${prefix}-${++counter}`;
}

const NOW = '2026-03-20T12:00:00Z';
const LATER = '2099-12-31T23:59:59Z';

function seedQueueItem(stores: ReturnType<typeof openAllStores>, overrides: Record<string, unknown> = {}) {
  const queueItemId = overrides.queueItemId as string ?? uid('qi');
  stores.queueStore.insertQueueItem({
    queueItemId,
    handoffId: uid('ho'),
    packetVersion: 1,
    briefId: uid('br'),
    role: 'reviewer',
    status: (overrides.status as string) ?? 'pending',
    priorityClass: 'approvable',
    blockerSummary: 'none',
    eligibilitySummary: 'eligible',
    evidenceFingerprint: 'fp-test',
    createdAt: NOW,
    updatedAt: NOW,
  });
  return queueItemId;
}

function seedClaim(stores: ReturnType<typeof openAllStores>, queueItemId: string, actor: string = 'operator-1') {
  const claimId = uid('cl');
  stores.supervisorStore.insertClaim({
    claimId,
    queueItemId,
    claimedBy: actor,
    claimedAt: NOW,
    status: 'active',
    leaseExpiresAt: LATER,
    deferredUntil: null,
    escalationTarget: null,
    lastReason: 'claimed',
    updatedAt: NOW,
  });
  return claimId;
}

function seedDeferredClaim(stores: ReturnType<typeof openAllStores>, queueItemId: string, actor: string = 'operator-1') {
  const claimId = uid('cl');
  stores.supervisorStore.insertClaim({
    claimId,
    queueItemId,
    claimedBy: actor,
    claimedAt: NOW,
    status: 'deferred',
    leaseExpiresAt: LATER,
    deferredUntil: '2099-12-31T23:59:59Z',
    escalationTarget: null,
    lastReason: 'deferred',
    updatedAt: NOW,
  });
  return claimId;
}

// ── Eligibility tests ───────────────────────────────────────────────

describe('Action Eligibility', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('allows claim on pending unclaimed item', () => {
    const qiId = seedQueueItem(stores);
    const elig = computeEligibility(stores, qiId);
    expect(elig.claim.allowed).toBe(true);
    expect(elig.release.allowed).toBe(false);
    expect(elig.defer.allowed).toBe(false);
    expect(elig.escalate.allowed).toBe(false);
    expect(elig.requeue.allowed).toBe(false);
  });

  it('allows release/defer/escalate/requeue on actively claimed item', () => {
    const qiId = seedQueueItem(stores);
    seedClaim(stores, qiId);
    const elig = computeEligibility(stores, qiId);
    expect(elig.claim.allowed).toBe(false);
    expect(elig.claim.reason).toContain('Already claimed');
    expect(elig.release.allowed).toBe(true);
    expect(elig.defer.allowed).toBe(true);
    expect(elig.escalate.allowed).toBe(true);
    expect(elig.requeue.allowed).toBe(true);
  });

  it('allows requeue on deferred item', () => {
    const qiId = seedQueueItem(stores, { status: 'in_review' });
    seedDeferredClaim(stores, qiId);
    const elig = computeEligibility(stores, qiId);
    expect(elig.claim.allowed).toBe(false);
    expect(elig.requeue.allowed).toBe(true);
  });

  it('disallows all actions on terminal item', () => {
    const qiId = seedQueueItem(stores, { status: 'approved' });
    const elig = computeEligibility(stores, qiId);
    expect(elig.claim.allowed).toBe(false);
    expect(elig.release.allowed).toBe(false);
    expect(elig.defer.allowed).toBe(false);
    expect(elig.requeue.allowed).toBe(false);
    expect(elig.escalate.allowed).toBe(false);
    expect(elig.claim.reason).toContain('terminal');
  });

  it('disallows all actions on stale item', () => {
    const qiId = seedQueueItem(stores, { status: 'stale' });
    const elig = computeEligibility(stores, qiId);
    expect(elig.claim.allowed).toBe(false);
    expect(elig.claim.reason).toContain('stale');
  });

  it('returns disallowed for non-existent item', () => {
    const elig = computeEligibility(stores, 'non-existent');
    expect(elig.claim.allowed).toBe(false);
    expect(elig.claim.reason).toContain('not found');
  });
});

// ── Command tests ──────────────────────────────────────────────────

describe('Monitor Commands', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  describe('Claim', () => {
    it('claims a pending item successfully', () => {
      const qiId = seedQueueItem(stores);
      const result = executeClaimItem(stores.queueStore, stores.supervisorStore, qiId, { operatorId: 'op-1' });
      expect(result.ok).toBe(true);
      expect(result.action).toBe('claim');

      // Verify canonical state changed
      const item = stores.queueStore.getQueueItem(qiId);
      expect(item!.status).toBe('in_review');
      const claim = stores.supervisorStore.getActiveClaim(qiId);
      expect(claim).not.toBeNull();
      expect(claim!.claimedBy).toBe('op-1');
    });

    it('rejects claim on already claimed item', () => {
      const qiId = seedQueueItem(stores);
      seedClaim(stores, qiId, 'other-op');
      const result = executeClaimItem(stores.queueStore, stores.supervisorStore, qiId, { operatorId: 'op-1' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('already_claimed');
    });

    it('rejects claim on terminal item', () => {
      const qiId = seedQueueItem(stores, { status: 'approved' });
      const result = executeClaimItem(stores.queueStore, stores.supervisorStore, qiId, { operatorId: 'op-1' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('item_terminal');
    });
  });

  describe('Release', () => {
    it('releases a claimed item successfully', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const result = executeReleaseItem(stores.queueStore, stores.supervisorStore, qiId, {
        operatorId: 'op-1',
        reason: 'Done reviewing',
      });
      expect(result.ok).toBe(true);

      const item = stores.queueStore.getQueueItem(qiId);
      expect(item!.status).toBe('pending');
    });

    it('rejects release from wrong operator', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const result = executeReleaseItem(stores.queueStore, stores.supervisorStore, qiId, {
        operatorId: 'wrong-op',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('not_claimer');
    });

    it('rejects release when no active claim', () => {
      const qiId = seedQueueItem(stores);
      const result = executeReleaseItem(stores.queueStore, stores.supervisorStore, qiId, {
        operatorId: 'op-1',
      });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('claim_not_found');
    });
  });

  describe('Defer', () => {
    it('defers a claimed item', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const until = '2026-03-20T14:00:00Z';
      const result = executeDeferItem(stores.supervisorStore, qiId, {
        operatorId: 'op-1',
        reason: 'Need more info',
        until,
      });
      expect(result.ok).toBe(true);

      const claim = stores.supervisorStore.getActiveOrDeferredClaim(qiId);
      expect(claim!.status).toBe('deferred');
      expect(claim!.deferredUntil).toBe(until);
    });

    it('rejects defer from wrong operator', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const result = executeDeferItem(stores.supervisorStore, qiId, {
        operatorId: 'wrong-op',
        reason: 'test',
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('Requeue', () => {
    it('requeues a deferred item back to pending', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedDeferredClaim(stores, qiId, 'op-1');

      const result = executeRequeueItem(stores.queueStore, stores.supervisorStore, qiId, {
        operatorId: 'op-1',
        reason: 'Ready to retry',
      });
      expect(result.ok).toBe(true);

      const item = stores.queueStore.getQueueItem(qiId);
      expect(item!.status).toBe('pending');
    });

    it('requeues an active claim back to pending', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const result = executeRequeueItem(stores.queueStore, stores.supervisorStore, qiId, {
        operatorId: 'op-1',
      });
      expect(result.ok).toBe(true);

      const item = stores.queueStore.getQueueItem(qiId);
      expect(item!.status).toBe('pending');
    });
  });

  describe('Escalate', () => {
    it('escalates a claimed item', () => {
      const qiId = seedQueueItem(stores, { status: 'in_review' });
      seedClaim(stores, qiId, 'op-1');

      const result = executeEscalateItem(stores.supervisorStore, qiId, {
        operatorId: 'op-1',
        reason: 'Needs senior review',
        target: 'senior-team',
      });
      expect(result.ok).toBe(true);

      const claim = stores.supervisorStore.getClaim(
        stores.supervisorStore.getEventsByQueueItem(qiId)
          .find(e => e.kind === 'escalated')!.claimId
      );
      expect(claim!.status).toBe('escalated');
      expect(claim!.escalationTarget).toBe('senior-team');
    });

    it('rejects escalate when no active claim', () => {
      const qiId = seedQueueItem(stores);
      const result = executeEscalateItem(stores.supervisorStore, qiId, {
        operatorId: 'op-1',
        reason: 'test',
      });
      expect(result.ok).toBe(false);
    });
  });
});

// ── Read model eligibility projection tests ─────────────────────────

describe('Read Model Eligibility', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('queue list items include eligibility', () => {
    seedQueueItem(stores);
    const items = queryQueueList(stores);
    expect(items.length).toBe(1);
    expect(items[0]!.actions).toBeDefined();
    expect(items[0]!.actions.claim.allowed).toBe(true);
  });

  it('item detail includes eligibility', () => {
    const qiId = seedQueueItem(stores);
    const detail = queryItemDetail(stores, qiId);
    expect(detail).not.toBeNull();
    expect(detail!.actions).toBeDefined();
    expect(detail!.actions.claim.allowed).toBe(true);
  });

  it('eligibility updates after command execution', () => {
    const qiId = seedQueueItem(stores);

    // Before claim: claim allowed
    let detail = queryItemDetail(stores, qiId);
    expect(detail!.actions.claim.allowed).toBe(true);

    // Execute claim
    executeClaimItem(stores.queueStore, stores.supervisorStore, qiId, { operatorId: 'op-1' });

    // After claim: release allowed, claim not
    detail = queryItemDetail(stores, qiId);
    expect(detail!.actions.claim.allowed).toBe(false);
    expect(detail!.actions.release.allowed).toBe(true);
  });

  it('activity events appear after command', () => {
    const qiId = seedQueueItem(stores);
    executeClaimItem(stores.queueStore, stores.supervisorStore, qiId, { operatorId: 'op-1' });

    const detail = queryItemDetail(stores, qiId);
    const supervisorEvents = detail!.timeline.filter(e => e.source === 'supervisor');
    expect(supervisorEvents.length).toBeGreaterThan(0);
    expect(supervisorEvents.some(e => e.kind === 'claimed')).toBe(true);
  });
});
