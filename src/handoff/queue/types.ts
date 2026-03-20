/**
 * Decision Queue — Phase 4 canonical types.
 *
 * The queue is the operational surface for moving through
 * pending decision truths quickly and correctly under pressure.
 *
 * Queue ordering is deterministic and law-driven:
 *   recovery > blocked-high > blocked-medium > approvable > stale
 *
 * Queue items are derived from decision briefs, not invented.
 */

// ── Queue item status ───────────────────────────────────────────────

export type QueueItemStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'recovery_requested'
  | 'cleared'
  | 'stale';

export const TERMINAL_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  'approved', 'rejected', 'recovery_requested', 'cleared',
]);

// ── Priority class ──────────────────────────────────────────────────

/**
 * Deterministic priority classes, ordered from most urgent to least.
 * These are derived from state, not assigned by opinion.
 */
export type PriorityClass =
  | 'recovery_needed'    // invalidated or recovery-pending — act now
  | 'blocked_high'       // high-severity blockers — needs attention
  | 'blocked_medium'     // medium-severity blockers — needs review
  | 'approvable'         // no blockers — ready for signoff
  | 'informational';     // low/no blockers, reviewer-only items

/** Numeric sort weight: lower = more urgent */
export const PRIORITY_WEIGHT: Record<PriorityClass, number> = {
  recovery_needed: 0,
  blocked_high: 1,
  blocked_medium: 2,
  approvable: 3,
  informational: 4,
};

// ── Queue item ──────────────────────────────────────────────────────

export interface QueueItem {
  queueItemId: string;
  handoffId: string;
  packetVersion: number;
  briefId: string;
  role: 'reviewer' | 'approver';
  status: QueueItemStatus;
  priorityClass: PriorityClass;
  /** One-line blocker summary for triage display */
  blockerSummary: string;
  /** One-line eligibility summary for triage display */
  eligibilitySummary: string;
  /** Evidence fingerprint at queue time */
  evidenceFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

// ── Queue event (transition audit) ──────────────────────────────────

export type QueueEventKind =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'stale_detected'
  | 'invalidation_propagated'
  | 'action_bound';

export interface QueueEvent {
  eventId?: number;
  queueItemId: string;
  kind: QueueEventKind;
  fromStatus?: QueueItemStatus;
  toStatus?: QueueItemStatus;
  fromPriority?: PriorityClass;
  toPriority?: PriorityClass;
  actor: string;
  reason: string;
  /** Linked action ID if kind === 'action_bound' */
  actionId?: string;
  createdAt: string;
}
