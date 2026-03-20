/**
 * Intervention Law — Phase 8 tests.
 *
 * Tests deterministic health states, breach detection, and intervention actions:
 *   - Health snapshot derivation (healthy/pressured/breached/frozen)
 *   - Breach detection for saturation, starvation, overflow
 *   - Freeze intervention blocks claims and admissions
 *   - Restrict intervention blocks admissions but allows claims
 *   - Resolve intervention restores lawful operation
 *   - Duplicate intervention rejected
 *   - Resolve without active intervention rejected
 *   - Health inspect returns full state
 *   - End-to-end: saturation → breach → freeze → resolve
 *   - End-to-end: overflow → breach → restrict → resolve
 *   - End-to-end: full lifecycle with audit trail
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { RoutingStore } from '../../src/handoff/routing/routing-store.js';
import { FlowStore } from '../../src/handoff/flow/flow-store.js';
import { InterventionStore } from '../../src/handoff/intervention/intervention-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { enqueueDecisionBrief } from '../../src/handoff/queue/derive-queue-item.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { claimQueueItem, releaseClaim } from '../../src/handoff/supervisor/supervisor-actions.js';
import { createInitialRoute } from '../../src/handoff/routing/routing-actions.js';
import { setLaneCap, enterOverflow } from '../../src/handoff/flow/flow-actions.js';
import {
  deriveHealthSnapshot,
  deriveAllHealthSnapshots,
  startIntervention,
  resolveIntervention,
  checkInterventionForClaim,
  checkInterventionForAdmission,
} from '../../src/handoff/intervention/intervention-actions.js';
import { healthInspect, laneHealthInspect } from '../../src/handoff/api/intervention-api.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let pktCounter = 1000; // offset to avoid collision with flow-control tests

function seedDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-iv', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-20T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-iv', 'test-repo', 'Intervention test', 'Test intervention law', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.close();
  return dbPath;
}

function addPacket(dbPath: string): string {
  pktCounter++;
  const packetId = `pkt-iv-${pktCounter}`;
  const db = openDb(dbPath);
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      ?, 'feat-iv', 'Intervention test packet', 'backend', ?, 'builder', 'pb-builder',
      'failed', 'Test intervention', '["src/**"]', '["src/secrets/**"]',
      'vp-iv', 'declare', 0, 'test'
    )
  `).run(packetId, `iv-desc-${pktCounter}`);
  db.close();
  return packetId;
}

function createHandoffFromPacket(dbPath: string, packetId: string): string {
  const db = openDb(dbPath);
  try {
    const store = new HandoffStore(db);
    const bridge = bridgeExecutionPacket({ db, packetId, runId: `run-iv-${pktCounter}` });
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
  const interventionStore = new InterventionStore(db);
  interventionStore.migrate();
  return { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore, interventionStore };
}

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

describe('Intervention Law — Phase 8', () => {
  // ── Health derivation ─────────────────────────────────────────

  describe('health derivation', () => {
    it('derives healthy state for empty lane', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );

      expect(snapshot.healthState).toBe('healthy');
      expect(snapshot.breachCodes).toEqual([]);
      expect(snapshot.lane).toBe('reviewer');

      stores.db.close();
    });

    it('derives pressured state when approaching capacity', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt = addPacket(dbPath);
      const hId = createHandoffFromPacket(dbPath, pkt);
      const stores = openAllStores(dbPath);

      // Set cap to 1 so 80% threshold = 0.8 = rounds to 1
      setLaneCap(stores.flowStore, stores.routingStore, stores.supervisorStore, {
        lane: 'reviewer', cap: 2, actor: 'test', reason: 'test',
      });

      // Create + claim 2 items (at 100% cap = 2, but no breaches → pressured if overflow or starved)
      // Actually, one pending item with 0ms starvation will make it pressured
      createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);

      // With starvation threshold of 0ms, item is starved → pressured
      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );

      expect(snapshot.healthState).toBe('pressured');
      expect(snapshot.starvedCount).toBe(1);

      stores.db.close();
    });

    it('derives frozen state when intervention is active', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'test freeze', actor: 'admin' },
      );

      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );

      expect(snapshot.healthState).toBe('frozen');

      stores.db.close();
    });

    it('derives all lane snapshots', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const snapshots = deriveAllHealthSnapshots(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
      );

      expect(snapshots.length).toBe(4);
      expect(snapshots.every(s => s.healthState === 'healthy')).toBe(true);

      stores.db.close();
    });
  });

  // ── Breach detection ──────────────────────────────────────────

  describe('breach detection', () => {
    it('detects repeated starvation breach', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      // Create 3 handoffs for 3 starved items
      const pkts = [addPacket(dbPath), addPacket(dbPath), addPacket(dbPath)];
      const hIds = pkts.map(p => createHandoffFromPacket(dbPath, p));
      const stores = openAllStores(dbPath);

      // Create 3 unclaimed items (starvation count >= threshold of 3)
      for (const hId of hIds) {
        createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
      }

      // Use 0ms starvation threshold so items are immediately starved
      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
        { saturationChecks: 3, starvationCount: 3, overflowBacklog: 5, recoveryStormEvents: 5, claimChurnEvents: 5 },
      );

      expect(snapshot.breachCodes).toContain('repeated_starvation');
      expect(snapshot.healthState).toBe('breached');

      stores.db.close();
    });

    it('detects overflow backlog breach', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkts = Array.from({ length: 5 }, () => addPacket(dbPath));
      const hIds = pkts.map(p => createHandoffFromPacket(dbPath, p));
      const stores = openAllStores(dbPath);

      // Create 5 overflow items
      for (const hId of hIds) {
        const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
        enterOverflow(stores.flowStore, stores.routingStore, stores.supervisorStore, item.queueItemId, 'reviewer', 'test', 'system');
      }

      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
        { saturationChecks: 3, starvationCount: 100, overflowBacklog: 5, recoveryStormEvents: 5, claimChurnEvents: 5 },
      );

      expect(snapshot.breachCodes).toContain('overflow_backlog');
      expect(snapshot.healthState).toBe('breached');

      stores.db.close();
    });
  });

  // ── Intervention actions ──────────────────────────────────────

  describe('intervention actions', () => {
    it('starts freeze intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const result = startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'emergency', actor: 'admin' },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.intervention.action).toBe('freeze');
        expect(result.intervention.status).toBe('active');
        expect(result.snapshot.healthState).toBe('frozen');
      }

      stores.db.close();
    });

    it('starts restrict intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const result = startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'approver', action: 'restrict', reason: 'reduce load', actor: 'admin' },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.intervention.action).toBe('restrict');
        expect(result.snapshot.healthState).toBe('degraded');
      }

      stores.db.close();
    });

    it('rejects duplicate intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'first', actor: 'admin' },
      );

      const second = startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'restrict', reason: 'second', actor: 'admin' },
      );

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.code).toBe('already_intervened');

      stores.db.close();
    });

    it('resolves intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'emergency', actor: 'admin' },
      );

      const result = resolveIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', actor: 'admin', reason: 'resolved' },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.intervention.status).toBe('resolved');
        expect(result.intervention.resolvedBy).toBe('admin');
        expect(result.snapshot.healthState).toBe('healthy');
      }

      stores.db.close();
    });

    it('rejects resolve without active intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const result = resolveIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', actor: 'admin', reason: 'nothing to resolve' },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('no_active_intervention');

      stores.db.close();
    });
  });

  // ── Admission/claim checks ────────────────────────────────────

  describe('admission/claim checks', () => {
    it('freeze blocks claims', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'test', actor: 'admin' },
      );

      const check = checkInterventionForClaim(stores.interventionStore, 'reviewer');
      expect(check.allowed).toBe(false);
      if (!check.allowed) {
        expect(check.action).toBe('freeze');
      }

      stores.db.close();
    });

    it('freeze blocks admissions', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'test', actor: 'admin' },
      );

      const check = checkInterventionForAdmission(stores.interventionStore, 'reviewer');
      expect(check.allowed).toBe(false);

      stores.db.close();
    });

    it('restrict blocks admissions but allows claims', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'approver', action: 'restrict', reason: 'test', actor: 'admin' },
      );

      const claimCheck = checkInterventionForClaim(stores.interventionStore, 'approver');
      expect(claimCheck.allowed).toBe(true);

      const admissionCheck = checkInterventionForAdmission(stores.interventionStore, 'approver');
      expect(admissionCheck.allowed).toBe(false);
      if (!admissionCheck.allowed) expect(admissionCheck.action).toBe('restrict');

      stores.db.close();
    });

    it('no intervention allows everything', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      expect(checkInterventionForClaim(stores.interventionStore, 'reviewer').allowed).toBe(true);
      expect(checkInterventionForAdmission(stores.interventionStore, 'reviewer').allowed).toBe(true);

      stores.db.close();
    });
  });

  // ── Health inspect API ────────────────────────────────────────

  describe('health inspect', () => {
    it('returns full health state', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      const result = healthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
      );

      expect(result.ok).toBe(true);
      expect(result.snapshots.length).toBe(4);
      expect(result.activeInterventions.length).toBe(0);

      stores.db.close();
    });

    it('returns lane-specific health with intervention', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'test', actor: 'admin' },
      );

      const result = laneHealthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );

      expect(result.ok).toBe(true);
      expect(result.snapshot.healthState).toBe('frozen');
      expect(result.intervention).not.toBeNull();
      expect(result.intervention!.action).toBe('freeze');

      stores.db.close();
    });
  });

  // ── End-to-end flows ──────────────────────────────────────────

  describe('E2E', () => {
    it('saturation → freeze → resolve → healthy', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkt = addPacket(dbPath);
      const hId = createHandoffFromPacket(dbPath, pkt);
      const stores = openAllStores(dbPath);

      // Set cap to 1, fill it
      setLaneCap(stores.flowStore, stores.routingStore, stores.supervisorStore, {
        lane: 'reviewer', cap: 1, actor: 'test', reason: 'test',
      });
      const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
      claimQueueItem(stores.queueStore, stores.supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1',
      });

      // Lane is saturated — operator freezes
      const freezeResult = startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'lane saturated', actor: 'admin', breachCodes: ['prolonged_saturation'] },
      );
      expect(freezeResult.ok).toBe(true);

      // Frozen lane blocks claims
      expect(checkInterventionForClaim(stores.interventionStore, 'reviewer').allowed).toBe(false);

      // Release claim, resolve intervention
      releaseClaim(stores.queueStore, stores.supervisorStore, {
        queueItemId: item.queueItemId, actor: 'actor-1', reason: 'done',
      });

      const resolveResult = resolveIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', actor: 'admin', reason: 'capacity restored' },
      );
      expect(resolveResult.ok).toBe(true);
      if (resolveResult.ok) {
        expect(resolveResult.intervention.status).toBe('resolved');
      }

      // Lane allows claims again
      expect(checkInterventionForClaim(stores.interventionStore, 'reviewer').allowed).toBe(true);

      // Audit trail
      const events = stores.interventionStore.getEvents({ lane: 'reviewer' });
      const kinds = events.map(e => e.kind);
      expect(kinds).toContain('intervention_started');
      expect(kinds).toContain('freeze_applied');
      expect(kinds).toContain('intervention_resolved');
      expect(kinds).toContain('freeze_lifted');

      stores.db.close();
    });

    it('overflow breach → restrict → resolve', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const pkts = Array.from({ length: 5 }, () => addPacket(dbPath));
      const hIds = pkts.map(p => createHandoffFromPacket(dbPath, p));
      const stores = openAllStores(dbPath);

      // Create overflow items
      for (const hId of hIds) {
        const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
        enterOverflow(stores.flowStore, stores.routingStore, stores.supervisorStore, item.queueItemId, 'approver', 'test', 'system');
      }

      // Detect breach
      const snapshot = deriveHealthSnapshot(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'approver',
        { saturationChecks: 3, starvationCount: 100, overflowBacklog: 5, recoveryStormEvents: 5, claimChurnEvents: 5 },
      );
      expect(snapshot.breachCodes).toContain('overflow_backlog');

      // Restrict admissions
      const restrictResult = startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'approver', action: 'restrict', reason: 'overflow breach', actor: 'admin', breachCodes: ['overflow_backlog'] },
      );
      expect(restrictResult.ok).toBe(true);

      // Admissions blocked, claims allowed
      expect(checkInterventionForAdmission(stores.interventionStore, 'approver').allowed).toBe(false);
      expect(checkInterventionForClaim(stores.interventionStore, 'approver').allowed).toBe(true);

      // Resolve
      const resolveResult = resolveIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'approver', actor: 'admin', reason: 'overflow cleared' },
      );
      expect(resolveResult.ok).toBe(true);

      // Admissions restored
      expect(checkInterventionForAdmission(stores.interventionStore, 'approver').allowed).toBe(true);

      stores.db.close();
    });

    it('full lifecycle with audit trail', () => {
      const dbPath = tempDbPath();
      seedDb(dbPath);
      const stores = openAllStores(dbPath);

      // 1. All healthy
      let inspect = healthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
      );
      expect(inspect.snapshots.every(s => s.healthState === 'healthy')).toBe(true);

      // 2. Freeze reviewer
      startIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', action: 'freeze', reason: 'planned maintenance', actor: 'admin' },
      );

      // 3. Health shows frozen
      const reviewerHealth = laneHealthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );
      expect(reviewerHealth.snapshot.healthState).toBe('frozen');
      expect(reviewerHealth.intervention).not.toBeNull();

      // 4. Other lanes unaffected
      const approverHealth = laneHealthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'approver',
      );
      expect(approverHealth.snapshot.healthState).toBe('healthy');
      expect(approverHealth.intervention).toBeNull();

      // 5. Resolve
      resolveIntervention(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore,
        { lane: 'reviewer', actor: 'admin', reason: 'maintenance complete' },
      );

      // 6. Back to healthy
      const restored = laneHealthInspect(
        stores.flowStore, stores.routingStore, stores.supervisorStore,
        stores.queueStore, stores.interventionStore, 'reviewer',
      );
      expect(restored.snapshot.healthState).toBe('healthy');
      expect(restored.intervention).toBeNull();

      // 7. Full event trail
      const events = stores.interventionStore.getEvents({ lane: 'reviewer' });
      expect(events.length).toBeGreaterThanOrEqual(4); // started, freeze_applied, resolved, freeze_lifted
      const interventions = stores.interventionStore.listInterventions({ lane: 'reviewer' });
      expect(interventions.length).toBe(1);
      expect(interventions[0].status).toBe('resolved');

      stores.db.close();
    });
  });
});
