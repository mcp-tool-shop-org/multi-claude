/**
 * Policy Control — Actions.
 *
 * Handles:
 *   - Policy creation with content hash
 *   - Validation (deterministic, no model opinion)
 *   - Activation / supersession
 *   - Rollback to prior version
 *   - Diff between policy versions
 *   - Simulation (read-only impact preview)
 *   - Active policy resolution
 *
 * Law: policy versions are durable, validated before activation,
 * and every runtime decision binds to the active version.
 */

import { createHash } from 'crypto';
import type { RoutingLane } from '../routing/types.js';
import { ALL_LANES } from '../routing/types.js';
import type { FlowStore } from '../flow/flow-store.js';
import type { RoutingStore } from '../routing/routing-store.js';
import type { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { QueueStore } from '../queue/queue-store.js';
import type { InterventionStore } from '../intervention/intervention-store.js';
import { computeLaneState, detectStarvation } from '../flow/flow-actions.js';
import { deriveHealthSnapshot } from '../intervention/intervention-actions.js';
import type { PolicyStore } from './policy-store.js';
import type {
  PolicySet,
  PolicyContent,
  ValidationResult,
  ValidationError,
  PolicyDiff,
  SimulationResult,
} from './types.js';
import { DEFAULT_POLICY_CONTENT } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Content hash ────────────────────────────────────────────────────

export function computePolicyHash(content: PolicyContent): string {
  const sorted = JSON.stringify(content, Object.keys(content).sort());
  return createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

// ── Validation ──────────────────────────────────────────────────────

/**
 * Validate policy content deterministically.
 */
export function validatePolicy(content: PolicyContent): ValidationResult | ValidationError {
  const errors: string[] = [];

  // Lane caps
  for (const lane of ALL_LANES) {
    const cap = content.laneCaps[lane];
    if (cap === undefined || cap === null) {
      errors.push(`Missing laneCap for '${lane}'`);
    } else if (cap < 1) {
      errors.push(`laneCap for '${lane}' must be >= 1, got ${cap}`);
    }
  }

  // Starvation thresholds
  for (const lane of ALL_LANES) {
    const threshold = content.starvationThresholdMs[lane];
    if (threshold === undefined || threshold === null) {
      errors.push(`Missing starvationThresholdMs for '${lane}'`);
    } else if (threshold < 0) {
      errors.push(`starvationThresholdMs for '${lane}' must be >= 0, got ${threshold}`);
    }
  }

  // Overflow thresholds
  for (const lane of ALL_LANES) {
    const threshold = content.overflowThreshold[lane];
    if (threshold === undefined || threshold === null) {
      errors.push(`Missing overflowThreshold for '${lane}'`);
    } else if (threshold < 1) {
      errors.push(`overflowThreshold for '${lane}' must be >= 1, got ${threshold}`);
    }
  }

  // Recovery throttle
  if (content.recoveryThrottle < 1) {
    errors.push(`recoveryThrottle must be >= 1, got ${content.recoveryThrottle}`);
  }

  // Breach thresholds
  const bt = content.breachThresholds;
  if (bt.saturationChecks < 1) errors.push(`breachThresholds.saturationChecks must be >= 1`);
  if (bt.starvationCount < 1) errors.push(`breachThresholds.starvationCount must be >= 1`);
  if (bt.overflowBacklog < 1) errors.push(`breachThresholds.overflowBacklog must be >= 1`);
  if (bt.recoveryStormEvents < 1) errors.push(`breachThresholds.recoveryStormEvents must be >= 1`);
  if (bt.claimChurnEvents < 1) errors.push(`breachThresholds.claimChurnEvents must be >= 1`);

  // Lease duration
  if (content.leaseDurationMs < 1000) {
    errors.push(`leaseDurationMs must be >= 1000ms, got ${content.leaseDurationMs}`);
  }

  // Defer resurface interval
  if (content.deferResurfaceIntervalMs < 1000) {
    errors.push(`deferResurfaceIntervalMs must be >= 1000ms, got ${content.deferResurfaceIntervalMs}`);
  }

  // Routing defaults must reference valid lanes
  for (const lane of ALL_LANES) {
    if (!(lane in content.routingDefaults)) {
      errors.push(`Missing routingDefault for '${lane}'`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

// ── Create ──────────────────────────────────────────────────────────

export interface CreatePolicyResult {
  ok: true;
  policySet: PolicySet;
}

export interface CreatePolicyError {
  ok: false;
  error: string;
  code: 'validation_failed';
  errors?: string[];
}

/**
 * Create a new policy set. Validates content on creation.
 */
export function createPolicySet(
  policyStore: PolicyStore,
  input: {
    content: PolicyContent;
    scope?: string;
    reason: string;
    actor: string;
  },
): CreatePolicyResult | CreatePolicyError {
  const { content, scope = 'global', reason, actor } = input;

  const validation = validatePolicy(content);
  if (!validation.valid) {
    return {
      ok: false,
      error: `Policy validation failed: ${validation.errors.join('; ')}`,
      code: 'validation_failed',
      errors: validation.errors,
    };
  }

  const now = nowISO();
  const version = policyStore.getNextVersion(scope);

  const ps: PolicySet = {
    policySetId: generateId('ps'),
    policyVersion: version,
    status: 'validated',
    scope,
    content,
    contentHash: computePolicyHash(content),
    reason,
    createdBy: actor,
    createdAt: now,
    activatedAt: null,
    supersededAt: null,
  };

  policyStore.insertPolicySet(ps);

  policyStore.insertEvent({
    policySetId: ps.policySetId,
    kind: 'created',
    fromStatus: null,
    toStatus: 'validated',
    reason,
    actor,
    createdAt: now,
  });

  return { ok: true, policySet: ps };
}

// ── Activation ──────────────────────────────────────────────────────

export interface ActivateResult {
  ok: true;
  activated: PolicySet;
  superseded: PolicySet | null;
}

export interface ActivateError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'already_active';
}

/**
 * Activate a policy set, superseding the current active one.
 */
export function activatePolicy(
  policyStore: PolicyStore,
  input: {
    policySetId: string;
    actor: string;
    reason: string;
  },
): ActivateResult | ActivateError {
  const { policySetId, actor, reason } = input;

  const ps = policyStore.getPolicySet(policySetId);
  if (!ps) {
    return { ok: false, error: `Policy '${policySetId}' not found`, code: 'not_found' };
  }

  if (ps.status === 'active') {
    return { ok: false, error: `Policy '${policySetId}' is already active`, code: 'already_active' };
  }

  if (ps.status !== 'validated' && ps.status !== 'rolled_back') {
    return {
      ok: false,
      error: `Cannot activate policy in '${ps.status}' status (must be 'validated' or 'rolled_back')`,
      code: 'invalid_status',
    };
  }

  const now = nowISO();

  // Supersede current active policy
  const current = policyStore.getActivePolicy(ps.scope);
  let superseded: PolicySet | null = null;
  if (current) {
    policyStore.updateSupersededAt(current.policySetId, now);
    policyStore.insertEvent({
      policySetId: current.policySetId,
      kind: 'superseded',
      fromStatus: 'active',
      toStatus: 'superseded',
      reason: `Superseded by ${policySetId}`,
      actor,
      createdAt: now,
    });
    superseded = policyStore.getPolicySet(current.policySetId)!;
  }

  // Activate new policy
  policyStore.updateActivatedAt(policySetId, now);
  policyStore.insertEvent({
    policySetId,
    kind: 'activated',
    fromStatus: ps.status,
    toStatus: 'active',
    reason,
    actor,
    createdAt: now,
  });

  const activated = policyStore.getPolicySet(policySetId)!;
  return { ok: true, activated, superseded };
}

// ── Rollback ────────────────────────────────────────────────────────

export interface RollbackResult {
  ok: true;
  rolledBack: PolicySet;
  restored: PolicySet;
}

export interface RollbackError {
  ok: false;
  error: string;
  code: 'not_found' | 'invalid_status' | 'no_active_policy';
}

/**
 * Rollback to a prior policy version.
 * The current active policy is rolled_back, and the target is re-activated.
 */
export function rollbackPolicy(
  policyStore: PolicyStore,
  input: {
    targetPolicySetId: string;
    actor: string;
    reason: string;
  },
): RollbackResult | RollbackError {
  const { targetPolicySetId, actor, reason } = input;

  const target = policyStore.getPolicySet(targetPolicySetId);
  if (!target) {
    return { ok: false, error: `Target policy '${targetPolicySetId}' not found`, code: 'not_found' };
  }

  if (target.status !== 'superseded') {
    return {
      ok: false,
      error: `Cannot rollback to policy in '${target.status}' status (must be 'superseded')`,
      code: 'invalid_status',
    };
  }

  const current = policyStore.getActivePolicy(target.scope);
  if (!current) {
    return { ok: false, error: 'No active policy to rollback from', code: 'no_active_policy' };
  }

  const now = nowISO();

  // Roll back current
  policyStore.updateStatus(current.policySetId, 'rolled_back');
  policyStore.insertEvent({
    policySetId: current.policySetId,
    kind: 'rolled_back',
    fromStatus: 'active',
    toStatus: 'rolled_back',
    reason: `Rolled back in favor of ${targetPolicySetId}`,
    actor,
    createdAt: now,
  });

  // Re-activate target
  policyStore.updateActivatedAt(targetPolicySetId, now);
  policyStore.insertEvent({
    policySetId: targetPolicySetId,
    kind: 'activated',
    fromStatus: 'superseded',
    toStatus: 'active',
    reason,
    actor,
    createdAt: now,
  });

  const rolledBack = policyStore.getPolicySet(current.policySetId)!;
  const restored = policyStore.getPolicySet(targetPolicySetId)!;
  return { ok: true, rolledBack, restored };
}

// ── Active policy resolver ──────────────────────────────────────────

/**
 * Resolve the active policy content for a scope.
 * Falls back to DEFAULT_POLICY_CONTENT if no active policy exists.
 */
export function resolveActivePolicy(
  policyStore: PolicyStore,
  scope: string = 'global',
): { content: PolicyContent; policySetId: string | null; policyVersion: number | null } {
  const active = policyStore.getActivePolicy(scope);
  if (active) {
    return {
      content: active.content,
      policySetId: active.policySetId,
      policyVersion: active.policyVersion,
    };
  }
  return { content: DEFAULT_POLICY_CONTENT, policySetId: null, policyVersion: null };
}

// ── Diff ────────────────────────────────────────────────────────────

/**
 * Compute diff between two policy contents.
 */
export function diffPolicies(
  oldContent: PolicyContent,
  newContent: PolicyContent,
): PolicyDiff[] {
  const diffs: PolicyDiff[] = [];

  // Lane caps
  for (const lane of ALL_LANES) {
    if (oldContent.laneCaps[lane] !== newContent.laneCaps[lane]) {
      diffs.push({ field: 'laneCaps', lane, oldValue: oldContent.laneCaps[lane], newValue: newContent.laneCaps[lane] });
    }
  }

  // Starvation thresholds
  for (const lane of ALL_LANES) {
    if (oldContent.starvationThresholdMs[lane] !== newContent.starvationThresholdMs[lane]) {
      diffs.push({ field: 'starvationThresholdMs', lane, oldValue: oldContent.starvationThresholdMs[lane], newValue: newContent.starvationThresholdMs[lane] });
    }
  }

  // Overflow thresholds
  for (const lane of ALL_LANES) {
    if (oldContent.overflowThreshold[lane] !== newContent.overflowThreshold[lane]) {
      diffs.push({ field: 'overflowThreshold', lane, oldValue: oldContent.overflowThreshold[lane], newValue: newContent.overflowThreshold[lane] });
    }
  }

  // Routing defaults
  for (const lane of ALL_LANES) {
    if (oldContent.routingDefaults[lane] !== newContent.routingDefaults[lane]) {
      diffs.push({ field: 'routingDefaults', lane, oldValue: oldContent.routingDefaults[lane], newValue: newContent.routingDefaults[lane] });
    }
  }

  // Scalar fields
  const scalars: (keyof PolicyContent)[] = [
    'recoveryThrottle', 'escalationTarget', 'leaseDurationMs', 'deferResurfaceIntervalMs',
  ];
  for (const key of scalars) {
    if (oldContent[key] !== newContent[key]) {
      diffs.push({ field: key, oldValue: oldContent[key], newValue: newContent[key] });
    }
  }

  // Breach thresholds
  const btKeys: (keyof typeof oldContent.breachThresholds)[] = [
    'saturationChecks', 'starvationCount', 'overflowBacklog', 'recoveryStormEvents', 'claimChurnEvents',
  ];
  for (const key of btKeys) {
    if (oldContent.breachThresholds[key] !== newContent.breachThresholds[key]) {
      diffs.push({ field: `breachThresholds.${key}`, oldValue: oldContent.breachThresholds[key], newValue: newContent.breachThresholds[key] });
    }
  }

  return diffs;
}

// ── Simulation ──────────────────────────────────────────────────────

/**
 * Simulate the impact of a candidate policy against current state.
 * Read-only — does not mutate any state.
 */
export function simulatePolicy(
  policyStore: PolicyStore,
  flowStore: FlowStore,
  routingStore: RoutingStore,
  supervisorStore: SupervisorStore,
  queueStore: QueueStore,
  interventionStore: InterventionStore,
  candidateContent: PolicyContent,
  opts?: { lane?: RoutingLane },
): SimulationResult {
  const current = resolveActivePolicy(policyStore);
  const diffs = diffPolicies(current.content, candidateContent);
  const impact: string[] = [];

  const lanesToCheck = opts?.lane ? [opts.lane] : ALL_LANES;

  for (const lane of lanesToCheck) {
    const laneState = computeLaneState(flowStore, routingStore, supervisorStore, lane);

    // Cap change impact
    const oldCap = current.content.laneCaps[lane];
    const newCap = candidateContent.laneCaps[lane];
    if (oldCap !== newCap) {
      if (newCap < laneState.activeCount) {
        impact.push(`${lane}: new cap ${newCap} < active count ${laneState.activeCount} — would be immediately saturated`);
      } else if (newCap < oldCap) {
        impact.push(`${lane}: cap reduced ${oldCap} → ${newCap}`);
      } else {
        impact.push(`${lane}: cap increased ${oldCap} → ${newCap}`);
      }
    }

    // Overflow threshold change
    const oldOverflow = current.content.overflowThreshold[lane];
    const newOverflow = candidateContent.overflowThreshold[lane];
    if (oldOverflow !== newOverflow && laneState.overflowCount > 0) {
      if (laneState.overflowCount >= newOverflow) {
        impact.push(`${lane}: overflow ${laneState.overflowCount} >= new threshold ${newOverflow} — would trigger breach`);
      }
    }

    // Starvation threshold change
    const oldStarv = current.content.starvationThresholdMs[lane];
    const newStarv = candidateContent.starvationThresholdMs[lane];
    if (oldStarv !== newStarv) {
      const starved = detectStarvation(queueStore, routingStore, supervisorStore, newStarv)
        .filter(s => s.lane === lane);
      if (starved.length > 0) {
        impact.push(`${lane}: ${starved.length} items would become starved under new threshold`);
      }
    }

    // Health impact
    const snapshot = deriveHealthSnapshot(
      flowStore, routingStore, supervisorStore, queueStore, interventionStore, lane,
      candidateContent.breachThresholds,
    );
    if (snapshot.healthState !== 'healthy') {
      impact.push(`${lane}: health would be '${snapshot.healthState}' under candidate policy`);
    }
  }

  return { diffs, impactSummary: impact };
}
