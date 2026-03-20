/**
 * Calibration Law — Phase 11 tests.
 *
 * Tests deterministic calibration from outcomes:
 *   - Policy fitness derivation from outcomes
 *   - Lane fitness derivation with routing
 *   - Pain detection at policy and lane level
 *   - Pain severity derivation
 *   - Policy adjustment proposals
 *   - Adjustment deduplication (highest confidence wins)
 *   - Full report assembly + persistence
 *   - Insufficient data guard
 *   - Report retrieval and listing
 *   - API layer (show, list)
 *   - E2E: outcomes → fitness → pain → adjustments → persisted report
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
import { CalibrationStore } from '../../src/handoff/calibration/calibration-store.js';
import { createPolicySet, activatePolicy } from '../../src/handoff/policy/policy-actions.js';
import { DEFAULT_POLICY_CONTENT } from '../../src/handoff/policy/types.js';
import { derivePolicyFitness } from '../../src/handoff/calibration/derive-policy-fitness.js';
import { deriveLaneFitness, deriveAllLaneFitness } from '../../src/handoff/calibration/derive-lane-fitness.js';
import { detectPolicyPain } from '../../src/handoff/calibration/detect-policy-pain.js';
import { proposePolicyAdjustments } from '../../src/handoff/calibration/propose-policy-adjustments.js';
import { buildCalibrationReport } from '../../src/handoff/calibration/build-calibration-report.js';
import { calibrationShow, calibrationList } from '../../src/handoff/api/calibration-api.js';
import { DEFAULT_CALIBRATION_THRESHOLDS } from '../../src/handoff/calibration/types.js';
import type { CalibrationThresholds } from '../../src/handoff/calibration/types.js';
import type { Outcome } from '../../src/handoff/outcome/types.js';
import type { RoutingLane } from '../../src/handoff/routing/types.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let counter = 3000; // offset to avoid collision with other test files

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
  return {
    db, handoffStore, queueStore, supervisorStore, routingStore,
    flowStore, interventionStore, policyStore, outcomeStore, calibrationStore,
  };
}

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  counter++;
  return {
    outcomeId: overrides.outcomeId ?? `oc-cal-${counter}`,
    queueItemId: overrides.queueItemId ?? `qi-cal-${counter}`,
    handoffId: overrides.handoffId ?? `ho-cal-${counter}`,
    packetVersion: overrides.packetVersion ?? 1,
    briefId: overrides.briefId ?? `br-cal-${counter}`,
    status: overrides.status ?? 'closed',
    finalAction: overrides.finalAction ?? 'approve',
    finalStatus: overrides.finalStatus ?? 'approved',
    resolutionTerminal: overrides.resolutionTerminal ?? 'approved',
    resolutionQuality: overrides.resolutionQuality ?? 'clean',
    policySetId: overrides.policySetId ?? 'ps-cal',
    policyVersion: overrides.policyVersion ?? 1,
    closedBy: overrides.closedBy ?? 'test-actor',
    openedAt: overrides.openedAt ?? '2026-03-20T00:00:00Z',
    closedAt: overrides.closedAt ?? '2026-03-20T01:00:00Z',
    durationMs: overrides.durationMs ?? 3600000,
    claimCount: overrides.claimCount ?? 1,
    deferCount: overrides.deferCount ?? 0,
    rerouteCount: overrides.rerouteCount ?? 0,
    escalationCount: overrides.escalationCount ?? 0,
    overflowCount: overrides.overflowCount ?? 0,
    interventionCount: overrides.interventionCount ?? 0,
    recoveryCycleCount: overrides.recoveryCycleCount ?? 0,
    claimChurnCount: overrides.claimChurnCount ?? 0,
    policyChangedDuringLifecycle: overrides.policyChangedDuringLifecycle ?? false,
  };
}

function seedOutcomes(outcomeStore: OutcomeStore, outcomes: Outcome[]) {
  for (const o of outcomes) {
    outcomeStore.insertOutcome(o);
  }
}

function seedRoute(routingStore: RoutingStore, queueItemId: string, lane: RoutingLane) {
  routingStore.insertRoute({
    routeId: `rt-${queueItemId}`,
    queueItemId,
    lane,
    assignedTarget: null,
    status: 'active',
    reasonCode: 'initial_derivation',
    reason: 'test seed',
    routedBy: 'test',
    routedAt: '2026-03-20T00:00:00Z',
    updatedAt: '2026-03-20T00:00:00Z',
  });
}

function seedPolicy(policyStore: PolicyStore): string {
  const result = createPolicySet(policyStore, {
    content: DEFAULT_POLICY_CONTENT,
    reason: 'Test policy',
    actor: 'test',
  });
  if (!result.ok) throw new Error('policy create failed');
  const policySetId = result.policySet.policySetId;
  activatePolicy(policyStore, { policySetId, actor: 'test', reason: 'Test activation' });
  return policySetId;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Calibration Law — Phase 11', () => {

  // ── Policy fitness derivation ───────────────────────────────────

  it('derives policy fitness from closed outcomes', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    const outcomes = [
      makeOutcome({ resolutionQuality: 'clean', durationMs: 60000 }),
      makeOutcome({ resolutionQuality: 'clean', durationMs: 120000 }),
      makeOutcome({ resolutionQuality: 'churn_heavy', durationMs: 180000, claimCount: 3, claimChurnCount: 2 }),
    ];
    seedOutcomes(stores.outcomeStore, outcomes);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);

    expect(fitness.closedOutcomes).toBe(3);
    expect(fitness.cleanRate).toBeCloseTo(2 / 3);
    expect(fitness.churnRate).toBeCloseTo(1 / 3);
    expect(fitness.recoveryRate).toBe(0);
    expect(fitness.interventionRate).toBe(0);
    expect(fitness.meanLeadTimeMs).toBe(120000);
    expect(fitness.totalClaims).toBe(5); // 1+1+3
    expect(fitness.totalClaimChurn).toBe(2);
    stores.db.close();
  });

  it('handles zero closed outcomes gracefully', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore, 'ps-empty');

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-empty', 1);

    expect(fitness.closedOutcomes).toBe(0);
    expect(fitness.cleanRate).toBe(0);
    expect(fitness.meanLeadTimeMs).toBeNull();
    stores.db.close();
  });

  it('includes open outcomes in totalOutcomes', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'clean' }),
      makeOutcome({ status: 'open', resolutionTerminal: null, resolutionQuality: null, closedAt: null, durationMs: null, finalAction: null, finalStatus: null, closedBy: null }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);

    expect(fitness.totalOutcomes).toBe(2);
    expect(fitness.closedOutcomes).toBe(1);
    expect(fitness.openOutcomes).toBe(1);
    stores.db.close();
  });

  it('computes timing percentiles', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    const durations = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];
    seedOutcomes(stores.outcomeStore, durations.map(d =>
      makeOutcome({ durationMs: d, resolutionQuality: 'clean' }),
    ));

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);

    expect(fitness.meanLeadTimeMs).toBe(55000);
    expect(fitness.medianLeadTimeMs).toBe(60000); // index 5 of 10
    expect(fitness.p95LeadTimeMs).toBe(100000); // index 9 of 10
    stores.db.close();
  });

  // ── Lane fitness derivation ─────────────────────────────────────

  it('derives lane fitness using routing association', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);

    const o1 = makeOutcome({ resolutionQuality: 'clean' });
    const o2 = makeOutcome({ resolutionQuality: 'churn_heavy', claimCount: 3 });
    seedOutcomes(stores.outcomeStore, [o1, o2]);
    seedRoute(stores.routingStore, o1.queueItemId, 'reviewer');
    seedRoute(stores.routingStore, o2.queueItemId, 'reviewer');

    const lf = deriveLaneFitness(stores.outcomeStore, stores.routingStore, 'reviewer');

    expect(lf.closedOutcomes).toBe(2);
    expect(lf.cleanRate).toBeCloseTo(0.5);
    expect(lf.churnRate).toBeCloseTo(0.5);
    expect(lf.totalClaims).toBe(4); // 1+3
    stores.db.close();
  });

  it('excludes outcomes routed to other lanes', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);

    const o1 = makeOutcome({ resolutionQuality: 'clean' });
    const o2 = makeOutcome({ resolutionQuality: 'churn_heavy' });
    seedOutcomes(stores.outcomeStore, [o1, o2]);
    seedRoute(stores.routingStore, o1.queueItemId, 'reviewer');
    seedRoute(stores.routingStore, o2.queueItemId, 'approver');

    const lf = deriveLaneFitness(stores.outcomeStore, stores.routingStore, 'reviewer');

    expect(lf.closedOutcomes).toBe(1);
    expect(lf.cleanRate).toBe(1);
    stores.db.close();
  });

  it('deriveAllLaneFitness covers all lanes', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);

    const all = deriveAllLaneFitness(stores.outcomeStore, stores.routingStore);

    expect(all.length).toBeGreaterThanOrEqual(3); // at least review, approval, recovery
    expect(all.every(lf => lf.closedOutcomes === 0)).toBe(true);
    stores.db.close();
  });

  // ── Pain detection ──────────────────────────────────────────────

  it('detects chronic churn pain signal', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    // 4 outcomes: 3 churn_heavy, 1 clean → churnRate = 0.75 > threshold 0.3
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'clean' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    const churn = signals.find(s => s.code === 'chronic_churn');
    expect(churn).toBeDefined();
    expect(churn!.severity).toBe('medium'); // 0.75/0.3 = 2.5x → medium
    expect(churn!.lane).toBeNull(); // policy-level
    expect(churn!.evidence.observedValue).toBeCloseTo(0.75);
    stores.db.close();
  });

  it('detects intervention dependency pain signal', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    // 3 outcomes: all intervention_assisted → rate 1.0 > threshold 0.15
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'intervention_assisted' }),
      makeOutcome({ resolutionQuality: 'intervention_assisted' }),
      makeOutcome({ resolutionQuality: 'intervention_assisted' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    const interv = signals.find(s => s.code === 'intervention_dependency');
    expect(interv).toBeDefined();
    expect(interv!.severity).toBe('high'); // 1.0/0.15 ≈ 6.7x → high
    stores.db.close();
  });

  it('detects slow resolution pain signal', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    const slowDuration = 3 * 60 * 60 * 1000; // 3 hours > 2 hour threshold
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ durationMs: slowDuration, resolutionQuality: 'clean' }),
      makeOutcome({ durationMs: slowDuration, resolutionQuality: 'clean' }),
      makeOutcome({ durationMs: slowDuration, resolutionQuality: 'clean' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    const slow = signals.find(s => s.code === 'slow_resolution');
    expect(slow).toBeDefined();
    expect(slow!.evidence.observedValue).toBe(slowDuration);
    stores.db.close();
  });

  it('does not detect pain when below thresholds', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'clean' }),
      makeOutcome({ resolutionQuality: 'clean' }),
      makeOutcome({ resolutionQuality: 'clean' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    expect(signals.length).toBe(0);
    stores.db.close();
  });

  it('detects lane-level cap too tight pain', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    // 3 outcomes in review lane with high overflow counts
    const outcomes = [
      makeOutcome({ overflowCount: 5, resolutionQuality: 'clean' }),
      makeOutcome({ overflowCount: 4, resolutionQuality: 'clean' }),
      makeOutcome({ overflowCount: 6, resolutionQuality: 'clean' }),
    ];
    seedOutcomes(stores.outcomeStore, outcomes);
    for (const o of outcomes) {
      seedRoute(stores.routingStore, o.queueItemId, 'reviewer');
    }

    const laneFitness = [deriveLaneFitness(stores.outcomeStore, stores.routingStore, 'reviewer')];
    const signals = detectPolicyPain(null, laneFitness, stores.outcomeStore, stores.routingStore);

    const capTight = signals.find(s => s.code === 'cap_too_tight');
    expect(capTight).toBeDefined();
    expect(capTight!.lane).toBe('reviewer');
    stores.db.close();
  });

  it('pain severity scales with observed/threshold ratio', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    // 3 churn_heavy out of 3 = 100% churn rate. 1.0/0.3 = 3.33x → high
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    const churn = signals.find(s => s.code === 'chronic_churn');
    expect(churn!.severity).toBe('high'); // 1.0/0.3 ≈ 3.3x → high (≥3)
    stores.db.close();
  });

  // ── Policy adjustment proposals ─────────────────────────────────

  it('proposes lease duration increase for chronic churn', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);
    const adjustments = proposePolicyAdjustments(stores.policyStore, signals, 'global');

    const leaseAdj = adjustments.find(a => a.kind === 'adjust_lease_duration');
    expect(leaseAdj).toBeDefined();
    expect(leaseAdj!.field).toBe('leaseDurationMs');
    expect(typeof leaseAdj!.currentValue).toBe('number');
    expect((leaseAdj!.proposedValue as number)).toBeGreaterThan(leaseAdj!.currentValue as number);
    stores.db.close();
  });

  it('proposes recovery throttle increase for excessive recovery', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'recovery_heavy' }),
      makeOutcome({ resolutionQuality: 'recovery_heavy' }),
      makeOutcome({ resolutionQuality: 'clean' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);
    const adjustments = proposePolicyAdjustments(stores.policyStore, signals, 'global');

    const throttleAdj = adjustments.find(a => a.kind === 'adjust_recovery_throttle');
    expect(throttleAdj).toBeDefined();
    expect(throttleAdj!.field).toBe('recoveryThrottle');
    stores.db.close();
  });

  it('proposes no adjustments when no pain signals', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    const adjustments = proposePolicyAdjustments(stores.policyStore, [], 'global');
    expect(adjustments.length).toBe(0);
    stores.db.close();
  });

  it('deduplicates adjustments keeping highest confidence', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    // Create two pain signals that both trigger lease duration adjustments
    // by having both chronic_churn signals (lane=null)
    // This won't naturally happen with the current code since churn only fires once
    // But we can verify by calling proposePolicyAdjustments with repeated signals
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
      makeOutcome({ resolutionQuality: 'churn_heavy' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    const signals = detectPolicyPain(fitness, [], stores.outcomeStore, stores.routingStore);

    // Duplicate the signal to test dedup
    const doubledSignals = [...signals, ...signals];
    const adjustments = proposePolicyAdjustments(stores.policyStore, doubledSignals, 'global');

    // Should be deduplicated — only one lease duration adjustment
    const leaseAdjs = adjustments.filter(a => a.kind === 'adjust_lease_duration');
    expect(leaseAdjs.length).toBe(1);
    stores.db.close();
  });

  // ── Report builder ──────────────────────────────────────────────

  it('builds and persists a calibration report', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', openedAt: '2026-03-19T10:00:00Z', closedAt: '2026-03-19T11:00:00Z' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', openedAt: '2026-03-19T12:00:00Z', closedAt: '2026-03-19T13:00:00Z' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'churn_heavy', openedAt: '2026-03-19T14:00:00Z', closedAt: '2026-03-19T15:00:00Z' }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    const r = result.report;

    expect(r.reportId).toMatch(/^cal-/);
    expect(r.policySetId).toBe(psId);
    expect(r.outcomeWindow.closedOutcomes).toBe(3);
    expect(r.policyFitness).not.toBeNull();
    expect(r.laneFitness.length).toBeGreaterThan(0);
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);

    // Verify persisted
    const persisted = stores.calibrationStore.getReport(r.reportId);
    expect(persisted).toBeDefined();
    expect(persisted!.reportId).toBe(r.reportId);
    stores.db.close();
  });

  it('rejects calibration with insufficient data', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    // Only 2 outcomes, threshold is 3
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unexpected');
    expect(result.code).toBe('insufficient_data');
    stores.db.close();
  });

  it('respects persist=false option', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
      { persist: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');

    const persisted = stores.calibrationStore.getReport(result.report.reportId);
    expect(persisted).toBeUndefined();
    stores.db.close();
  });

  it('builds report with custom thresholds', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    const customThresholds: CalibrationThresholds = {
      ...DEFAULT_CALIBRATION_THRESHOLDS,
      minOutcomesForCalibration: 5, // higher than we have
    };

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
      { thresholds: customThresholds },
    );

    expect(result.ok).toBe(false);
    stores.db.close();
  });

  it('filters by lane when specified', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    const outcomes = [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ];
    seedOutcomes(stores.outcomeStore, outcomes);
    for (const o of outcomes) {
      seedRoute(stores.routingStore, o.queueItemId, 'reviewer');
    }

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
      { lane: 'reviewer' as RoutingLane },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');
    expect(result.report.laneFitness.length).toBe(1);
    expect(result.report.laneFitness[0]!.lane).toBe('reviewer');
    stores.db.close();
  });

  // ── Calibration store ───────────────────────────────────────────

  it('lists reports with policy filter', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
      { policySetId: psId },
    );

    const all = stores.calibrationStore.listReports();
    expect(all.length).toBe(1);

    const filtered = stores.calibrationStore.listReports({ policySetId: psId });
    expect(filtered.length).toBe(1);

    const empty = stores.calibrationStore.listReports({ policySetId: 'ps-nonexistent' });
    expect(empty.length).toBe(0);
    stores.db.close();
  });

  it('lists reports with limit', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    // Create 2 reports
    buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );
    buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    const limited = stores.calibrationStore.listReports({ limit: 1 });
    expect(limited.length).toBe(1);
    stores.db.close();
  });

  // ── API layer ───────────────────────────────────────────────────

  it('calibrationShow returns report by ID', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    const buildResult = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );
    if (!buildResult.ok) throw new Error('unexpected');

    const showResult = calibrationShow(stores.calibrationStore, buildResult.report.reportId);
    expect(showResult.ok).toBe(true);
    if (!showResult.ok) throw new Error('unexpected');
    expect(showResult.report.reportId).toBe(buildResult.report.reportId);
    stores.db.close();
  });

  it('calibrationShow returns error for missing report', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);

    const result = calibrationShow(stores.calibrationStore, 'nonexistent');
    expect(result.ok).toBe(false);
    stores.db.close();
  });

  it('calibrationList returns all reports', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    const list = calibrationList(stores.calibrationStore);
    expect(list.length).toBe(1);
    expect(list[0]!.reportId).toMatch(/^cal-/);
    stores.db.close();
  });

  // ── E2E ─────────────────────────────────────────────────────────

  it('E2E: outcomes with pain → calibration report with adjustments', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    // Create outcomes that trigger pain signals:
    // - 3 churn_heavy outcomes → chronic_churn pain → lease duration adjustment
    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'churn_heavy', claimCount: 5, claimChurnCount: 4 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'churn_heavy', claimCount: 4, claimChurnCount: 3 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'churn_heavy', claimCount: 3, claimChurnCount: 2 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean' }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');

    const r = result.report;
    expect(r.policyFitness).not.toBeNull();
    expect(r.policyFitness!.churnRate).toBeCloseTo(0.75);
    expect(r.painSignals.length).toBeGreaterThan(0);
    expect(r.painSignals.some(s => s.code === 'chronic_churn')).toBe(true);
    expect(r.adjustments.length).toBeGreaterThan(0);
    expect(r.adjustments.some(a => a.kind === 'adjust_lease_duration')).toBe(true);

    // Verify summary includes key info
    expect(r.summary).toContain('Pain');
    expect(r.summary.length).toBeGreaterThan(20);

    // Verify persisted and retrievable
    const retrieved = calibrationShow(stores.calibrationStore, r.reportId);
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) throw new Error('unexpected');
    expect(retrieved.report.painSignals.length).toBe(r.painSignals.length);
    expect(retrieved.report.adjustments.length).toBe(r.adjustments.length);
    stores.db.close();
  });

  it('E2E: clean outcomes → report with no pain or adjustments', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', durationMs: 60000 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', durationMs: 120000 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', durationMs: 90000 }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');

    const r = result.report;
    expect(r.painSignals.length).toBe(0);
    expect(r.adjustments.length).toBe(0);
    expect(r.summary).toContain('No pain signals');
    stores.db.close();
  });

  it('E2E: lane-specific pain produces lane-scoped adjustments', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    // Create outcomes with high overflow in reviewer lane
    const outcomes = [
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', overflowCount: 10 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', overflowCount: 8 }),
      makeOutcome({ policySetId: psId, resolutionQuality: 'clean', overflowCount: 12 }),
    ];
    seedOutcomes(stores.outcomeStore, outcomes);
    for (const o of outcomes) {
      seedRoute(stores.routingStore, o.queueItemId, 'reviewer');
    }

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');

    const capPain = result.report.painSignals.filter(s => s.code === 'cap_too_tight');
    expect(capPain.length).toBeGreaterThan(0);
    expect(capPain[0]!.lane).toBe('reviewer');

    // Should have a cap increase adjustment for review lane
    const capAdj = result.report.adjustments.filter(a => a.kind === 'increase_cap' && a.lane === 'reviewer');
    expect(capAdj.length).toBe(1);
    stores.db.close();
  });

  it('report outcome window captures correct time range', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    const psId = seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policySetId: psId, openedAt: '2026-03-19T10:00:00Z', closedAt: '2026-03-19T11:00:00Z', resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, openedAt: '2026-03-19T08:00:00Z', closedAt: '2026-03-19T09:00:00Z', resolutionQuality: 'clean' }),
      makeOutcome({ policySetId: psId, openedAt: '2026-03-19T14:00:00Z', closedAt: '2026-03-19T15:00:00Z', resolutionQuality: 'clean' }),
    ]);

    const result = buildCalibrationReport(
      stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
      { persist: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unexpected');

    // from = earliest openedAt, to = latest closedAt
    expect(result.report.outcomeWindow.from).toBe('2026-03-19T08:00:00Z');
    expect(result.report.outcomeWindow.to).toBe('2026-03-19T15:00:00Z');
    stores.db.close();
  });

  it('policy fitness tracks policyChangedDuringLifecycle', () => {
    const dbPath = tempDbPath();
    const stores = openAllStores(dbPath);
    seedPolicy(stores.policyStore);

    seedOutcomes(stores.outcomeStore, [
      makeOutcome({ policyChangedDuringLifecycle: true, resolutionQuality: 'clean' }),
      makeOutcome({ policyChangedDuringLifecycle: false, resolutionQuality: 'clean' }),
      makeOutcome({ policyChangedDuringLifecycle: true, resolutionQuality: 'clean' }),
    ]);

    const fitness = derivePolicyFitness(stores.outcomeStore, 'ps-cal', 1);
    expect(fitness.outcomesWithPolicyChange).toBe(2);
    stores.db.close();
  });
});
