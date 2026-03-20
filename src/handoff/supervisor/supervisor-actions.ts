/**
 * Supervisor Loop — Actions and transitions.
 *
 * Handles:
 *   - Claim: operator takes a lease on a queue item
 *   - Release: operator gives up the lease
 *   - Defer: operator postpones handling until later
 *   - Escalate: operator routes to higher review
 *   - Requeue: return deferred/escalated item to pending
 *   - Expire: reclaim expired leases
 *   - Interrupt: staleness/invalidation interrupts active claims
 *
 * Law: one active claim per queue item at a time. No silent collisions.
 */

import type { QueueStore } from '../queue/queue-store.js';
import type { QueueItem } from '../queue/types.js';
import { TERMINAL_STATUSES } from '../queue/types.js';
import type { SupervisorStore } from './supervisor-store.js';
import type { SupervisorClaim } from './types.js';
import { DEFAULT_LEASE_DURATION_MS } from './types.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Result types ────────────────────────────────────────────────────

export interface ClaimResult {
  ok: true;
  claim: SupervisorClaim;
}

export interface SupervisorError {
  ok: false;
  error: string;
  code: 'item_not_found' | 'item_terminal' | 'item_stale' | 'already_claimed'
    | 'claim_not_found' | 'claim_terminal' | 'not_claimer' | 'not_deferred'
    | 'not_escalated' | 'not_active';
}

// ── Claim ───────────────────────────────────────────────────────────

/**
 * Claim a queue item. Creates a durable lease.
 *
 * Pre-conditions:
 *   - Queue item exists and is not terminal
 *   - Queue item is not stale
 *   - No active claim exists (or active claim has expired)
 */
export function claimQueueItem(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  input: {
    queueItemId: string;
    actor: string;
    leaseDurationMs?: number;
  },
): ClaimResult | SupervisorError {
  const { queueItemId, actor } = input;
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;

  // Load queue item
  const item = queueStore.getQueueItem(queueItemId);
  if (!item) {
    return { ok: false, error: `Queue item '${queueItemId}' not found`, code: 'item_not_found' };
  }

  // Cannot claim terminal items
  if (TERMINAL_STATUSES.has(item.status)) {
    return { ok: false, error: `Queue item is in terminal state '${item.status}'`, code: 'item_terminal' };
  }

  // Cannot claim stale items
  if (item.status === 'stale') {
    return { ok: false, error: 'Queue item is stale — re-derive before claiming', code: 'item_stale' };
  }

  // Check for existing active claim
  const now = nowISO();
  const existingClaim = supervisorStore.getActiveClaim(queueItemId);
  if (existingClaim) {
    // Check if lease expired
    if (existingClaim.leaseExpiresAt > now) {
      return {
        ok: false,
        error: `Already claimed by '${existingClaim.claimedBy}' until ${existingClaim.leaseExpiresAt}`,
        code: 'already_claimed',
      };
    }
    // Expire the old claim
    expireClaim(supervisorStore, existingClaim, 'Lease expired — reclaimed');
  }

  // Also check for deferred claims — cannot claim while deferred
  const deferredClaim = supervisorStore.getActiveOrDeferredClaim(queueItemId);
  if (deferredClaim && deferredClaim.status === 'deferred') {
    // Check if defer period has passed
    if (deferredClaim.deferredUntil && deferredClaim.deferredUntil > now) {
      return {
        ok: false,
        error: `Item deferred until ${deferredClaim.deferredUntil} by '${deferredClaim.claimedBy}'`,
        code: 'already_claimed',
      };
    }
    // Defer period passed — release it
    supervisorStore.updateClaimStatus(deferredClaim.claimId, 'released', 'Defer period expired');
    supervisorStore.insertEvent({
      claimId: deferredClaim.claimId,
      queueItemId,
      kind: 'released',
      fromStatus: 'deferred',
      toStatus: 'released',
      actor: 'system',
      reason: 'Defer period expired',
      createdAt: now,
    });
  }

  // Create the claim
  const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const claim: SupervisorClaim = {
    claimId: generateId('sc'),
    queueItemId,
    claimedBy: actor,
    claimedAt: now,
    status: 'active',
    leaseExpiresAt,
    deferredUntil: null,
    escalationTarget: null,
    lastReason: 'Claimed for review',
    updatedAt: now,
  };

  supervisorStore.insertClaim(claim);

  // Update queue item status to in_review
  if (item.status === 'pending') {
    queueStore.updateStatus(queueItemId, 'in_review');
    queueStore.insertEvent({
      queueItemId,
      kind: 'status_changed',
      fromStatus: item.status,
      toStatus: 'in_review',
      actor,
      reason: `Claimed by ${actor}`,
      createdAt: now,
    });
  }

  // Record supervisor event
  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId,
    kind: 'claimed',
    toStatus: 'active',
    actor,
    reason: 'Claimed for review',
    createdAt: now,
  });

  return { ok: true, claim };
}

// ── Release ─────────────────────────────────────────────────────────

/**
 * Release a claim. Returns item to pending state.
 */
export function releaseClaim(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  input: {
    queueItemId: string;
    actor: string;
    reason: string;
  },
): { ok: true } | SupervisorError {
  const { queueItemId, actor, reason } = input;
  const now = nowISO();

  const claim = supervisorStore.getActiveClaim(queueItemId);
  if (!claim) {
    return { ok: false, error: `No active claim on '${queueItemId}'`, code: 'claim_not_found' };
  }

  // Only the claimer can release
  if (claim.claimedBy !== actor) {
    return { ok: false, error: `Only '${claim.claimedBy}' can release this claim`, code: 'not_claimer' };
  }

  supervisorStore.updateClaimStatus(claim.claimId, 'released', reason);

  // Return queue item to pending
  const item = queueStore.getQueueItem(queueItemId);
  if (item && item.status === 'in_review') {
    queueStore.updateStatus(queueItemId, 'pending');
    queueStore.insertEvent({
      queueItemId,
      kind: 'status_changed',
      fromStatus: 'in_review',
      toStatus: 'pending',
      actor,
      reason: `Released: ${reason}`,
      createdAt: now,
    });
  }

  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId,
    kind: 'released',
    fromStatus: 'active',
    toStatus: 'released',
    actor,
    reason,
    createdAt: now,
  });

  return { ok: true };
}

// ── Defer ───────────────────────────────────────────────────────────

/**
 * Defer a claimed item until a specific time.
 * Item stays claimed but is removed from active next-item path.
 */
export function deferClaim(
  supervisorStore: SupervisorStore,
  input: {
    queueItemId: string;
    actor: string;
    deferredUntil: string;
    reason: string;
  },
): { ok: true; claim: SupervisorClaim } | SupervisorError {
  const { queueItemId, actor, deferredUntil, reason } = input;
  const now = nowISO();

  const claim = supervisorStore.getActiveClaim(queueItemId);
  if (!claim) {
    return { ok: false, error: `No active claim on '${queueItemId}'`, code: 'claim_not_found' };
  }

  if (claim.claimedBy !== actor) {
    return { ok: false, error: `Only '${claim.claimedBy}' can defer this claim`, code: 'not_claimer' };
  }

  supervisorStore.updateClaimDefer(claim.claimId, deferredUntil, reason);

  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId,
    kind: 'deferred',
    fromStatus: 'active',
    toStatus: 'deferred',
    actor,
    reason,
    metadata: JSON.stringify({ deferredUntil }),
    createdAt: now,
  });

  const updated = supervisorStore.getClaim(claim.claimId)!;
  return { ok: true, claim: updated };
}

// ── Escalate ────────────────────────────────────────────────────────

/**
 * Escalate a claimed item to a higher review target.
 */
export function escalateClaim(
  supervisorStore: SupervisorStore,
  input: {
    queueItemId: string;
    actor: string;
    target: string;
    reason: string;
  },
): { ok: true; claim: SupervisorClaim } | SupervisorError {
  const { queueItemId, actor, target, reason } = input;
  const now = nowISO();

  const claim = supervisorStore.getActiveClaim(queueItemId);
  if (!claim) {
    return { ok: false, error: `No active claim on '${queueItemId}'`, code: 'claim_not_found' };
  }

  if (claim.claimedBy !== actor) {
    return { ok: false, error: `Only '${claim.claimedBy}' can escalate this claim`, code: 'not_claimer' };
  }

  supervisorStore.updateClaimEscalate(claim.claimId, target, reason);

  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId,
    kind: 'escalated',
    fromStatus: 'active',
    toStatus: 'escalated',
    actor,
    reason,
    metadata: JSON.stringify({ escalationTarget: target }),
    createdAt: now,
  });

  const updated = supervisorStore.getClaim(claim.claimId)!;
  return { ok: true, claim: updated };
}

// ── Requeue ─────────────────────────────────────────────────────────

/**
 * Requeue a deferred or escalated item back to pending.
 * Creates a fresh claim opportunity.
 */
export function requeueClaim(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  input: {
    queueItemId: string;
    actor: string;
    reason: string;
  },
): { ok: true } | SupervisorError {
  const { queueItemId, actor, reason } = input;
  const now = nowISO();

  const claim = supervisorStore.getActiveOrDeferredClaim(queueItemId);
  if (!claim) {
    return { ok: false, error: `No active or deferred claim on '${queueItemId}'`, code: 'claim_not_found' };
  }

  if (claim.status !== 'deferred' && claim.status !== 'escalated' && claim.status !== 'active') {
    return { ok: false, error: `Cannot requeue claim in state '${claim.status}'`, code: 'claim_terminal' };
  }

  const oldStatus = claim.status;
  supervisorStore.updateClaimStatus(claim.claimId, 'released', reason);

  // Return queue item to pending
  const item = queueStore.getQueueItem(queueItemId);
  if (item && !TERMINAL_STATUSES.has(item.status) && item.status !== 'stale') {
    queueStore.updateStatus(queueItemId, 'pending');
    queueStore.insertEvent({
      queueItemId,
      kind: 'status_changed',
      fromStatus: item.status,
      toStatus: 'pending',
      actor,
      reason: `Requeued: ${reason}`,
      createdAt: now,
    });
  }

  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId,
    kind: 'requeued',
    fromStatus: oldStatus,
    toStatus: 'released',
    actor,
    reason,
    createdAt: now,
  });

  return { ok: true };
}

// ── Next resolver ───────────────────────────────────────────────────

export interface NextItemResult {
  ok: true;
  item: QueueItem;
  claimState: 'unclaimed' | 'expired';
}

export interface NextItemEmpty {
  ok: false;
  error: string;
  code: 'queue_empty';
}

/**
 * Deterministic "give me the next best lawful item."
 *
 * Skips:
 *   - Terminal items
 *   - Currently leased items (unless lease expired)
 *   - Deferred items (unless defer period passed)
 */
export function resolveNextItem(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
  opts?: { role?: 'reviewer' | 'approver' },
): NextItemResult | NextItemEmpty {
  const now = nowISO();
  const items = queueStore.listQueue({
    role: opts?.role,
    activeOnly: true,
  });

  for (const item of items) {
    // Skip stale items
    if (item.status === 'stale') continue;

    // Check claim state
    const claim = supervisorStore.getActiveOrDeferredClaim(item.queueItemId);

    if (!claim) {
      // Unclaimed — this is our next item
      return { ok: true, item, claimState: 'unclaimed' };
    }

    if (claim.status === 'active') {
      // Check lease expiry
      if (claim.leaseExpiresAt <= now) {
        return { ok: true, item, claimState: 'expired' };
      }
      // Actively claimed — skip
      continue;
    }

    if (claim.status === 'deferred') {
      // Check defer expiry
      if (claim.deferredUntil && claim.deferredUntil <= now) {
        return { ok: true, item, claimState: 'expired' };
      }
      // Still deferred — skip
      continue;
    }
  }

  return { ok: false, error: 'No eligible items in queue', code: 'queue_empty' };
}

// ── Lease expiry sweep ──────────────────────────────────────────────

/**
 * Sweep for expired leases and mark them.
 * Returns the number of claims expired.
 */
export function sweepExpiredLeases(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
): number {
  const now = nowISO();
  const expired = supervisorStore.findExpiredClaims(now);
  let count = 0;

  for (const claim of expired) {
    expireClaim(supervisorStore, claim, 'Lease expired during sweep');

    // Return queue item to pending if it was in_review
    const item = queueStore.getQueueItem(claim.queueItemId);
    if (item && item.status === 'in_review') {
      queueStore.updateStatus(claim.queueItemId, 'pending');
      queueStore.insertEvent({
        queueItemId: claim.queueItemId,
        kind: 'status_changed',
        fromStatus: 'in_review',
        toStatus: 'pending',
        actor: 'system',
        reason: 'Lease expired — item returned to pending',
        createdAt: now,
      });
    }
    count++;
  }

  return count;
}

// ── Staleness interruption ──────────────────────────────────────────

/**
 * Interrupt active claims on items that have become stale.
 * Returns the number of claims interrupted.
 */
export function interruptStaleClaims(
  queueStore: QueueStore,
  supervisorStore: SupervisorStore,
): number {
  const now = nowISO();
  const activeClaims = supervisorStore.listClaims({ activeOnly: true });
  let count = 0;

  for (const claim of activeClaims) {
    const item = queueStore.getQueueItem(claim.queueItemId);
    if (!item) continue;

    if (item.status === 'stale' || TERMINAL_STATUSES.has(item.status)) {
      const oldStatus = claim.status;
      supervisorStore.updateClaimStatus(claim.claimId, 'interrupted', `Item became ${item.status}`);
      supervisorStore.insertEvent({
        claimId: claim.claimId,
        queueItemId: claim.queueItemId,
        kind: 'interrupted',
        fromStatus: oldStatus,
        toStatus: 'interrupted',
        actor: 'system',
        reason: `Item transitioned to '${item.status}' while claimed`,
        createdAt: now,
      });
      count++;
    }
  }

  return count;
}

// ── Internal ────────────────────────────────────────────────────────

function expireClaim(supervisorStore: SupervisorStore, claim: SupervisorClaim, reason: string): void {
  const now = nowISO();
  supervisorStore.updateClaimStatus(claim.claimId, 'expired', reason);
  supervisorStore.insertEvent({
    claimId: claim.claimId,
    queueItemId: claim.queueItemId,
    kind: 'lease_expired',
    fromStatus: 'active',
    toStatus: 'expired',
    actor: 'system',
    reason,
    createdAt: now,
  });
}
