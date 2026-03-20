/**
 * Supervisor Loop — Phase 5 tests.
 *
 * Tests the supervisory workflow:
 *   - Claim succeeds on unclaimed pending item
 *   - Second claim fails while lease is active
 *   - Expired lease can be reclaimed
 *   - Terminal item cannot be claimed
 *   - next skips claimed items
 *   - next skips terminal items
 *   - next respects role filter
 *   - Defer removes item from active next path
 *   - Escalate updates supervisor state correctly
 *   - Release returns item to lawful queue state
 *   - Requeue restores pending state
 *   - Stale/invalidation interrupts active claim
 *   - End-to-end: next → claim → inspect → decide
 *   - End-to-end: next → claim → defer → later requeue → decide
 *   - End-to-end: claim conflict between two actors
 *   - End-to-end: lease expiry → reclaim → action
 */

import { describe, it, expect } from 'vitest';
import { openDb, migrateDb } from '../../src/db/connection.js';
import { migrateHandoffSchema } from '../../src/handoff/store/handoff-sql.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { QueueStore } from '../../src/handoff/queue/queue-store.js';
import { SupervisorStore } from '../../src/handoff/supervisor/supervisor-store.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { enqueueHandoff, listQueue } from '../../src/handoff/api/queue-api.js';
import { actOnQueueItem, propagateStaleness } from '../../src/handoff/queue/queue-actions.js';
import { enqueueDecisionBrief } from '../../src/handoff/queue/derive-queue-item.js';
import { deriveDecisionBrief } from '../../src/handoff/decision/derive-decision-brief.js';
import { invalidatePacketVersion } from '../../src/handoff/integrity/invalidation-engine.js';
import { bridgeExecutionPacket } from '../../src/handoff/bridge/execution-to-handoff.js';
import {
  claimQueueItem,
  releaseClaim,
  deferClaim,
  escalateClaim,
  requeueClaim,
  resolveNextItem,
  sweepExpiredLeases,
  interruptStaleClaims,
} from '../../src/handoff/supervisor/supervisor-actions.js';
import { supervisedInspect } from '../../src/handoff/api/supervisor-api.js';
import type { HandoffId } from '../../src/handoff/schema/packet.js';
import type { DecisionBrief } from '../../src/handoff/decision/types.js';
import { tempDbPath } from './helpers.js';
import { nowISO } from '../../src/lib/ids.js';

// ── Test fixture ─────────────────────────────────────────────────────

function seedFullDb(dbPath: string) {
  const db = openDb(dbPath);
  migrateDb(db);
  migrateHandoffSchema(db);

  db.prepare(`
    INSERT INTO verification_profiles (verification_profile_id, repo_slug, layer, name, rule_profile, steps, created_at)
    VALUES ('vp-test', 'test-repo', 'backend', 'test-profile', 'builder', '[]', '2026-03-20T00:00:00Z')
  `).run();

  db.prepare(`
    INSERT INTO features (feature_id, repo_slug, title, objective, status, merge_target, acceptance_criteria, created_by)
    VALUES ('feat-sv', 'test-repo', 'Supervisor test', 'Test supervisor loop', 'in_progress', 'main', '["Works"]', 'test')
  `).run();

  db.prepare(`
    INSERT INTO packets (
      packet_id, feature_id, title, layer, descriptor, role, playbook_id,
      status, goal, allowed_files, forbidden_files,
      verification_profile_id, contract_delta_policy, knowledge_writeback_required, created_by
    ) VALUES (
      'pkt-sv-001', 'feat-sv', 'Supervisor test packet', 'backend', 'sv-test', 'builder', 'pb-builder',
      'failed', 'Build the supervisor loop', '["src/supervisor/**"]', '["src/secrets/**"]',
      'vp-test', 'declare', 0, 'test'
    )
  `).run();

  db.close();
  return dbPath;
}

function createHandoffForPacket(dbPath: string, packetId: string, runId: string): string {
  const db = openDb(dbPath);
  try {
    const store = new HandoffStore(db);
    const bridge = bridgeExecutionPacket({ db, packetId, runId });
    if (!bridge.ok) throw new Error(bridge.error);
    const result = createHandoff(store, bridge.input);
    return result.packet.handoffId;
  } finally {
    db.close();
  }
}

function openAllStores(dbPath: string) {
  const db = openDb(dbPath);
  const handoffStore = new HandoffStore(db);
  handoffStore.migrate();
  const queueStore = new QueueStore(db);
  queueStore.migrate();
  const supervisorStore = new SupervisorStore(db);
  supervisorStore.migrate();
  return { db, handoffStore, queueStore, supervisorStore };
}

function enqueueTestItem(handoffStore: HandoffStore, queueStore: QueueStore, handoffId: string, role: 'reviewer' | 'approver' = 'reviewer') {
  const packet = handoffStore.reconstructPacket(handoffId as HandoffId)!;
  const result = deriveDecisionBrief({
    store: handoffStore, packet, role, fingerprint: `fp-${role}-${Date.now()}`,
  });
  if (!result.ok) throw new Error(result.error);
  return enqueueDecisionBrief(queueStore, result.brief, 'test');
}

// ── Claim tests ──────────────────────────────────────────────────────

describe('claim operations', () => {
  it('claims an unclaimed pending item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      const result = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.claim.claimId).toMatch(/^sc-/);
      expect(result.claim.claimedBy).toBe('operator-A');
      expect(result.claim.status).toBe('active');
      expect(result.claim.queueItemId).toBe(item.queueItemId);

      // Queue item should be in_review
      const updated = queueStore.getQueueItem(item.queueItemId)!;
      expect(updated.status).toBe('in_review');

      // Supervisor event recorded
      const events = supervisorStore.getEvents(result.claim.claimId);
      expect(events.length).toBe(1);
      expect(events[0]!.kind).toBe('claimed');
    } finally {
      db.close();
    }
  });

  it('rejects second claim while lease is active', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      // First claim
      const first = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });
      expect(first.ok).toBe(true);

      // Second claim by different operator
      const second = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-B',
      });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.code).toBe('already_claimed');
      expect(second.error).toContain('operator-A');
    } finally {
      db.close();
    }
  });

  it('allows reclaim after lease expires', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      // Claim with very short lease (already expired)
      const first = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        leaseDurationMs: -1000, // already expired
      });
      expect(first.ok).toBe(true);

      // Second claim should succeed (lease expired)
      const second = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-B',
      });

      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.claim.claimedBy).toBe('operator-B');

      // Old claim should be expired
      if (first.ok) {
        const old = supervisorStore.getClaim(first.claim.claimId)!;
        expect(old.status).toBe('expired');
      }
    } finally {
      db.close();
    }
  });

  it('rejects claim on terminal item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      queueStore.updateStatus(item.queueItemId, 'approved');

      const result = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('item_terminal');
    } finally {
      db.close();
    }
  });

  it('rejects claim on stale item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);
      queueStore.updateStatus(item.queueItemId, 'stale');

      const result = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('item_stale');
    } finally {
      db.close();
    }
  });
});

// ── Release tests ────────────────────────────────────────────────────

describe('release operations', () => {
  it('releases a claim and returns item to pending', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      const claimed = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });
      expect(claimed.ok).toBe(true);

      const released = releaseClaim(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        reason: 'Need more info',
      });

      expect(released.ok).toBe(true);

      // Item back to pending
      const updated = queueStore.getQueueItem(item.queueItemId)!;
      expect(updated.status).toBe('pending');

      // Claim status updated
      if (claimed.ok) {
        const claim = supervisorStore.getClaim(claimed.claim.claimId)!;
        expect(claim.status).toBe('released');
      }
    } finally {
      db.close();
    }
  });

  it('rejects release by non-claimer', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const result = releaseClaim(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-B',
        reason: 'Not mine',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('not_claimer');
    } finally {
      db.close();
    }
  });
});

// ── Defer tests ──────────────────────────────────────────────────────

describe('defer operations', () => {
  it('defers a claimed item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const futureTime = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const result = deferClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        deferredUntil: futureTime,
        reason: 'Waiting for external review',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.claim.status).toBe('deferred');
      expect(result.claim.deferredUntil).toBe(futureTime);
    } finally {
      db.close();
    }
  });

  it('deferred item is skipped by next', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const futureTime = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      deferClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        deferredUntil: futureTime,
        reason: 'Later',
      });

      // Next should find nothing (only item is deferred)
      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(false);
    } finally {
      db.close();
    }
  });
});

// ── Escalate tests ───────────────────────────────────────────────────

describe('escalate operations', () => {
  it('escalates a claimed item', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const result = escalateClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        target: 'senior-reviewer',
        reason: 'Complex decision, needs expert review',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.claim.status).toBe('escalated');
      expect(result.claim.escalationTarget).toBe('senior-reviewer');
    } finally {
      db.close();
    }
  });
});

// ── Requeue tests ────────────────────────────────────────────────────

describe('requeue operations', () => {
  it('requeues a deferred item back to pending', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const futureTime = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      deferClaim(supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        deferredUntil: futureTime,
        reason: 'Waiting',
      });

      const result = requeueClaim(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        reason: 'Ready to handle now',
      });

      expect(result.ok).toBe(true);

      // Item back to pending
      const updated = queueStore.getQueueItem(item.queueItemId)!;
      expect(updated.status).toBe('pending');

      // Now next should return this item
      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});

// ── Next resolver tests ──────────────────────────────────────────────

describe('next resolver', () => {
  it('skips claimed items', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item1 = enqueueTestItem(handoffStore, queueStore, handoffId, 'reviewer');
      const item2 = enqueueTestItem(handoffStore, queueStore, handoffId, 'approver');

      // Claim item1
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item1.queueItemId,
        actor: 'operator-A',
      });

      // Next should return item2 (item1 is claimed)
      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(next.item.queueItemId).toBe(item2.queueItemId);
    } finally {
      db.close();
    }
  });

  it('returns expired lease item as claimable', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      // Claim with expired lease
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        leaseDurationMs: -1000,
      });

      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(next.item.queueItemId).toBe(item.queueItemId);
      expect(next.claimState).toBe('expired');
    } finally {
      db.close();
    }
  });

  it('respects role filter', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      enqueueTestItem(handoffStore, queueStore, handoffId, 'reviewer');
      enqueueTestItem(handoffStore, queueStore, handoffId, 'approver');

      const reviewerNext = resolveNextItem(queueStore, supervisorStore, { role: 'reviewer' });
      expect(reviewerNext.ok).toBe(true);
      if (reviewerNext.ok) expect(reviewerNext.item.role).toBe('reviewer');

      const approverNext = resolveNextItem(queueStore, supervisorStore, { role: 'approver' });
      expect(approverNext.ok).toBe(true);
      if (approverNext.ok) expect(approverNext.item.role).toBe('approver');
    } finally {
      db.close();
    }
  });

  it('returns empty when all items claimed or terminal', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(false);
    } finally {
      db.close();
    }
  });
});

// ── Lease expiry sweep ───────────────────────────────────────────────

describe('lease expiry', () => {
  it('sweeps expired leases', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        leaseDurationMs: -1000,
      });

      const count = sweepExpiredLeases(queueStore, supervisorStore);
      expect(count).toBe(1);

      // Item back to pending
      const updated = queueStore.getQueueItem(item.queueItemId)!;
      expect(updated.status).toBe('pending');
    } finally {
      db.close();
    }
  });
});

// ── Staleness interruption ───────────────────────────────────────────

describe('staleness interruption', () => {
  it('interrupts active claim when item becomes stale', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      const claimed = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });
      expect(claimed.ok).toBe(true);

      // Make item stale
      invalidatePacketVersion(handoffStore, {
        handoffId, packetVersion: 1,
        reasonCode: 'manual', reason: 'Staleness interruption test',
      });
      propagateStaleness(handoffStore, queueStore);

      // Interrupt stale claims
      const interrupted = interruptStaleClaims(queueStore, supervisorStore);
      expect(interrupted).toBe(1);

      // Claim should be interrupted
      if (claimed.ok) {
        const claim = supervisorStore.getClaim(claimed.claim.claimId)!;
        expect(claim.status).toBe('interrupted');
      }

      // Events recorded
      if (claimed.ok) {
        const events = supervisorStore.getEvents(claimed.claim.claimId);
        const interruptEvent = events.find(e => e.kind === 'interrupted');
        expect(interruptEvent).toBeDefined();
      }
    } finally {
      db.close();
    }
  });
});

// ── Supervised inspect ───────────────────────────────────────────────

describe('supervised inspect', () => {
  it('shows claim state in inspect output', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      // Unclaimed
      const unclaimed = supervisedInspect(queueStore, supervisorStore, item.queueItemId, 'operator-A');
      expect(unclaimed.ok).toBe(true);
      if (!unclaimed.ok) return;
      expect(unclaimed.claimStatus).toBe('unclaimed');
      expect(unclaimed.canClaim).toBe(true);

      // Claim it
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });

      // Claimed — claimer can act, others cannot
      const claimed = supervisedInspect(queueStore, supervisorStore, item.queueItemId, 'operator-A');
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) return;
      expect(claimed.claimStatus).toBe('claimed');
      expect(claimed.canClaim).toBe(false);
      expect(claimed.canAct).toBe(true);
      expect(claimed.claim).not.toBeNull();
      expect(claimed.claim!.claimedBy).toBe('operator-A');

      // Other actor cannot act
      const other = supervisedInspect(queueStore, supervisorStore, item.queueItemId, 'operator-B');
      expect(other.ok).toBe(true);
      if (!other.ok) return;
      expect(other.canAct).toBe(false);
    } finally {
      db.close();
    }
  });
});

// ── End-to-end flows ─────────────────────────────────────────────────

describe('end-to-end supervisor flows', () => {
  it('next → claim → inspect → decide', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      // Enqueue
      const enqueued = enqueueHandoff(handoffStore, queueStore, {
        handoffId,
        role: 'approver',
        actor: 'e2e-test',
      });
      expect(enqueued.ok).toBe(true);
      if (!enqueued.ok) return;

      // Next
      const next = resolveNextItem(queueStore, supervisorStore);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      expect(next.item.queueItemId).toBe(enqueued.queueItem.queueItemId);

      // Claim
      const claimed = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: next.item.queueItemId,
        actor: 'supervisor-1',
      });
      expect(claimed.ok).toBe(true);

      // Inspect
      const inspected = supervisedInspect(queueStore, supervisorStore, next.item.queueItemId, 'supervisor-1');
      expect(inspected.ok).toBe(true);
      if (!inspected.ok) return;
      expect(inspected.canAct).toBe(true);

      // Decide (action through queue)
      const action = enqueued.brief.eligibility.allowedActions[0]!;
      const acted = actOnQueueItem(handoffStore, queueStore, {
        queueItemId: next.item.queueItemId,
        action,
        actor: 'supervisor-1',
        reason: 'E2E supervisor test',
      });
      expect(acted.ok).toBe(true);

      // Verify terminal — no longer in active queue
      const queueAfter = listQueue(queueStore);
      expect(queueAfter.some(i => i.queueItemId === next.item.queueItemId)).toBe(false);
    } finally {
      db.close();
    }
  });

  it('next → claim → defer → requeue → decide', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const enqueued = enqueueHandoff(handoffStore, queueStore, {
        handoffId,
        role: 'reviewer',
        actor: 'e2e-test',
      });
      expect(enqueued.ok).toBe(true);
      if (!enqueued.ok) return;

      const itemId = enqueued.queueItem.queueItemId;

      // Claim
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: itemId,
        actor: 'supervisor-1',
      });

      // Defer
      const futureTime = new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      deferClaim(supervisorStore, {
        queueItemId: itemId,
        actor: 'supervisor-1',
        deferredUntil: futureTime,
        reason: 'Waiting for CI',
      });

      // Next should be empty (item deferred)
      const nextEmpty = resolveNextItem(queueStore, supervisorStore);
      expect(nextEmpty.ok).toBe(false);

      // Requeue
      requeueClaim(queueStore, supervisorStore, {
        queueItemId: itemId,
        actor: 'supervisor-1',
        reason: 'CI passed, ready now',
      });

      // Next should return the item
      const nextReady = resolveNextItem(queueStore, supervisorStore);
      expect(nextReady.ok).toBe(true);

      // Re-claim and decide
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: itemId,
        actor: 'supervisor-2',
      });

      const action = enqueued.brief.eligibility.allowedActions[0]!;
      const acted = actOnQueueItem(handoffStore, queueStore, {
        queueItemId: itemId,
        action,
        actor: 'supervisor-2',
        reason: 'Decided after defer cycle',
      });
      expect(acted.ok).toBe(true);

      // Full supervisor event trail
      const events = supervisorStore.getEventsByQueueItem(itemId);
      expect(events.length).toBeGreaterThanOrEqual(3); // claimed, deferred, requeued, claimed again
    } finally {
      db.close();
    }
  });

  it('claim conflict between two actors', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const item = enqueueTestItem(handoffStore, queueStore, handoffId);

      // A claims
      const claimA = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
      });
      expect(claimA.ok).toBe(true);

      // B tries to claim — blocked
      const claimB = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-B',
      });
      expect(claimB.ok).toBe(false);
      if (claimB.ok) return;
      expect(claimB.code).toBe('already_claimed');

      // A releases
      releaseClaim(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-A',
        reason: 'Handing off',
      });

      // B can now claim
      const claimB2 = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: item.queueItemId,
        actor: 'operator-B',
      });
      expect(claimB2.ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('lease expiry → reclaim → action', () => {
    const dbPath = tempDbPath();
    seedFullDb(dbPath);
    const handoffId = createHandoffForPacket(dbPath, 'pkt-sv-001', 'run-001');

    const { db, handoffStore, queueStore, supervisorStore } = openAllStores(dbPath);
    try {
      const enqueued = enqueueHandoff(handoffStore, queueStore, {
        handoffId,
        role: 'approver',
        actor: 'e2e-test',
      });
      expect(enqueued.ok).toBe(true);
      if (!enqueued.ok) return;

      const itemId = enqueued.queueItem.queueItemId;

      // Claim with expired lease
      claimQueueItem(queueStore, supervisorStore, {
        queueItemId: itemId,
        actor: 'operator-A',
        leaseDurationMs: -1000,
      });

      // Sweep
      const swept = sweepExpiredLeases(queueStore, supervisorStore);
      expect(swept).toBe(1);

      // Item should be pending again
      const item = queueStore.getQueueItem(itemId)!;
      expect(item.status).toBe('pending');

      // Reclaim
      const reclaimed = claimQueueItem(queueStore, supervisorStore, {
        queueItemId: itemId,
        actor: 'operator-B',
      });
      expect(reclaimed.ok).toBe(true);

      // Act
      const action = enqueued.brief.eligibility.allowedActions[0]!;
      const acted = actOnQueueItem(handoffStore, queueStore, {
        queueItemId: itemId,
        action,
        actor: 'operator-B',
        reason: 'After lease expiry reclaim',
      });
      expect(acted.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
