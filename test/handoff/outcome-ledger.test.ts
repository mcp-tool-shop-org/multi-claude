/**
 * Outcome Ledger — Phase 10 tests.
 *
 * Tests deterministic outcome closure, effectiveness tracking, and replay:
 *   - Open outcome from queue item
 *   - Close outcome with approval resolution
 *   - Close outcome with rejection resolution
 *   - Close outcome with recovery resolution
 *   - Invalidated/superseded items close lawfully
 *   - Deferred/rerouted items remain open until true closure
 *   - Outcome duration computed deterministically
 *   - Churn counters accumulate correctly
 *   - Intervention-assisted closure marked correctly
 *   - Policy version bound at closure
 *   - Replay timeline shows full lifecycle
 *   - Replay is read-only
 *   - E2E: queue → claim → approve → outcome
 *   - E2E: queue → defer → reroute → approve → outcome
 *   - E2E: policy change mid-lifecycle → closure attributable
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
import { PolicyStore } from '../../src/handoff/policy/policy-store.js';
import { OutcomeStore } from '../../src/handoff/outcome/outcome-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { enqueueDecisionBrief } from '../../src/handoff/queue/derive-queue-item.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import { createInitialRoute, rerouteItem } from '../../src/handoff/routing/routing-actions.js';
import { claimQueueItem, releaseClaim, deferClaim } from '../../src/handoff/supervisor/supervisor-actions.js';
import { actOnQueueItem } from '../../src/handoff/queue/queue-actions.js';
import { createPolicySet, activatePolicy } from '../../src/handoff/policy/policy-actions.js';
import { DEFAULT_POLICY_CONTENT } from '../../src/handoff/policy/types.js';
import {
  openOutcome,
  closeOutcome,
  deriveResolutionQuality,
  deriveResolutionTerminal,
  buildReplayTimeline,
} from '../../src/handoff/outcome/outcome-actions.js';
import { outcomeInspect, outcomeByQueueItem, outcomeReplay } from '../../src/handoff/api/outcome-api.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let pktCounter = 2000; // offset to avoid collision with other test files

function seedDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-oc', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-20T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-oc', 'test-repo', 'Outcome test', 'Test outcome ledger', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.close();
  return dbPath;
}

function addPacket(dbPath: string): string {
  pktCounter++;
  const packetId = `pkt-oc-${pktCounter}`;
  const db = openDb(dbPath);
  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      ?, 'feat-oc', 'Outcome test packet', 'backend', ?, 'builder', 'pb-builder',
      'failed', 'Test outcome', '["src/**"]', '["src/secrets/**"]',
      'vp-oc', 'declare', 0, 'test'
    )
  `).run(packetId, `oc-desc-${pktCounter}`);
  db.close();
  return packetId;
}

function createHandoffFromPacket(dbPath: string, packetId: string): string {
  const db = openDb(dbPath);
  try {
    const store = new HandoffStore(db);
    const bridge = bridgeExecutionPacket({ db, packetId, runId: `run-oc-${pktCounter}` });
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
  const policyStore = new PolicyStore(db);
  policyStore.migrate();
  const outcomeStore = new OutcomeStore(db);
  outcomeStore.migrate();
  return { db, handoffStore, queueStore, supervisorStore, routingStore, flowStore, interventionStore, policyStore, outcomeStore };
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

// ── Tests ────────────────────────────────────────────────────────────

describe('Outcome Ledger — Phase 10', () => {

  // ── Open outcome ─────────────────────────────────────────────────

  it('opens outcome from queue item', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    const result = openOutcome(stores.outcomeStore, stores.queueStore, {
      queueItemId: item.queueItemId,
      actor: 'test',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe('open');
      expect(result.outcome.queueItemId).toBe(item.queueItemId);
      expect(result.outcome.handoffId).toBe(item.handoffId);
      expect(result.outcome.finalAction).toBeNull();
    }
    stores.db.close();
  });

  it('open is idempotent', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    const r1 = openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });
    const r2 = openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.outcome.outcomeId).toBe(r2.outcome.outcomeId);
    }
    stores.db.close();
  });

  it('open rejects missing queue item', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const stores = openAllStores(dbPath);

    const result = openOutcome(stores.outcomeStore, stores.queueStore, {
      queueItemId: 'qi-missing',
      actor: 'test',
    });
    expect(result.ok).toBe(false);
    stores.db.close();
  });

  // ── Close outcome ────────────────────────────────────────────────

  it('closes outcome with approved resolution', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      {
        queueItemId: item.queueItemId,
        finalAction: 'approve',
        finalStatus: 'approved',
        resolutionTerminal: 'approved',
        closedBy: 'reviewer-1',
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe('closed');
      expect(result.outcome.resolutionTerminal).toBe('approved');
      expect(result.outcome.resolutionQuality).toBe('clean');
      expect(result.outcome.closedBy).toBe('reviewer-1');
      expect(result.outcome.durationMs).not.toBeNull();
      expect(result.outcome.durationMs!).toBeGreaterThanOrEqual(0);
    }
    stores.db.close();
  });

  it('closes outcome with rejected resolution', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      {
        queueItemId: item.queueItemId,
        finalAction: 'reject',
        finalStatus: 'rejected',
        resolutionTerminal: 'rejected',
        closedBy: 'reviewer-1',
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.resolutionTerminal).toBe('rejected');
    }
    stores.db.close();
  });

  it('closes outcome with recovered resolution', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      {
        queueItemId: item.queueItemId,
        finalAction: 'request-recovery',
        finalStatus: 'recovery_requested',
        resolutionTerminal: 'recovered',
        closedBy: 'system',
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.resolutionTerminal).toBe('recovered');
      expect(result.outcome.resolutionQuality).toBe('recovery_heavy');
    }
    stores.db.close();
  });

  it('closure is idempotent — rejects double close', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });
    closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    const dup = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('already_closed');
    stores.db.close();
  });

  it('close without open returns not_found', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const stores = openAllStores(dbPath);

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: 'qi-missing', finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
    stores.db.close();
  });

  // ── Resolution derivation ────────────────────────────────────────

  it('deriveResolutionTerminal maps statuses correctly', () => {
    expect(deriveResolutionTerminal('approved')).toBe('approved');
    expect(deriveResolutionTerminal('rejected')).toBe('rejected');
    expect(deriveResolutionTerminal('recovery_requested')).toBe('recovered');
    expect(deriveResolutionTerminal('cleared')).toBe('superseded');
    expect(deriveResolutionTerminal('unknown')).toBe('abandoned');
  });

  it('deriveResolutionQuality identifies clean path', () => {
    const quality = deriveResolutionQuality('approved', {
      claimCount: 1, deferCount: 0, rerouteCount: 0, escalationCount: 0,
      overflowCount: 0, interventionCount: 0, recoveryCycleCount: 0, claimChurnCount: 0,
    });
    expect(quality).toBe('clean');
  });

  it('deriveResolutionQuality identifies churn-heavy path', () => {
    const quality = deriveResolutionQuality('approved', {
      claimCount: 4, deferCount: 2, rerouteCount: 0, escalationCount: 0,
      overflowCount: 0, interventionCount: 0, recoveryCycleCount: 0, claimChurnCount: 0,
    });
    expect(quality).toBe('churn_heavy');
  });

  it('deriveResolutionQuality identifies intervention-assisted', () => {
    const quality = deriveResolutionQuality('approved', {
      claimCount: 1, deferCount: 0, rerouteCount: 0, escalationCount: 0,
      overflowCount: 0, interventionCount: 2, recoveryCycleCount: 0, claimChurnCount: 0,
    });
    expect(quality).toBe('intervention_assisted');
  });

  it('deriveResolutionQuality identifies recovery-heavy', () => {
    const quality = deriveResolutionQuality('recovered', {
      claimCount: 1, deferCount: 0, rerouteCount: 0, escalationCount: 0,
      overflowCount: 0, interventionCount: 0, recoveryCycleCount: 1, claimChurnCount: 0,
    });
    expect(quality).toBe('recovery_heavy');
  });

  // ── Churn counters ───────────────────────────────────────────────

  it('churn counters accumulate from supervisor events', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    // Claim and release (creates claim churn)
    const claim1 = claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', leaseDurationMs: 15 * 60 * 1000,
    });
    expect(claim1.ok).toBe(true);
    if (claim1.ok) {
      releaseClaim(stores.queueStore, stores.supervisorStore, {
        queueItemId: item.queueItemId, actor: 'reviewer-1', reason: 'needs more context',
      });
    }

    // Claim again
    claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-2', leaseDurationMs: 15 * 60 * 1000,
    });

    // Close
    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'reviewer-2' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2 claims (claimed + reclaimed counted separately by supervisor events)
      expect(result.outcome.claimCount).toBeGreaterThanOrEqual(2);
    }
    stores.db.close();
  });

  it('reroute counter accumulates from routing events', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    // Reroute
    rerouteItem(stores.queueStore, stores.routingStore, {
      queueItemId: item.queueItemId, toLane: 'approver', reasonCode: 'manual_reroute', actor: 'test', reason: 'promote',
    });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.rerouteCount).toBe(1);
      expect(result.outcome.resolutionQuality).toBe('clean'); // 1 reroute alone isn't churn-heavy
    }
    stores.db.close();
  });

  // ── Policy binding ───────────────────────────────────────────────

  it('binds active policy version at closure', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    // Create and activate a policy
    const ps = createPolicySet(stores.policyStore, {
      content: DEFAULT_POLICY_CONTENT, reason: 'test policy', actor: 'admin',
    });
    expect(ps.ok).toBe(true);
    if (ps.ok) {
      activatePolicy(stores.policyStore, { policySetId: ps.policySet.policySetId, actor: 'admin', reason: 'go live' });
    }

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(result.ok).toBe(true);
    if (result.ok && ps.ok) {
      expect(result.outcome.policySetId).toBe(ps.policySet.policySetId);
      expect(result.outcome.policyVersion).toBe(ps.policySet.policyVersion);
    }
    stores.db.close();
  });

  it('detects policy change during lifecycle', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    // Activate a policy AFTER the outcome was opened
    const ps = createPolicySet(stores.policyStore, {
      content: DEFAULT_POLICY_CONTENT, reason: 'mid-flight policy', actor: 'admin',
    });
    if (ps.ok) {
      activatePolicy(stores.policyStore, { policySetId: ps.policySet.policySetId, actor: 'admin', reason: 'mid-flight' });
    }

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.policyChangedDuringLifecycle).toBe(true);
    }
    stores.db.close();
  });

  // ── Replay ───────────────────────────────────────────────────────

  it('replay timeline shows queue entry', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );

    expect(timeline).not.toBeNull();
    expect(timeline!.entries.length).toBeGreaterThan(0);
    expect(timeline!.entries[0].kind).toBe('queue_entry');
    expect(timeline!.queueItemId).toBe(item.queueItemId);
    stores.db.close();
  });

  it('replay includes claims and releases', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    // Claim and release
    claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', leaseDurationMs: 15 * 60 * 1000,
    });
    releaseClaim(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', reason: 'step away',
    });

    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );

    const kinds = timeline!.entries.map(e => e.kind);
    expect(kinds).toContain('claim');
    expect(kinds).toContain('release');
    stores.db.close();
  });

  it('replay includes reroutes', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    rerouteItem(stores.queueStore, stores.routingStore, {
      queueItemId: item.queueItemId, toLane: 'approver', reasonCode: 'manual_reroute', actor: 'test', reason: 'promote',
    });

    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );

    const kinds = timeline!.entries.map(e => e.kind);
    expect(kinds).toContain('reroute');
    stores.db.close();
  });

  it('replay is read-only — calling twice gives same result', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const t1 = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );
    const t2 = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );

    expect(t1!.entries.length).toBe(t2!.entries.length);
    for (let i = 0; i < t1!.entries.length; i++) {
      expect(t1!.entries[i].kind).toBe(t2!.entries[i].kind);
      expect(t1!.entries[i].timestamp).toBe(t2!.entries[i].timestamp);
    }
    stores.db.close();
  });

  it('replay returns null for missing queue item', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const stores = openAllStores(dbPath);

    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      'qi-missing',
    );
    expect(timeline).toBeNull();
    stores.db.close();
  });

  // ── API ──────────────────────────────────────────────────────────

  it('outcomeInspect returns outcome + events', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    const opened = openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const result = outcomeInspect(stores.outcomeStore, opened.outcome.outcomeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.outcomeId).toBe(opened.outcome.outcomeId);
      expect(result.events.length).toBeGreaterThan(0);
    }
    stores.db.close();
  });

  it('outcomeByQueueItem finds outcome', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = outcomeByQueueItem(stores.outcomeStore, item.queueItemId);
    expect(result.ok).toBe(true);
    stores.db.close();
  });

  it('outcomeReplay API wraps timeline', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const result = outcomeReplay(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timeline.queueItemId).toBe(item.queueItemId);
    }
    stores.db.close();
  });

  // ── End-to-end ───────────────────────────────────────────────────

  it('E2E: queue → claim → approve → closed outcome', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    // Queue + open outcome
    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'system' });

    // Claim
    claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', leaseDurationMs: 15 * 60 * 1000,
    });

    // Act on queue item (approve)
    actOnQueueItem(stores.handoffStore, stores.queueStore, {
      queueItemId: item.queueItemId, action: 'approve', actor: 'reviewer-1', reason: 'Looks good',
    });

    // Close outcome
    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'reviewer-1' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe('closed');
      expect(result.outcome.resolutionTerminal).toBe('approved');
      expect(result.outcome.resolutionQuality).toBe('clean');
      expect(result.outcome.claimCount).toBe(1);
    }

    // Replay shows full lifecycle
    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );
    expect(timeline!.entries.length).toBeGreaterThan(1);
    expect(timeline!.summary).toContain('approved');

    stores.db.close();
  });

  it('E2E: queue → defer → reroute → approve → churn-heavy outcome', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'system' });

    // Claim → defer
    claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', leaseDurationMs: 15 * 60 * 1000,
    });
    deferClaim(stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-1', deferredUntil: new Date(Date.now() + 1000).toISOString(), reason: 'busy',
    });

    // Reroute
    rerouteItem(stores.queueStore, stores.routingStore, {
      queueItemId: item.queueItemId, toLane: 'approver', reasonCode: 'manual_reroute', actor: 'test', reason: 'escalate',
    });

    // Reroute again
    rerouteItem(stores.queueStore, stores.routingStore, {
      queueItemId: item.queueItemId, toLane: 'reviewer', reasonCode: 'manual_reroute', actor: 'test', reason: 'de-escalate',
    });

    // Final claim + approve
    claimQueueItem(stores.queueStore, stores.supervisorStore, {
      queueItemId: item.queueItemId, actor: 'reviewer-2', leaseDurationMs: 15 * 60 * 1000,
    });
    actOnQueueItem(stores.handoffStore, stores.queueStore, {
      queueItemId: item.queueItemId, action: 'approve', actor: 'reviewer-2', reason: 'OK now',
    });

    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'reviewer-2' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.deferCount).toBeGreaterThanOrEqual(1);
      expect(result.outcome.rerouteCount).toBe(2);
      expect(result.outcome.resolutionQuality).toBe('churn_heavy');
    }

    // Verify replay captures all events
    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );
    const kinds = timeline!.entries.map(e => e.kind);
    expect(kinds).toContain('claim');
    expect(kinds).toContain('defer');
    expect(kinds).toContain('reroute');

    stores.db.close();
  });

  it('E2E: policy change mid-lifecycle → closure still attributable', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    // Create item + open outcome
    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'system' });

    // Activate policy v1
    const ps1 = createPolicySet(stores.policyStore, { content: DEFAULT_POLICY_CONTENT, reason: 'v1', actor: 'admin' });
    if (ps1.ok) activatePolicy(stores.policyStore, { policySetId: ps1.policySet.policySetId, actor: 'admin', reason: 'go live' });

    // Activate policy v2 (supersedes v1 — policy change during lifecycle)
    const ps2 = createPolicySet(stores.policyStore, {
      content: { ...DEFAULT_POLICY_CONTENT, recoveryThrottle: 10 }, reason: 'v2', actor: 'admin',
    });
    if (ps2.ok) activatePolicy(stores.policyStore, { policySetId: ps2.policySet.policySetId, actor: 'admin', reason: 'upgrade' });

    // Close
    const result = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    expect(result.ok).toBe(true);
    if (result.ok && ps2.ok) {
      expect(result.outcome.policyChangedDuringLifecycle).toBe(true);
      expect(result.outcome.policySetId).toBe(ps2.policySet.policySetId);
      expect(result.outcome.policyVersion).toBe(ps2.policySet.policyVersion);
    }

    // Replay shows policy changes
    const timeline = buildReplayTimeline(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      item.queueItemId,
    );
    const policyChanges = timeline!.entries.filter(e => e.kind === 'policy_change');
    expect(policyChanges.length).toBeGreaterThanOrEqual(1);

    stores.db.close();
  });

  // ── List / filter ────────────────────────────────────────────────

  it('listOutcomes filters by status', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    const openList = stores.outcomeStore.listOutcomes({ status: 'open' });
    expect(openList.length).toBe(1);
    const closedList = stores.outcomeStore.listOutcomes({ status: 'closed' });
    expect(closedList.length).toBe(0);

    stores.db.close();
  });

  it('closed outcomes are immutable snapshots', () => {
    const dbPath = tempDbPath();
    seedDb(dbPath);
    const pkt = addPacket(dbPath);
    const hId = createHandoffFromPacket(dbPath, pkt);
    const stores = openAllStores(dbPath);

    const item = createRoutedItem(stores.handoffStore, stores.queueStore, stores.routingStore, hId);
    openOutcome(stores.outcomeStore, stores.queueStore, { queueItemId: item.queueItemId, actor: 'test' });

    closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'approve', finalStatus: 'approved', resolutionTerminal: 'approved', closedBy: 'test' },
    );

    // Read the closed outcome
    const o1 = stores.outcomeStore.getOutcomeByQueueItem(item.queueItemId);
    expect(o1).toBeDefined();
    expect(o1!.status).toBe('closed');

    // Second close attempt fails
    const dup = closeOutcome(
      stores.outcomeStore, stores.queueStore, stores.supervisorStore,
      stores.routingStore, stores.flowStore, stores.interventionStore, stores.policyStore,
      { queueItemId: item.queueItemId, finalAction: 'reject', finalStatus: 'rejected', resolutionTerminal: 'rejected', closedBy: 'test' },
    );
    expect(dup.ok).toBe(false);

    // Original outcome unchanged
    const o2 = stores.outcomeStore.getOutcomeByQueueItem(item.queueItemId);
    expect(o2!.resolutionTerminal).toBe('approved'); // not rejected

    stores.db.close();
  });
});
