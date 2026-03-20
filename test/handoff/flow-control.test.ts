/**
 * Flow Control — Phase 7 tests.
 *
 * Tests deterministic capacity, admission control, and pressure handling:
 *   - WIP cap enforcement per lane
 *   - Admission granted when lane has capacity
 *   - Admission denied when lane is full
 *   - Overflow entry and exit
 *   - Starvation detection for old items
 *   - Recovery throttling
 *   - Cap management (set, audit)
 *   - Capacity freed on claim release
 *   - Reconciliation from actual state
 *   - End-to-end: routed item denied by cap → overflow → capacity freed → resurfaced
 *   - End-to-end: starvation detection under load
 *   - End-to-end: full lifecycle
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../../src/handoff/routing/routing-store.js';
import { FlowStore } from '../../src/handoff/flow/flow-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { enqueueDecisionBrief } from '../../src/handoff/queue/derive-queue-item.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { claimQueueItem, releaseClaim } from '../../src/handoff/supervisor/supervisor-actions.js';
import { createInitialRoute } from '../../src/handoff/routing/routing-actions.js';
import {
  checkAdmission,
  checkAdmissionWithThrottle,
  computeLaneState,
  computeAllLaneStates,
  enterOverflow,
  resurfaceOverflow,
  detectStarvation,
  recordStarvation,
  recordCapacityFreed,
  setLaneCap,
  reconcileLaneCounts,
} from '../../src/handoff/flow/flow-actions.js';
import { flowInspect, laneInspect } from '../../src/handoff/api/flow-api.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let pktCounter = 0;

function seedDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-flow', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-20T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-flow', 'test-repo', 'Flow test', 'Test flow control', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.close();
  return dbPath;
}

function addPacket(dbPath: string): string {
  pktCounter++;
  const packetId = `pkt-flow-${pktCounter}`;
  const db = openDb(dbPath);
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      ?, 'feat-flow', 'Flow test packet', 'backend', ?, 'builder', 'pb-builder',
      'failed', 'Test flow control', '["src/**"]', '["src/secrets/**"]',
      'vp-flow', 'declare', 0, 'test'
    )
  `).run(packetId, `flow-desc-${pktCounter}`);
  db.close();
  return packetId;
}

function createHandoffFromPacket(dbPath: string, packetId: string): string {
  const db = openDb(dbPath);
  try {
    const store = new HandoffStore(db);
    const bridge = bridgeExecutionPacket({ db, packetId, runId: `run-flow-${pktCounter}` });
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
  const flowStore = new FlowStore(db);
  flowStore.migrate();
  return { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore };
}

/** Create a handoff → brief → queue item → initial route */
function createRoutedItem(
  handoffStore: HandoffStore,
  queueStore: QueueStore,
  routingStore: RoutingStore,
  handoffId: string,
  role: 'reviewer' | 'approver' = 'reviewer',
) {
  const packet = handoffStore.reconstructPacket(handoffId as unknown as HandoffId)!;
  const result = deriveDecisionBrief({
    store: handoffStore, packet, role, fingerprint: `fp-${role}-${Date.now()}-${Math.random()}`,
  });
  if (!result.ok) throw new Error(result.error);
  const item = enqueueDecisionBrief(queueStore, result.brief, 'test');
  createInitialRoute(routingStore, item, 'test-actor');
  return item;
}

describe('Flow Control — Phase 7', () => {
  // ── Admission control ─────────────────────────────────────────

  describe('admission control', () => {
    it('grants admission when lane has capacity', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      const result = checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(result.ok).toBe(true);
      expect(result.lane).toBe('reviewer');

      db.close();
    });

    it('denies admission when lane is full', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      // Set cap to 1
      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });

      // Create and claim one item to fill the lane
      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      const result = checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('lane_full');
        expect(result.activeCount).toBe(1);
        expect(result.wipCap).toBe(1);
      }

      db.close();
    });

    it('re-grants admission after claim release frees capacity', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      // Full
      expect(checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer').ok).toBe(false);

      // Release
      releaseClaim(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1', reason: 'done',
      });

      // Capacity available again
      expect(checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer').ok).toBe(true);

      db.close();
    });
  });

  // ── WIP cap management ────────────────────────────────────────

  describe('WIP cap management', () => {
    it('sets and retrieves WIP cap', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      const result = setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'approver', cap: 3, actor: 'admin', reason: 'team size',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.oldCap).toBe(5); // default
        expect(result.newCap).toBe(3);
      }

      expect(flowStore.getWipCap('approver')).toBe(3);
      db.close();
    });

    it('rejects invalid cap (< 1)', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      const result = setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 0, actor: 'admin', reason: 'bad',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('invalid_cap');
      db.close();
    });

    it('rejects same cap (no-op)', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 3, actor: 'admin', reason: 'initial',
      });
      const result = setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 3, actor: 'admin', reason: 'again',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('same_cap');
      db.close();
    });

    it('records cap change event', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'recovery', cap: 2, actor: 'admin', reason: 'limit retries',
      });

      const events = flowStore.getEvents({ lane: 'recovery', kind: 'cap_set' });
      expect(events.length).toBe(1);
      expect(events[0].reasonCode).toBe('cap_change');
      expect(events[0].wipCap).toBe(2);
      expect(events[0].reason).toContain('5 → 2');

      db.close();
    });
  });

  // ── Overflow ──────────────────────────────────────────────────

  describe('overflow', () => {
    it('records overflow entry', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      enterOverflow(flowStore, routingStore, supervisorStore, item.queueItemId, 'reviewer', 'lane full', 'system');

      const overflow = flowStore.listOverflow('reviewer');
      expect(overflow.length).toBe(1);
      expect(overflow[0].queueItemId).toBe(item.queueItemId);

      const events = flowStore.getEvents({ kind: 'overflow_entered' });
      expect(events.length).toBe(1);

      db.close();
    });

    it('resurfaces overflow when capacity frees', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      // Put an item in overflow
      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      enterOverflow(flowStore, routingStore, supervisorStore, item.queueItemId, 'reviewer', 'lane full', 'system');

      expect(flowStore.countOverflow('reviewer')).toBe(1);

      // Resurface — lane is open (no claims)
      const count = resurfaceOverflow(flowStore, routingStore, supervisorStore, queueStore);
      expect(count).toBe(1);
      expect(flowStore.countOverflow('reviewer')).toBe(0);

      const events = flowStore.getEvents({ kind: 'overflow_exited' });
      expect(events.length).toBe(1);

      db.close();
    });

    it('does not resurface when lane is still full', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt1 = addPacket(dbPath);
      const h1 = createHandoffFromPacket(dbPath, pkt1);
      const pkt2 = addPacket(dbPath);
      const h2 = createHandoffFromPacket(dbPath, pkt2);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });

      // Claim to fill lane
      const item1 = createRoutedItem(handoffStore, queueStore, routingStore, h1);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId, actor: 'actor-1',
      });

      // Put another item in overflow
      const item2 = createRoutedItem(handoffStore, queueStore, routingStore, h2);
      enterOverflow(flowStore, routingStore, supervisorStore, item2.queueItemId, 'reviewer', 'lane full', 'system');

      // Lane is still full — should not resurface
      const count = resurfaceOverflow(flowStore, routingStore, supervisorStore, queueStore);
      expect(count).toBe(0);
      expect(flowStore.countOverflow('reviewer')).toBe(1);

      db.close();
    });
  });

  // ── Starvation ────────────────────────────────────────────────

  describe('starvation detection', () => {
    it('detects starved items exceeding threshold', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);

      // With a tiny threshold (0ms), everything is starved
      const starved = detectStarvation(queueStore, routingStore, supervisorStore, 0);
      expect(starved.length).toBe(1);
      expect(starved[0].queueItemId).toBe(item.queueItemId);
      expect(starved[0].lane).toBe('reviewer');

      db.close();
    });

    it('does not detect recently created items with normal threshold', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);

      createRoutedItem(handoffStore, queueStore, routingStore, handoffId);

      // Default threshold is 4 hours — nothing should be starved
      const starved = detectStarvation(queueStore, routingStore, supervisorStore);
      expect(starved.length).toBe(0);

      db.close();
    });

    it('excludes actively claimed items from starvation', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore } = openAllStores(dbPath);

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      // Even with 0ms threshold, claimed items are excluded
      const starved = detectStarvation(queueStore, routingStore, supervisorStore, 0);
      expect(starved.length).toBe(0);

      db.close();
    });

    it('records starvation events', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      const starved = detectStarvation(queueStore, routingStore, supervisorStore, 0);
      const count = recordStarvation(flowStore, routingStore, supervisorStore, starved);

      expect(count).toBe(1);
      const events = flowStore.getEvents({ kind: 'starvation_detected' });
      expect(events.length).toBe(1);

      db.close();
    });
  });

  // ── Recovery throttle ─────────────────────────────────────────

  describe('recovery throttle', () => {
    it('allows recovery when under throttle limit', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      // With 0 active, throttle=3 should pass
      const result = checkAdmissionWithThrottle(
        flowStore, routingStore, supervisorStore, 'recovery', 3,
      );
      expect(result.ok).toBe(true);

      db.close();
    });

    it('does not throttle non-recovery lanes', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      // Reviewer lane ignores recovery throttle
      const result = checkAdmissionWithThrottle(
        flowStore, routingStore, supervisorStore, 'reviewer', 0,
      );
      expect(result.ok).toBe(true);

      db.close();
    });
  });

  // ── Lane state computation ────────────────────────────────────

  describe('lane state', () => {
    it('computes lane state correctly', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      const state = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');

      expect(state.lane).toBe('reviewer');
      expect(state.flowStatus).toBe('open');
      expect(state.pendingCount).toBe(1);
      expect(state.activeCount).toBe(0);

      // Claim → active
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      const state2 = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(state2.activeCount).toBe(1);

      db.close();
    });

    it('computes all lane states', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      const states = computeAllLaneStates(flowStore, routingStore, supervisorStore);
      expect(states.length).toBe(4);
      expect(states.every(s => s.flowStatus === 'open')).toBe(true);

      db.close();
    });

    it('reports saturated when at cap', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      const state = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(state.flowStatus).toBe('saturated');

      db.close();
    });

    it('reports overflowing when at cap with overflow items', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt1 = addPacket(dbPath);
      const h1 = createHandoffFromPacket(dbPath, pkt1);
      const pkt2 = addPacket(dbPath);
      const h2 = createHandoffFromPacket(dbPath, pkt2);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });

      const item1 = createRoutedItem(handoffStore, queueStore, routingStore, h1);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId, actor: 'actor-1',
      });

      const item2 = createRoutedItem(handoffStore, queueStore, routingStore, h2);
      enterOverflow(flowStore, routingStore, supervisorStore, item2.queueItemId, 'reviewer', 'full', 'system');

      const state = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(state.flowStatus).toBe('overflowing');
      expect(state.overflowCount).toBe(1);

      db.close();
    });
  });

  // ── Capacity freed ────────────────────────────────────────────

  describe('capacity freed', () => {
    it('records capacity freed event on release', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      const item = createRoutedItem(handoffStore, queueStore, routingStore, handoffId);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      recordCapacityFreed(flowStore, routingStore, supervisorStore, 'reviewer', item.queueItemId, 'claim_released', 'actor-1');

      const events = flowStore.getEvents({ kind: 'capacity_freed' });
      expect(events.length).toBe(1);
      expect(events[0].reasonCode).toBe('claim_released');
      expect(events[0].queueItemId).toBe(item.queueItemId);

      db.close();
    });
  });

  // ── Reconciliation ────────────────────────────────────────────

  describe('reconciliation', () => {
    it('reconciles lane counts from actual state', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore } = openAllStores(dbPath);

      const states = reconcileLaneCounts(flowStore, routingStore, supervisorStore);
      expect(states.length).toBe(4);

      const events = flowStore.getEvents({ kind: 'capacity_recalc' });
      expect(events.length).toBe(4);

      db.close();
    });
  });

  // ── Flow inspect API ──────────────────────────────────────────

  describe('flow inspect', () => {
    it('returns full flow state', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const packetId = addPacket(dbPath);
      const handoffId = createHandoffFromPacket(dbPath, packetId);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      createRoutedItem(handoffStore, queueStore, routingStore, handoffId);

      const result = flowInspect(flowStore, routingStore, supervisorStore, queueStore);
      expect(result.ok).toBe(true);
      expect(result.lanes.length).toBe(4);
      expect(result.overflow.length).toBe(0);

      db.close();
    });

    it('returns lane-specific flow state', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const { db, flowStore, routingStore, supervisorStore, queueStore } = openAllStores(dbPath);

      const result = laneInspect(flowStore, routingStore, supervisorStore, queueStore, 'reviewer');
      expect(result.ok).toBe(true);
      expect(result.state.lane).toBe('reviewer');
      expect(result.admission.ok).toBe(true);

      db.close();
    });
  });

  // ── End-to-end flows ──────────────────────────────────────────

  describe('E2E', () => {
    it('item denied by cap → overflow → capacity freed → resurfaced', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt1 = addPacket(dbPath);
      const h1 = createHandoffFromPacket(dbPath, pkt1);
      const pkt2 = addPacket(dbPath);
      const h2 = createHandoffFromPacket(dbPath, pkt2);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      // Set cap = 1
      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'admin', reason: 'tight capacity',
      });

      // Fill lane
      const item1 = createRoutedItem(handoffStore, queueStore, routingStore, h1);
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId, actor: 'actor-1',
      });

      // Second item — admission denied
      const admission = checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(admission.ok).toBe(false);

      // Enter overflow
      const item2 = createRoutedItem(handoffStore, queueStore, routingStore, h2);
      enterOverflow(flowStore, routingStore, supervisorStore, item2.queueItemId, 'reviewer', 'lane full', 'system');
      expect(flowStore.countOverflow('reviewer')).toBe(1);

      // Release first item → free capacity
      releaseClaim(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId, actor: 'actor-1', reason: 'done',
      });
      recordCapacityFreed(flowStore, routingStore, supervisorStore, 'reviewer', item1.queueItemId, 'claim_released', 'actor-1');

      // Resurface overflow
      const resurfaced = resurfaceOverflow(flowStore, routingStore, supervisorStore, queueStore);
      expect(resurfaced).toBe(1);
      expect(flowStore.countOverflow('reviewer')).toBe(0);

      // Admission now open
      expect(checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer').ok).toBe(true);

      // Audit trail complete
      const allEvents = flowStore.getEvents();
      const kinds = allEvents.map(e => e.kind);
      expect(kinds).toContain('cap_set');
      expect(kinds).toContain('overflow_entered');
      expect(kinds).toContain('capacity_freed');
      expect(kinds).toContain('overflow_exited');

      db.close();
    });

    it('starvation detection under load', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt1 = addPacket(dbPath);
      const h1 = createHandoffFromPacket(dbPath, pkt1);
      const pkt2 = addPacket(dbPath);
      const h2 = createHandoffFromPacket(dbPath, pkt2);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      // Create multiple items
      const item1 = createRoutedItem(handoffStore, queueStore, routingStore, h1);
      const item2 = createRoutedItem(handoffStore, queueStore, routingStore, h2);

      // Claim one, leave other pending
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId, actor: 'actor-1',
      });

      // Use 0ms threshold — unclaimed items are starved
      const starved = detectStarvation(queueStore, routingStore, supervisorStore, 0);
      expect(starved.length).toBe(1);
      expect(starved[0].queueItemId).toBe(item2.queueItemId);

      // Record starvation
      const count = recordStarvation(flowStore, routingStore, supervisorStore, starved);
      expect(count).toBe(1);

      // Full flow inspect shows starvation
      const result = flowInspect(flowStore, routingStore, supervisorStore, queueStore, {
        starvationThresholdMs: 0,
      });
      expect(result.starved.length).toBe(1);

      db.close();
    });

    it('full lifecycle: cap set → fill → overflow → release → resurface → reconcile', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt1 = addPacket(dbPath);
      const h1 = createHandoffFromPacket(dbPath, pkt1);
      const pkt2 = addPacket(dbPath);
      const h2 = createHandoffFromPacket(dbPath, pkt2);
      const pkt3 = addPacket(dbPath);
      const h3 = createHandoffFromPacket(dbPath, pkt3);
      const { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore } = openAllStores(dbPath);

      // 1. Set tight cap
      setLaneCap(flowStore, routingStore, supervisorStore, {
        lane: 'reviewer', cap: 2, actor: 'admin', reason: 'small team',
      });

      // 2. Fill to capacity
      const item1 = createRoutedItem(handoffStore, queueStore, routingStore, h1);
      const item2 = createRoutedItem(handoffStore, queueStore, routingStore, h2);
      claimQueueItem(queueStore, supervisorStore, { queueItemId: item1.queueItemId, actor: 'a1' });
      claimQueueItem(queueStore, supervisorStore, { queueItemId: item2.queueItemId, actor: 'a2' });

      // 3. Lane is saturated
      let state = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(state.flowStatus).toBe('saturated');
      expect(state.activeCount).toBe(2);

      // 4. Admission denied
      expect(checkAdmission(flowStore, routingStore, supervisorStore, 'reviewer').ok).toBe(false);

      // 5. Overflow item
      const item3 = createRoutedItem(handoffStore, queueStore, routingStore, h3);
      enterOverflow(flowStore, routingStore, supervisorStore, item3.queueItemId, 'reviewer', 'full', 'system');
      state = computeLaneState(flowStore, routingStore, supervisorStore, 'reviewer');
      expect(state.flowStatus).toBe('overflowing');

      // 6. Release one claim
      releaseClaim(queueStore, supervisorStore, { queueItemId: item1.queueItemId, actor: 'a1', reason: 'done' });
      recordCapacityFreed(flowStore, routingStore, supervisorStore, 'reviewer', item1.queueItemId, 'claim_released', 'a1');

      // 7. Resurface overflow
      const resurfaced = resurfaceOverflow(flowStore, routingStore, supervisorStore, queueStore);
      expect(resurfaced).toBe(1);

      // 8. Reconcile
      const reconciled = reconcileLaneCounts(flowStore, routingStore, supervisorStore);
      const reviewerState = reconciled.find(s => s.lane === 'reviewer')!;
      expect(reviewerState.activeCount).toBe(1); // only a2 still claimed
      expect(reviewerState.overflowCount).toBe(0);
      expect(reviewerState.flowStatus).toBe('open');

      db.close();
    });
  });
});
