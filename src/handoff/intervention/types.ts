/**
 * Intervention Law — Types.
 *
 * Deterministic health states, breach detection, and intervention actions
 * for the control plane's operating health.
 *
 * Law: unhealthy states are explicit, interventions are bounded,
 * and every transition is audited.
 */

import type { RoutingLane } from '../routing/types.js';

// ── Health states ───────────────────────────────────────────────────

export type HealthState =
  | 'healthy'       // lane is operating within normal parameters
  | 'pressured'     // lane is approaching limits (warning)
  | 'breached'      // lane has violated threshold rules
  | 'degraded'      // lane is operational but impaired
  | 'frozen';       // lane is locked — no new admissions or claims

// ── Breach codes ────────────────────────────────────────────────────

export type BreachCode =
  | 'prolonged_saturation'     // lane at cap for too long
  | 'repeated_starvation'      // too many starved items
  | 'overflow_backlog'         // overflow count above threshold
  | 'recovery_storm'           // recovery lane throttled repeatedly
  | 'claim_churn'              // claims expiring repeatedly without completion
  | 'reconciliation_drift';    // actual counts diverge from expected

// ── Intervention actions ────────────────────────────────────────────

export type InterventionAction =
  | 'freeze'                   // lock lane — no new claims or admissions
  | 'restrict'                 // deny new admissions but allow existing claims
  | 'escalate_priority'        // boost affected items' effective priority
  | 'force_recovery'           // reroute affected items to recovery lane
  | 'require_attention';       // flag for operator acknowledgment

export type InterventionStatus =
  | 'active'        // intervention is in effect
  | 'resolved'      // intervention has been explicitly resolved
  | 'expired';      // intervention expired (if time-bounded)

// ── Health snapshot ─────────────────────────────────────────────────

export interface HealthSnapshot {
  snapshotId: string;
  lane: RoutingLane;
  healthState: HealthState;
  breachCodes: BreachCode[];
  activeCount: number;
  pendingCount: number;
  overflowCount: number;
  starvedCount: number;
  wipCap: number;
  createdAt: string;
}

// ── Intervention record ─────────────────────────────────────────────

export interface Intervention {
  interventionId: string;
  lane: RoutingLane;
  action: InterventionAction;
  status: InterventionStatus;
  breachCodes: BreachCode[];
  reason: string;
  actor: string;
  triggeredAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolveReason: string | null;
}

// ── Intervention events ─────────────────────────────────────────────

export interface InterventionEvent {
  interventionId: string;
  lane: RoutingLane;
  kind: InterventionEventKind;
  fromState: HealthState;
  toState: HealthState;
  breachCodes: BreachCode[];
  action: InterventionAction | null;
  reasonCode: InterventionReasonCode;
  reason: string;
  actor: string;
  createdAt: string;
}

export type InterventionEventKind =
  | 'health_changed'          // health state transition
  | 'breach_detected'         // new breach condition found
  | 'intervention_started'    // intervention activated
  | 'intervention_resolved'   // intervention resolved/cleared
  | 'freeze_applied'          // lane frozen
  | 'freeze_lifted'           // lane unfrozen
  | 'restriction_applied'     // admission restricted
  | 'restriction_lifted';     // restriction removed

export type InterventionReasonCode =
  | 'breach_trigger'          // automatic breach detection
  | 'manual_intervention'     // operator-triggered
  | 'manual_resolve'          // operator-resolved
  | 'health_restored'         // conditions cleared automatically
  | 'freeze_ordered'          // explicit freeze command
  | 'unfreeze_ordered'        // explicit unfreeze command
  | 'escalation_applied'      // priority escalation applied
  | 'recovery_forced';        // forced recovery reroute

// ── Breach thresholds ───────────────────────────────────────────────

export interface BreachThresholds {
  /** How many consecutive health checks at saturation before breach (default: 3) */
  saturationChecks: number;
  /** How many starved items before breach (default: 3) */
  starvationCount: number;
  /** Overflow count above which breach triggers (default: 5) */
  overflowBacklog: number;
  /** Recovery throttle events before breach (default: 5) */
  recoveryStormEvents: number;
  /** Claim expiry events before breach (default: 5) */
  claimChurnEvents: number;
}

export const DEFAULT_BREACH_THRESHOLDS: BreachThresholds = {
  saturationChecks: 3,
  starvationCount: 3,
  overflowBacklog: 5,
  recoveryStormEvents: 5,
  claimChurnEvents: 5,
};
