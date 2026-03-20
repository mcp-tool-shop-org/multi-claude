/**
 * Promotion Law — Phase 12 tests.
 *
 * Tests the full promotion pipeline:
 *   - Candidate creation from calibration adjustments
 *   - Candidate validation
 *   - Trial lifecycle (start, stop, conflict detection)
 *   - Outcome comparison (metrics, diffs, verdicts)
 *   - Promotion eligibility and apply
 *   - Rollback restores baseline
 *   - Rejection without trial
 *   - Promotion store CRUD
 *   - API layer (show, list)
 *   - E2E: calibration → candidate → trial → compare → promote
 *   - E2E: calibration → candidate → trial → compare → rollback
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
import { PromotionStore } from '../../src/handoff/promotion/promotion-store.js';
import { createPolicySet, activatePolicy } from '../../src/handoff/policy/policy-actions.js';
import { DEFAULT_POLICY_CONTENT } from '../../src/handoff/policy/types.js';
import { buildCalibrationReport } from '../../src/handoff/calibration/build-calibration-report.js';
import {
  createCandidate,
  validateCandidate,
  startTrial,
  stopTrial,
  compareTrialOutcomes,
  promoteCandidate,
  rollbackCandidate,
  rejectCandidate,
} from '../../src/handoff/promotion/promotion-actions.js';
import { promotionShow, promotionList } from '../../src/handoff/api/promotion-api.js';
import type { Outcome } from '../../src/handoff/outcome/types.js';
import type { RoutingLane } from '../../src/handoff/routing/types.js';
import { tempDbPath } from './helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let counter = 4000; // offset to avoid collision with other test files

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

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  counter++;
  return {
    outcomeId: overrides.outcomeId ?? `oc-promo-${counter}`,
    queueItemId: overrides.queueItemId ?? `qi-promo-${counter}`,
    handoffId: overrides.handoffId ?? `ho-promo-${counter}`,
    packetVersion: overrides.packetVersion ?? 1,
    briefId: overrides.briefId ?? `br-promo-${counter}`,
    status: overrides.status ?? 'closed',
    finalAction: overrides.finalAction ?? 'approve',
    finalStatus: overrides.finalStatus ?? 'approved',
    resolutionTerminal: overrides.resolutionTerminal ?? 'approved',
    resolutionQuality: overrides.resolutionQuality ?? 'clean',
    policySetId: overrides.policySetId ?? 'ps-promo',
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

/**
 * Build a calibration report from seeded outcomes so we get real adjustment IDs.
 */
function seedCalibrationReport(stores: ReturnType<typeof openAllStores>, psId: string) {
  // Seed enough outcomes with some pain signals
  const outcomes: Outcome[] = [];
  for (let i = 0; i < 15; i++) {
    outcomes.push(makeOutcome({
      policySetId: psId,
      resolutionQuality: i < 10 ? 'clean' : 'churn_heavy',
      overflowCount: i < 12 ? 0 : 2,
      claimCount: i < 13 ? 1 : 4,
      durationMs: 3600000 + (i * 60000),
    }));
    seedRoute(stores.routingStore, outcomes[i]!.queueItemId, 'reviewer');
  }
  for (const o of outcomes) {
    stores.outcomeStore.insertOutcome(o);
  }

  const result = buildCalibrationReport(
    stores.outcomeStore,
    stores.routingStore,
    stores.policyStore,
    stores.calibrationStore,
    { scope: 'global', actor: 'test', reason: 'Test calibration' },
  );
  if (!result.ok) throw new Error(`Calibration report failed: ${result.error}`);
  return result.report;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Promotion Law — Phase 12', () => {

  // ── Promotion store CRUD ───────────────────────────────────────────

  describe('Promotion store', () => {
    it('inserts and retrieves a promotion record', () => {
      const stores = openAllStores(tempDbPath());
      try {
        stores.promotionStore.insertPromotion({
          promotionId: 'promo-1',
          proposalIds: ['adj-1', 'adj-2'],
          sourceCalibrationReportId: 'cr-1',
          candidatePolicySetId: 'ps-candidate',
          baselinePolicySetId: 'ps-baseline',
          scope: 'global',
          status: 'draft',
          trialScope: null,
          createdAt: '2026-03-20T00:00:00Z',
          trialStartedAt: null,
          trialEndedAt: null,
          decisionAt: null,
          createdBy: 'test',
        });

        const promo = stores.promotionStore.getPromotion('promo-1');
        expect(promo).toBeDefined();
        expect(promo!.promotionId).toBe('promo-1');
        expect(promo!.proposalIds).toEqual(['adj-1', 'adj-2']);
        expect(promo!.status).toBe('draft');
      } finally {
        stores.db.close();
      }
    });

    it('lists promotions with status filter', () => {
      const stores = openAllStores(tempDbPath());
      try {
        for (const status of ['draft', 'trial_active', 'promoted'] as const) {
          stores.promotionStore.insertPromotion({
            promotionId: `promo-${status}`,
            proposalIds: ['adj-1'],
            sourceCalibrationReportId: 'cr-1',
            candidatePolicySetId: `ps-c-${status}`,
            baselinePolicySetId: 'ps-b',
            scope: 'global',
            status,
            trialScope: null,
            createdAt: '2026-03-20T00:00:00Z',
            trialStartedAt: null,
            trialEndedAt: null,
            decisionAt: null,
            createdBy: 'test',
          });
        }

        const all = stores.promotionStore.listPromotions();
        expect(all.length).toBe(3);

        const drafts = stores.promotionStore.listPromotions({ status: 'draft' });
        expect(drafts.length).toBe(1);
        expect(drafts[0]!.promotionId).toBe('promo-draft');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Create candidate ──────────────────────────────────────────────

  describe('createCandidate', () => {
    it('creates candidate from calibration adjustments', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);

        // Use the first adjustment from the report
        const adjId = report.adjustments[0]!.adjustmentId;
        const result = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          {
            calibrationReportId: report.reportId,
            adjustmentIds: [adjId],
            actor: 'test',
            reason: 'Test promotion',
          },
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('draft');
        expect(result.promotion.sourceCalibrationReportId).toBe(report.reportId);
        expect(result.promotion.proposalIds).toContain(adjId);
        expect(result.candidatePolicySetId).toBeTruthy();

        // Verify event was recorded
        const events = stores.promotionStore.getEvents(result.promotion.promotionId);
        expect(events.length).toBe(1);
        expect(events[0]!.kind).toBe('created');
      } finally {
        stores.db.close();
      }
    });

    it('fails if calibration report not found', () => {
      const stores = openAllStores(tempDbPath());
      try {
        seedPolicy(stores.policyStore);
        const result = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          {
            calibrationReportId: 'nonexistent',
            adjustmentIds: ['adj-1'],
            actor: 'test',
            reason: 'Test',
          },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('report_not_found');
      } finally {
        stores.db.close();
      }
    });

    it('fails if no matching adjustments', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);

        const result = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          {
            calibrationReportId: report.reportId,
            adjustmentIds: ['nonexistent-adj'],
            actor: 'test',
            reason: 'Test',
          },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('no_adjustments');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Validate candidate ────────────────────────────────────────────

  describe('validateCandidate', () => {
    it('validates draft → ready_for_trial', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const result = validateCandidate(
          stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test',
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('ready_for_trial');
      } finally {
        stores.db.close();
      }
    });

    it('rejects validation of non-draft promotion', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        // Validate once
        validateCandidate(stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test');

        // Try again — should fail
        const result = validateCandidate(
          stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test',
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('invalid_status');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Trial lifecycle ───────────────────────────────────────────────

  describe('startTrial', () => {
    it('starts trial for ready_for_trial promotion', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        validateCandidate(stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test');

        const result = startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: createResult.promotion.promotionId,
          trialScope: { kind: 'lane', lane: 'reviewer', maxDurationMs: null, maxAdmissions: null },
          actor: 'test',
          reason: 'Start trial',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('trial_active');
        expect(result.promotion.trialScope).toEqual({
          kind: 'lane', lane: 'reviewer', maxDurationMs: null, maxAdmissions: null,
        });
        expect(result.promotion.trialStartedAt).toBeTruthy();
      } finally {
        stores.db.close();
      }
    });

    it('rejects trial if another trial is active in same scope', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        // First promotion — start trial
        const createResult1 = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'First' },
        );
        if (!createResult1.ok) throw new Error('create1 failed');

        validateCandidate(stores.promotionStore, stores.policyStore,
          createResult1.promotion.promotionId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: createResult1.promotion.promotionId,
          trialScope: { kind: 'lane', lane: 'reviewer', maxDurationMs: null, maxAdmissions: null },
          actor: 'test', reason: 'First trial',
        });

        // Second promotion — manually insert as ready_for_trial (avoid needing another calibration)
        const ps2 = createPolicySet(stores.policyStore, {
          content: DEFAULT_POLICY_CONTENT,
          reason: 'Second candidate',
          actor: 'test',
        });
        if (!ps2.ok) throw new Error('ps2 failed');

        stores.promotionStore.insertPromotion({
          promotionId: 'promo-conflict',
          proposalIds: ['adj-x'],
          sourceCalibrationReportId: report.reportId,
          candidatePolicySetId: ps2.policySet.policySetId,
          baselinePolicySetId: createResult1.promotion.baselinePolicySetId,
          scope: 'global',
          status: 'ready_for_trial',
          trialScope: null,
          createdAt: '2026-03-20T00:00:00Z',
          trialStartedAt: null,
          trialEndedAt: null,
          decisionAt: null,
          createdBy: 'test',
        });

        const result = startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: 'promo-conflict',
          trialScope: { kind: 'lane', lane: 'reviewer', maxDurationMs: null, maxAdmissions: null },
          actor: 'test', reason: 'Should fail',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('active_trial_exists');
      } finally {
        stores.db.close();
      }
    });
  });

  describe('stopTrial', () => {
    it('stops an active trial', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        validateCandidate(stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: createResult.promotion.promotionId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });

        const result = stopTrial(stores.promotionStore, {
          promotionId: createResult.promotion.promotionId,
          actor: 'test',
          reason: 'Trial complete',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('trial_completed');
        expect(result.promotion.trialEndedAt).toBeTruthy();
      } finally {
        stores.db.close();
      }
    });

    it('rejects stopping a non-active trial', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const result = stopTrial(stores.promotionStore, {
          promotionId: createResult.promotion.promotionId,
          actor: 'test',
          reason: 'Not started',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('invalid_status');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Comparison ────────────────────────────────────────────────────

  describe('compareTrialOutcomes', () => {
    it('returns insufficient_evidence with too few outcomes', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        validateCandidate(stores.promotionStore, stores.policyStore,
          createResult.promotion.promotionId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: createResult.promotion.promotionId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });
        stopTrial(stores.promotionStore, {
          promotionId: createResult.promotion.promotionId,
          actor: 'test', reason: 'Done',
        });

        // No outcomes seeded for candidate/baseline → insufficient
        const result = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: createResult.promotion.promotionId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.comparison.verdict).toBe('insufficient_evidence');
      } finally {
        stores.db.close();
      }
    });

    it('detects candidate_better when candidate has higher clean rate', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const promoId = createResult.promotion.promotionId;
        const candidatePsId = createResult.candidatePolicySetId;
        const baselinePsId = createResult.promotion.baselinePolicySetId;

        validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });
        stopTrial(stores.promotionStore, { promotionId: promoId, actor: 'test', reason: 'Done' });

        // Seed candidate outcomes — all clean
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: candidatePsId,
            resolutionQuality: 'clean',
            overflowCount: 0,
            durationMs: 2000000,
          }));
        }

        // Seed baseline outcomes — mixed quality
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: baselinePsId,
            resolutionQuality: i < 5 ? 'clean' : 'churn_heavy',
            overflowCount: i < 8 ? 0 : 1,
            durationMs: 4000000,
          }));
        }

        const result = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: promoId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.comparison.verdict).toBe('candidate_better');
        expect(result.comparison.candidateMetrics.cleanRate).toBe(1);
        expect(result.comparison.baselineMetrics.cleanRate).toBeLessThan(1);

        // Should auto-transition to promotion_eligible
        const promo = stores.promotionStore.getPromotion(promoId);
        expect(promo!.status).toBe('promotion_eligible');
      } finally {
        stores.db.close();
      }
    });

    it('detects candidate_worse when churn regression exceeds limit', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const promoId = createResult.promotion.promotionId;
        const candidatePsId = createResult.candidatePolicySetId;
        const baselinePsId = createResult.promotion.baselinePolicySetId;

        validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });
        stopTrial(stores.promotionStore, { promotionId: promoId, actor: 'test', reason: 'Done' });

        // Candidate outcomes — lots of churn
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: candidatePsId,
            resolutionQuality: i < 3 ? 'clean' : 'churn_heavy',
            overflowCount: 0,
          }));
        }

        // Baseline outcomes — all clean
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: baselinePsId,
            resolutionQuality: 'clean',
            overflowCount: 0,
          }));
        }

        const result = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: promoId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.comparison.verdict).toBe('candidate_worse');

        // Should NOT transition to promotion_eligible
        const promo = stores.promotionStore.getPromotion(promoId);
        expect(promo!.status).toBe('trial_completed');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Promote candidate ─────────────────────────────────────────────

  describe('promoteCandidate', () => {
    it('promotes eligible candidate to active policy', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const promoId = createResult.promotion.promotionId;
        const candidatePsId = createResult.candidatePolicySetId;
        const baselinePsId = createResult.promotion.baselinePolicySetId;

        validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });
        stopTrial(stores.promotionStore, { promotionId: promoId, actor: 'test', reason: 'Done' });

        // Seed good candidate outcomes
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: candidatePsId,
            resolutionQuality: 'clean',
          }));
        }
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: baselinePsId,
            resolutionQuality: i < 5 ? 'clean' : 'churn_heavy',
          }));
        }

        compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: promoId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });

        const result = promoteCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          actor: 'test',
          reason: 'Candidate is better',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('promoted');
        expect(result.promotion.decisionAt).toBeTruthy();

        // Verify events include promoted
        const events = stores.promotionStore.getEvents(promoId);
        const promoteEvent = events.find(e => e.kind === 'promoted');
        expect(promoteEvent).toBeDefined();
      } finally {
        stores.db.close();
      }
    });

    it('rejects promotion of non-eligible status', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const result = promoteCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: createResult.promotion.promotionId,
          actor: 'test',
          reason: 'Try to promote',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('invalid_status');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Rollback ──────────────────────────────────────────────────────

  describe('rollbackCandidate', () => {
    it('rolls back active trial and restores baseline', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const promoId = createResult.promotion.promotionId;

        validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'lane', lane: 'reviewer', maxDurationMs: null, maxAdmissions: null },
          actor: 'test', reason: 'Trial',
        });

        const result = rollbackCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          actor: 'test',
          reason: 'Regression detected',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('rolled_back');
        expect(result.promotion.decisionAt).toBeTruthy();

        // Verify rollback event
        const events = stores.promotionStore.getEvents(promoId);
        const rollbackEvent = events.find(e => e.kind === 'rolled_back');
        expect(rollbackEvent).toBeDefined();
      } finally {
        stores.db.close();
      }
    });

    it('rejects rollback of terminal status', () => {
      const stores = openAllStores(tempDbPath());
      try {
        stores.promotionStore.insertPromotion({
          promotionId: 'promo-promoted',
          proposalIds: ['adj-1'],
          sourceCalibrationReportId: 'cr-1',
          candidatePolicySetId: 'ps-c',
          baselinePolicySetId: 'ps-b',
          scope: 'global',
          status: 'promoted',
          trialScope: null,
          createdAt: '2026-03-20T00:00:00Z',
          trialStartedAt: null,
          trialEndedAt: null,
          decisionAt: '2026-03-20T01:00:00Z',
          createdBy: 'test',
        });

        const result = rollbackCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: 'promo-promoted',
          actor: 'test',
          reason: 'Too late',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('invalid_status');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── Reject candidate ──────────────────────────────────────────────

  describe('rejectCandidate', () => {
    it('rejects candidate in draft status', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const result = rejectCandidate(stores.promotionStore, {
          promotionId: createResult.promotion.promotionId,
          actor: 'test',
          reason: 'Not suitable',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.status).toBe('rejected');
      } finally {
        stores.db.close();
      }
    });

    it('cannot reject already-promoted candidate', () => {
      const stores = openAllStores(tempDbPath());
      try {
        stores.promotionStore.insertPromotion({
          promotionId: 'promo-done',
          proposalIds: ['adj-1'],
          sourceCalibrationReportId: 'cr-1',
          candidatePolicySetId: 'ps-c',
          baselinePolicySetId: 'ps-b',
          scope: 'global',
          status: 'promoted',
          trialScope: null,
          createdAt: '2026-03-20T00:00:00Z',
          trialStartedAt: null,
          trialEndedAt: null,
          decisionAt: '2026-03-20T01:00:00Z',
          createdBy: 'test',
        });

        const result = rejectCandidate(stores.promotionStore, {
          promotionId: 'promo-done',
          actor: 'test',
          reason: 'Too late',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe('invalid_status');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── API layer ─────────────────────────────────────────────────────

  describe('API layer', () => {
    it('promotionShow returns promotion with events and comparisons', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'Test' },
        );
        if (!createResult.ok) throw new Error('create failed');

        const result = promotionShow(stores.promotionStore, createResult.promotion.promotionId);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.promotion.promotionId).toBe(createResult.promotion.promotionId);
        expect(result.events.length).toBeGreaterThan(0);
        expect(result.comparisons).toEqual([]);
      } finally {
        stores.db.close();
      }
    });

    it('promotionShow returns error for nonexistent', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const result = promotionShow(stores.promotionStore, 'nonexistent');
        expect(result.ok).toBe(false);
      } finally {
        stores.db.close();
      }
    });

    it('promotionList returns filtered results', () => {
      const stores = openAllStores(tempDbPath());
      try {
        stores.promotionStore.insertPromotion({
          promotionId: 'promo-a', proposalIds: ['adj-1'],
          sourceCalibrationReportId: 'cr-1', candidatePolicySetId: 'ps-c1',
          baselinePolicySetId: 'ps-b1', scope: 'global', status: 'draft',
          trialScope: null, createdAt: '2026-03-20T00:00:00Z',
          trialStartedAt: null, trialEndedAt: null, decisionAt: null, createdBy: 'test',
        });
        stores.promotionStore.insertPromotion({
          promotionId: 'promo-b', proposalIds: ['adj-2'],
          sourceCalibrationReportId: 'cr-2', candidatePolicySetId: 'ps-c2',
          baselinePolicySetId: 'ps-b2', scope: 'global', status: 'promoted',
          trialScope: null, createdAt: '2026-03-20T01:00:00Z',
          trialStartedAt: null, trialEndedAt: null, decisionAt: null, createdBy: 'test',
        });

        const all = promotionList(stores.promotionStore);
        expect(all.length).toBe(2);

        const promoted = promotionList(stores.promotionStore, { status: 'promoted' });
        expect(promoted.length).toBe(1);
        expect(promoted[0]!.promotionId).toBe('promo-b');
      } finally {
        stores.db.close();
      }
    });
  });

  // ── E2E: full promotion pipeline ──────────────────────────────────

  describe('E2E', () => {
    it('calibration → candidate → trial → compare → promote', () => {
      const stores = openAllStores(tempDbPath());
      try {
        // 1. Setup baseline policy + calibration
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        expect(report.adjustments.length).toBeGreaterThan(0);

        // 2. Create candidate
        const adjId = report.adjustments[0]!.adjustmentId;
        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'E2E test' },
        );
        expect(createResult.ok).toBe(true);
        if (!createResult.ok) return;
        const promoId = createResult.promotion.promotionId;

        // 3. Validate
        const valResult = validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        expect(valResult.ok).toBe(true);

        // 4. Start trial
        const trialResult = startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'admission_cap', lane: null, maxDurationMs: null, maxAdmissions: 50 },
          actor: 'test', reason: 'E2E trial',
        });
        expect(trialResult.ok).toBe(true);

        // 5. Stop trial
        const stopResult = stopTrial(stores.promotionStore, {
          promotionId: promoId, actor: 'test', reason: 'E2E trial done',
        });
        expect(stopResult.ok).toBe(true);

        // 6. Seed outcomes for comparison
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: createResult.candidatePolicySetId,
            resolutionQuality: 'clean',
          }));
        }
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: createResult.promotion.baselinePolicySetId,
            resolutionQuality: i < 6 ? 'clean' : 'churn_heavy',
          }));
        }

        // 7. Compare
        const cmpResult = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: promoId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });
        expect(cmpResult.ok).toBe(true);
        if (!cmpResult.ok) return;
        expect(cmpResult.comparison.verdict).toBe('candidate_better');

        // 8. Promote
        const promResult = promoteCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: promoId, actor: 'test', reason: 'E2E promote',
        });
        expect(promResult.ok).toBe(true);
        if (!promResult.ok) return;
        expect(promResult.promotion.status).toBe('promoted');

        // 9. Verify full audit trail
        const events = stores.promotionStore.getEvents(promoId);
        const kinds = events.map(e => e.kind);
        expect(kinds).toContain('created');
        expect(kinds).toContain('validated');
        expect(kinds).toContain('trial_started');
        expect(kinds).toContain('trial_stopped');
        expect(kinds).toContain('promoted');

        // 10. Verify comparison persisted
        const comparisons = stores.promotionStore.getComparisons(promoId);
        expect(comparisons.length).toBe(1);
      } finally {
        stores.db.close();
      }
    });

    it('calibration → candidate → trial → compare → rollback on regression', () => {
      const stores = openAllStores(tempDbPath());
      try {
        const psId = seedPolicy(stores.policyStore);
        const report = seedCalibrationReport(stores, psId);
        const adjId = report.adjustments[0]!.adjustmentId;

        const createResult = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          { calibrationReportId: report.reportId, adjustmentIds: [adjId], actor: 'test', reason: 'E2E rollback' },
        );
        if (!createResult.ok) throw new Error('create failed');
        const promoId = createResult.promotion.promotionId;

        validateCandidate(stores.promotionStore, stores.policyStore, promoId, 'test');
        startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: promoId,
          trialScope: { kind: 'time_window', lane: null, maxDurationMs: 60000, maxAdmissions: null },
          actor: 'test', reason: 'E2E trial',
        });
        stopTrial(stores.promotionStore, { promotionId: promoId, actor: 'test', reason: 'Done' });

        // Seed bad candidate outcomes
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: createResult.candidatePolicySetId,
            resolutionQuality: i < 2 ? 'clean' : 'churn_heavy',
          }));
        }
        for (let i = 0; i < 10; i++) {
          stores.outcomeStore.insertOutcome(makeOutcome({
            policySetId: createResult.promotion.baselinePolicySetId,
            resolutionQuality: 'clean',
          }));
        }

        const cmpResult = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: promoId,
          rules: { minCandidateOutcomes: 5, minBaselineOutcomes: 5, maxChurnRegression: 0.1, maxInterventionRegression: 0.1 },
        });
        expect(cmpResult.ok).toBe(true);
        if (!cmpResult.ok) return;
        expect(cmpResult.comparison.verdict).toBe('candidate_worse');

        // Rollback
        const rollResult = rollbackCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: promoId, actor: 'test', reason: 'Regression',
        });
        expect(rollResult.ok).toBe(true);
        if (!rollResult.ok) return;
        expect(rollResult.promotion.status).toBe('rolled_back');

        // Verify cannot promote after rollback
        const promResult = promoteCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: promoId, actor: 'test', reason: 'Try again',
        });
        expect(promResult.ok).toBe(false);
      } finally {
        stores.db.close();
      }
    });
  });
});
