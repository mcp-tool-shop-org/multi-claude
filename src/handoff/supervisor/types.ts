/**
 * Supervisor Loop — Phase 5 canonical types.
 *
 * The supervisor loop turns the decision queue from a static
 * judgment surface into a continuous operator workflow.
 *
 * Core state model:
 *   - Claims: durable, collision-safe operator leases on queue items
 *   - Transitions: claim, release, defer, escalate, requeue
 *   - Audit: every transition is traced to actor + reason
 */

// ── Claim state ─────────────────────────────────────────────────────

export type ClaimStatus =
  | 'active'      // operator is actively working this item
  | 'released'    // operator released the claim
  | 'expired'     // lease timed out
  | 'completed'   // action was taken from claimed state
  | 'interrupted' // staleness/invalidation interrupted the claim
  | 'deferred'    // operator deferred for later
  | 'escalated';  // operator escalated to higher review

export const TERMINAL_CLAIM_STATUSES: ReadonlySet<ClaimStatus> = new Set([
  'released', 'expired', 'completed', 'interrupted',
]);

export interface SupervisorClaim {
  claimId: string;
  queueItemId: string;
  claimedBy: string;
  claimedAt: string;
  status: ClaimStatus;
  /** When this lease expires (ISO timestamp) */
  leaseExpiresAt: string;
  /** If deferred, when it becomes eligible again */
  deferredUntil: string | null;
  /** If escalated, who/what it was escalated to */
  escalationTarget: string | null;
  /** Reason for last status change */
  lastReason: string;
  updatedAt: string;
}

// ── Supervisor events (audit trail) ─────────────────────────────────

export type SupervisorEventKind =
  | 'claimed'
  | 'released'
  | 'lease_expired'
  | 'reclaimed'
  | 'deferred'
  | 'escalated'
  | 'requeued'
  | 'action_taken'
  | 'interrupted';

export interface SupervisorEvent {
  eventId?: number;
  claimId: string;
  queueItemId: string;
  kind: SupervisorEventKind;
  fromStatus?: ClaimStatus;
  toStatus: ClaimStatus;
  actor: string;
  reason: string;
  metadata?: string;
  createdAt: string;
}

// ── Default lease duration ──────────────────────────────────────────

/** Default lease duration in milliseconds (15 minutes) */
export const DEFAULT_LEASE_DURATION_MS = 15 * 60 * 1000;
