/**
 * Control Plane Monitor — Item detail query.
 *
 * Deep read-only view of a single queue item with all related state.
 */

import type { QueueStore } from '../../handoff/queue/queue-store.js';
import type { SupervisorStore } from '../../handoff/supervisor/supervisor-store.js';
import type { RoutingStore } from '../../handoff/routing/routing-store.js';
import type { FlowStore } from '../../handoff/flow/flow-store.js';
import type { InterventionStore } from '../../handoff/intervention/intervention-store.js';
import type { PolicyStore } from '../../handoff/policy/policy-store.js';
import type { OutcomeStore } from '../../handoff/outcome/outcome-store.js';
import type { PromotionStore } from '../../handoff/promotion/promotion-store.js';
import type { HandoffStore } from '../../handoff/store/handoff-store.js';
import type { ItemDetailView, TimelineEvent, BriefWorkbenchView } from '../types.js';
import { computeEligibility } from '../policies/action-eligibility.js';
import { computeDecisionAffordance } from '../policies/decision-eligibility.js';

export interface ItemDetailStores {
  queueStore: QueueStore;
  supervisorStore: SupervisorStore;
  routingStore: RoutingStore;
  flowStore: FlowStore;
  interventionStore: InterventionStore;
  policyStore: PolicyStore;
  outcomeStore: OutcomeStore;
  promotionStore: PromotionStore;
  handoffStore: HandoffStore;
}

export function queryItemDetail(
  stores: ItemDetailStores,
  queueItemId: string,
): ItemDetailView | null {
  const {
    queueStore, supervisorStore, routingStore, flowStore,
    interventionStore, outcomeStore, promotionStore, handoffStore,
  } = stores;

  const item = queueStore.getQueueItem(queueItemId);
  if (!item) return null;

  // Brief
  const brief = item.briefId ? queueStore.getBrief(item.briefId) : null;

  // Handoff summary
  const packet = handoffStore.reconstructPacket(item.handoffId);
  const handoffSummary = packet?.summary ?? null;

  // Routing
  const activeRoute = routingStore.getActiveRoute(queueItemId);
  const routeHistory = routingStore.getRouteHistory(queueItemId);

  // Supervisor
  const activeClaim = supervisorStore.getActiveClaim(queueItemId);
  const allClaims = supervisorStore.listClaims().filter(c =>
    supervisorStore.getEventsByQueueItem(queueItemId).some(e => e.claimId === c.claimId)
  );

  // Flow
  const overflow = flowStore.getOverflow(queueItemId);

  // Intervention (lane-level)
  const currentLane = activeRoute?.lane ?? null;
  let laneHealth = null;
  let activeIntervention = null;
  if (currentLane) {
    const snapshot = interventionStore.getLatestSnapshot(currentLane);
    laneHealth = snapshot?.healthState ?? null;
    const intervention = interventionStore.getActiveIntervention(currentLane);
    if (intervention) {
      activeIntervention = {
        interventionId: intervention.interventionId,
        action: intervention.action,
        reason: intervention.reason,
        triggeredAt: intervention.triggeredAt,
      };
    }
  }

  // Outcome
  const outcome = outcomeStore.getOutcomeByQueueItem(queueItemId);

  // Policy context
  const activePolicy = stores.policyStore.getActivePolicy();
  const activeTrials = promotionStore.getActiveTrials();
  const isTrialPolicy = activeTrials.some(t => t.candidatePolicySetId === activePolicy?.policySetId);
  const trialPromotion = activeTrials.find(t => t.candidatePolicySetId === activePolicy?.policySetId);

  // Build timeline
  const timeline = buildTimeline(stores, queueItemId);

  // Build workbench view (full brief projection)
  const workbench: BriefWorkbenchView | null = brief ? {
    briefId: brief.briefId,
    role: brief.role,
    handoffId: brief.handoffId,
    packetVersion: brief.packetVersion,
    baselinePacketVersion: brief.baselinePacketVersion,
    briefVersion: brief.briefVersion,
    createdAt: brief.createdAt,
    summary: brief.summary,
    deltaSummary: brief.deltaSummary ?? [],
    blockers: (brief.blockers ?? []).map(b => ({
      code: b.code,
      severity: b.severity,
      summary: b.summary,
    })),
    evidenceCoverage: brief.evidenceCoverage ?? {
      fingerprint: '',
      requiredArtifacts: [],
      presentArtifacts: [],
      missingArtifacts: [],
    },
    eligibility: brief.eligibility ?? {
      allowedActions: [],
      recommendedAction: 'needs-review' as const,
      rationale: [],
    },
    risks: brief.risks ?? [],
    openLoops: brief.openLoops ?? [],
    decisionRefs: brief.decisionRefs ?? [],
  } : null;

  // Decision affordance (operator-gated)
  const decisionAffordance = computeDecisionAffordance({ queueStore, supervisorStore }, queueItemId);

  return {
    queueItemId: item.queueItemId,
    handoffId: item.handoffId,
    role: item.role,
    priorityClass: item.priorityClass,
    status: item.status,
    createdAt: item.createdAt,
    handoffSummary,
    brief: brief ? {
      briefId: brief.briefId,
      role: brief.role,
      renderedText: brief.summary ?? null,
    } : null,
    blockers: brief?.blockers?.map(b => ({
      code: b.code,
      severity: b.severity,
      detail: b.summary ?? null,
    })) ?? [],
    routing: {
      currentLane,
      assignedTarget: activeRoute?.assignedTarget ?? null,
      routeHistory: routeHistory.map(r => ({
        routeId: r.routeId,
        lane: r.lane,
        status: r.status,
        reasonCode: r.reasonCode,
        routedAt: r.routedAt,
      })),
    },
    supervisor: {
      activeClaim: activeClaim ? {
        claimId: activeClaim.claimId,
        actor: activeClaim.claimedBy,
        status: activeClaim.status,
        claimedAt: activeClaim.claimedAt,
        expiresAt: activeClaim.leaseExpiresAt,
      } : null,
      claimHistory: allClaims.map(c => ({
        claimId: c.claimId,
        actor: c.claimedBy,
        status: c.status,
        claimedAt: c.claimedAt,
      })),
    },
    flow: {
      isOverflow: !!overflow,
      overflowSince: overflow?.enteredAt ?? null,
    },
    intervention: {
      laneHealth,
      activeIntervention,
    },
    outcome: outcome ? {
      outcomeId: outcome.outcomeId,
      status: outcome.status,
      finalAction: outcome.finalAction,
      resolutionQuality: outcome.resolutionQuality,
      durationMs: outcome.durationMs,
      claimCount: outcome.claimCount,
      deferCount: outcome.deferCount,
      rerouteCount: outcome.rerouteCount,
      escalationCount: outcome.escalationCount,
      closedAt: outcome.closedAt,
    } : null,
    policy: {
      policySetId: activePolicy?.policySetId ?? null,
      policyVersion: activePolicy?.policyVersion ?? null,
      isTrialPolicy,
      promotionId: trialPromotion?.promotionId ?? null,
    },
    actions: computeEligibility({ queueStore, supervisorStore }, queueItemId),
    workbench,
    decisionAffordance,
    timeline,
  };
}

function buildTimeline(stores: ItemDetailStores, queueItemId: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Queue events
  for (const e of stores.queueStore.getEvents(queueItemId)) {
    events.push({
      timestamp: e.createdAt,
      source: 'queue',
      kind: e.kind,
      detail: `${e.fromStatus ?? '∅'} → ${e.toStatus}${e.reason ? `: ${e.reason}` : ''}`,
      actor: e.actor ?? null,
    });
  }

  // Supervisor events
  for (const e of stores.supervisorStore.getEventsByQueueItem(queueItemId)) {
    events.push({
      timestamp: e.createdAt,
      source: 'supervisor',
      kind: e.kind,
      detail: `${e.fromStatus ?? '∅'} → ${e.toStatus}${e.reason ? `: ${e.reason}` : ''}`,
      actor: e.actor,
    });
  }

  // Routing events
  for (const e of stores.routingStore.getEvents(queueItemId)) {
    events.push({
      timestamp: e.createdAt,
      source: 'routing',
      kind: e.kind,
      detail: `${e.fromLane ?? '∅'} → ${e.toLane}${e.reason ? `: ${e.reason}` : ''}`,
      actor: e.actor,
    });
  }

  // Sort chronologically
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return events;
}
