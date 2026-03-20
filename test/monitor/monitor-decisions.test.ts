/**
 * Monitor Decision Layer — Phase 13C tests.
 *
 * Tests the decision workbench projection, decision affordance,
 * decision command endpoint, and the full decision → outcome flow.
 *
 * Law: the UI renders the brief. The brief's eligibility gates decisions.
 * The command goes through actOnQueueItem → bindDecisionAction → audit.
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
import { computeDecisionAffordance } from '../../src/monitor/policies/decision-eligibility.js';
import { executeDecision } from '../../src/monitor/commands/decide-item.js';
import { executeClaimItem } from '../../src/monitor/commands/claim-item.js';
import { queryItemDetail } from '../../src/monitor/queries/item-detail-query.js';
import type { DecisionBrief } from '../../src/handoff/decision/types.js';
import { tempDbPath } from '../handoff/helpers.js';

// ── Test fixture ─────────────────────────────────────────────────────

let counter = 9000;

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

function makeBrief(overrides: Partial<DecisionBrief> = {}): DecisionBrief {
  return {
    briefId: overrides.briefId ?? uid('dbr'),
    handoffId: overrides.handoffId ?? uid('ho'),
    packetVersion: overrides.packetVersion ?? 1,
    baselinePacketVersion: overrides.baselinePacketVersion ?? null,
    briefVersion: '1.0.0',
    createdAt: NOW,
    role: overrides.role ?? 'reviewer',
    summary: overrides.summary ?? 'Test brief summary',
    deltaSummary: overrides.deltaSummary ?? [],
    blockers: overrides.blockers ?? [],
    evidenceCoverage: overrides.evidenceCoverage ?? {
      fingerprint: 'fp-test-123456789',
      requiredArtifacts: ['schema.sql'],
      presentArtifacts: ['schema.sql'],
      missingArtifacts: [],
    },
    eligibility: overrides.eligibility ?? {
      allowedActions: ['approve', 'reject', 'needs-review'],
      recommendedAction: 'approve',
      rationale: ['No blockers detected'],
    },
    risks: overrides.risks ?? [],
    openLoops: overrides.openLoops ?? [],
    decisionRefs: overrides.decisionRefs ?? [],
  };
}

function seedItemWithBrief(stores: ReturnType<typeof openAllStores>, overrides: Record<string, unknown> = {}) {
  const briefId = overrides.briefId as string ?? uid('dbr');
  const handoffId = overrides.handoffId as string ?? uid('ho');
  const queueItemId = overrides.queueItemId as string ?? uid('qi');

  const brief = makeBrief({
    briefId,
    handoffId,
    ...(overrides.briefOverrides as Partial<DecisionBrief> ?? {}),
  });
  stores.queueStore.insertBrief(brief);

  stores.queueStore.insertQueueItem({
    queueItemId,
    handoffId,
    packetVersion: 1,
    briefId,
    role: 'reviewer',
    status: (overrides.status as string) ?? 'pending',
    priorityClass: 'approvable',
    blockerSummary: 'none',
    eligibilitySummary: 'eligible',
    evidenceFingerprint: 'fp-test-123456789',
    createdAt: NOW,
    updatedAt: NOW,
  });

  return { queueItemId, briefId, handoffId };
}

function seedClaim(stores: ReturnType<typeof openAllStores>, queueItemId: string, actor: string = 'op-1') {
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

// ── Decision Affordance tests ────────────────────────────────────────

describe('Decision Affordance', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('enabled when item is claimed and brief has allowed actions', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId);

    const aff = computeDecisionAffordance(stores, queueItemId);
    expect(aff.decisionEnabled).toBe(true);
    expect(aff.hasActiveClaim).toBe(true);
    expect(aff.claimedByOperator).toBe(true);
    expect(aff.disabledReason).toBeNull();
  });

  it('disabled when no active claim', () => {
    const { queueItemId } = seedItemWithBrief(stores);

    const aff = computeDecisionAffordance(stores, queueItemId);
    expect(aff.decisionEnabled).toBe(false);
    expect(aff.disabledReason).toContain('claim');
  });

  it('disabled on terminal item', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'approved' });

    const aff = computeDecisionAffordance(stores, queueItemId);
    expect(aff.decisionEnabled).toBe(false);
    expect(aff.disabledReason).toContain('terminal');
  });

  it('disabled on stale item with legible message', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'stale' });

    const aff = computeDecisionAffordance(stores, queueItemId);
    expect(aff.decisionEnabled).toBe(false);
    expect(aff.disabledReason).toContain('stale');
    expect(aff.disabledReason).toContain('refreshed');
  });

  it('disabled when brief has no allowed actions', () => {
    const { queueItemId } = seedItemWithBrief(stores, {
      status: 'in_review',
      briefOverrides: {
        eligibility: { allowedActions: [], recommendedAction: 'needs-review', rationale: ['Blocked'] },
      },
    });
    seedClaim(stores, queueItemId);

    const aff = computeDecisionAffordance(stores, queueItemId);
    expect(aff.decisionEnabled).toBe(false);
    expect(aff.disabledReason).toContain('no allowed actions');
  });

  it('disabled for non-existent item', () => {
    const aff = computeDecisionAffordance(stores, 'non-existent');
    expect(aff.decisionEnabled).toBe(false);
  });
});

// ── Decision Command tests ──────────────────────────────────────────

describe('Decision Command', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('approves a claimed item successfully', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'Looks good' },
    );

    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe('approved');
    expect(result.actionId).toBeDefined();

    // Verify canonical state
    const item = stores.queueStore.getQueueItem(queueItemId);
    expect(item!.status).toBe('approved');

    // Verify claim completed
    const claim = stores.supervisorStore.getActiveClaim(queueItemId);
    expect(claim).toBeNull(); // claim is now 'completed', not 'active'
  });

  it('rejects a claimed item', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'reject', reason: 'Not ready' },
    );

    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe('rejected');
  });

  it('requests recovery', () => {
    const { queueItemId } = seedItemWithBrief(stores, {
      status: 'in_review',
      briefOverrides: {
        eligibility: {
          allowedActions: ['reject', 'request-recovery', 'needs-review'],
          recommendedAction: 'request-recovery',
          rationale: ['Recovery needed'],
        },
      },
    });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'request-recovery', reason: 'Needs remediation' },
    );

    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe('recovery_requested');
  });

  it('sends back for review (non-terminal, claim stays active)', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'needs-review', reason: 'Need more context' },
    );

    expect(result.ok).toBe(true);
    expect(result.newStatus).toBe('in_review');

    // Claim should still be active (needs-review is not terminal)
    const claim = stores.supervisorStore.getActiveClaim(queueItemId);
    expect(claim).not.toBeNull();
  });

  it('rejects when no active claim', () => {
    const { queueItemId } = seedItemWithBrief(stores);

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'Test' },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('no_active_claim');
  });

  it('rejects when wrong operator', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'wrong-op', action: 'approve', reason: 'Test' },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('not_claimer');
  });

  it('rejects action not in brief allowedActions', () => {
    const { queueItemId } = seedItemWithBrief(stores, {
      status: 'in_review',
      briefOverrides: {
        eligibility: {
          allowedActions: ['reject'],
          recommendedAction: 'reject',
          rationale: ['Only rejection allowed'],
        },
      },
    });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'Test' },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('action_failed');
  });

  it('rejects invalid action value', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    const result = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'invalid-action' as any, reason: 'Test' },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_action');
  });
});

// ── Workbench Projection tests ──────────────────────────────────────

describe('Workbench Projection', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('projects full brief into item detail workbench', () => {
    const { queueItemId } = seedItemWithBrief(stores, {
      briefOverrides: {
        summary: 'Test packet for review',
        blockers: [{ code: 'missing_evidence', severity: 'medium', summary: 'Schema file missing' }],
        risks: ['Data loss risk'],
        openLoops: ['API tests pending'],
        decisionRefs: ['art-schema'],
        deltaSummary: ['Instructions changed'],
      },
    });

    const detail = queryItemDetail(stores, queueItemId);
    expect(detail).not.toBeNull();
    expect(detail!.workbench).not.toBeNull();

    const wb = detail!.workbench!;
    expect(wb.summary).toBe('Test packet for review');
    expect(wb.role).toBe('reviewer');
    expect(wb.blockers).toHaveLength(1);
    expect(wb.blockers[0]!.code).toBe('missing_evidence');
    expect(wb.evidenceCoverage.fingerprint).toBe('fp-test-123456789');
    expect(wb.eligibility.allowedActions).toContain('approve');
    expect(wb.eligibility.recommendedAction).toBe('approve');
    expect(wb.risks).toContain('Data loss risk');
    expect(wb.openLoops).toContain('API tests pending');
    expect(wb.decisionRefs).toContain('art-schema');
    expect(wb.deltaSummary).toContain('Instructions changed');
  });

  it('workbench is null when no brief', () => {
    const queueItemId = uid('qi');
    stores.queueStore.insertQueueItem({
      queueItemId,
      handoffId: uid('ho'),
      packetVersion: 1,
      briefId: uid('br-nonexistent'),
      role: 'reviewer',
      status: 'pending',
      priorityClass: 'approvable',
      blockerSummary: 'none',
      eligibilitySummary: 'eligible',
      evidenceFingerprint: 'fp-test',
      createdAt: NOW,
      updatedAt: NOW,
    });

    const detail = queryItemDetail(stores, queueItemId);
    expect(detail!.workbench).toBeNull();
  });

  it('decision affordance is projected in item detail', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId);

    const detail = queryItemDetail(stores, queueItemId);
    expect(detail!.decisionAffordance).toBeDefined();
    expect(detail!.decisionAffordance.decisionEnabled).toBe(true);
  });

  it('activity timeline shows decision events after command', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'Ship it' },
    );

    const detail = queryItemDetail(stores, queueItemId);
    const queueEvents = detail!.timeline.filter(e => e.source === 'queue');
    expect(queueEvents.some(e => e.kind === 'action_bound')).toBe(true);

    const supervisorEvents = detail!.timeline.filter(e => e.source === 'supervisor');
    expect(supervisorEvents.some(e => e.kind === 'action_taken')).toBe(true);
  });

  it('eligibility updates after decision (terminal item blocks further decisions)', () => {
    const { queueItemId } = seedItemWithBrief(stores, { status: 'in_review' });
    seedClaim(stores, queueItemId, 'op-1');

    // Before decision
    let detail = queryItemDetail(stores, queueItemId);
    expect(detail!.decisionAffordance.decisionEnabled).toBe(true);

    // Execute approval
    executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'Approved' },
    );

    // After decision — terminal, decisions blocked
    detail = queryItemDetail(stores, queueItemId);
    expect(detail!.decisionAffordance.decisionEnabled).toBe(false);
    expect(detail!.decisionAffordance.disabledReason).toContain('terminal');
  });
});

// ── Full flow: claim → decide ───────────────────────────────────────

describe('Claim → Decide flow', () => {
  let stores: ReturnType<typeof openAllStores>;

  beforeEach(() => {
    stores = openAllStores(tempDbPath());
  });

  it('full flow: claim via 13B, then decide via 13C', () => {
    const { queueItemId } = seedItemWithBrief(stores);

    // Step 1: Claim (13B)
    const claimResult = executeClaimItem(stores.queueStore, stores.supervisorStore, queueItemId, { operatorId: 'op-1' });
    expect(claimResult.ok).toBe(true);

    // Step 2: Verify affordance is now enabled
    const detail1 = queryItemDetail(stores, queueItemId);
    expect(detail1!.decisionAffordance.decisionEnabled).toBe(true);
    expect(detail1!.workbench!.eligibility.allowedActions).toContain('approve');

    // Step 3: Decide (13C)
    const decideResult = executeDecision(
      stores.handoffStore, stores.queueStore, stores.supervisorStore,
      queueItemId, { operatorId: 'op-1', action: 'approve', reason: 'All clear' },
    );
    expect(decideResult.ok).toBe(true);
    expect(decideResult.newStatus).toBe('approved');

    // Step 4: Verify final state
    const detail2 = queryItemDetail(stores, queueItemId);
    expect(detail2!.status).toBe('approved');
    expect(detail2!.decisionAffordance.decisionEnabled).toBe(false);
  });
});
