/**
 * Policy Control — API.
 *
 * Read-only inspection and formatted output for policy state.
 */

import type { PolicyStore } from '../policy/policy-store.js';
import type { FlowStore } from '../flow/flow-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { QueueStore } from '../queue/queue-store.js';
import type { InterventionStore } from '../intervention/intervention-store.js';
import type { RoutingLane } from '../routing/types.js';
import type { PolicySet, PolicyDiff, SimulationResult, PolicyEvent } from '../policy/types.js';
import {
  diffPolicies,
  simulatePolicy,
} from '../policy/policy-actions.js';

// ── Inspect ──────────────────────────────────────────────────────────

export interface PolicyInspectResult {
  activePolicy: PolicySet | null;
  policyVersion: number | null;
  contentHash: string | null;
  allPolicies: PolicySet[];
  recentEvents: PolicyEvent[];
}

export function policyInspect(policyStore: PolicyStore, scope: string = 'global'): PolicyInspectResult {
  const active = policyStore.getActivePolicy(scope);
  return {
    activePolicy: active ?? null,
    policyVersion: active?.policyVersion ?? null,
    contentHash: active?.contentHash ?? null,
    allPolicies: policyStore.listPolicySets({ scope }),
    recentEvents: policyStore.getEvents({ limit: 20 }),
  };
}

// ── Show ─────────────────────────────────────────────────────────────

export interface PolicyShowResult {
  ok: true;
  policy: PolicySet;
  events: PolicyEvent[];
}

export interface PolicyShowError {
  ok: false;
  error: string;
}

export function policyShow(policyStore: PolicyStore, policySetId: string): PolicyShowResult | PolicyShowError {
  const policy = policyStore.getPolicySet(policySetId);
  if (!policy) {
    return { ok: false, error: `Policy '${policySetId}' not found` };
  }
  return {
    ok: true,
    policy,
    events: policyStore.getEvents({ policySetId }),
  };
}

// ── Diff ─────────────────────────────────────────────────────────────

export interface PolicyDiffResult {
  ok: true;
  diffs: PolicyDiff[];
  fromId: string;
  toId: string;
}

export interface PolicyDiffError {
  ok: false;
  error: string;
}

export function policyDiff(
  policyStore: PolicyStore,
  fromId: string,
  toId: string,
): PolicyDiffResult | PolicyDiffError {
  const fromPolicy = policyStore.getPolicySet(fromId);
  if (!fromPolicy) return { ok: false, error: `Policy '${fromId}' not found` };

  const toPolicy = policyStore.getPolicySet(toId);
  if (!toPolicy) return { ok: false, error: `Policy '${toId}' not found` };

  return {
    ok: true,
    diffs: diffPolicies(fromPolicy.content, toPolicy.content),
    fromId,
    toId,
  };
}

// ── Simulate ─────────────────────────────────────────────────────────

export interface PolicySimulateResult {
  ok: true;
  simulation: SimulationResult;
}

export function policySimulate(
  policyStore: PolicyStore,
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  candidatePolicy: PolicySet,
  opts?: { lane?: RoutingLane },
): PolicySimulateResult {
  const simulation = simulatePolicy(
    policyStore, flowStore, routingStore, supervisorStore,
    queueStore, interventionStore, candidatePolicy.content, opts,
  );
  return { ok: true, simulation };
}
