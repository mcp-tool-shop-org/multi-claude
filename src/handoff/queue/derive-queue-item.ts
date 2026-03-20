/**
 * Decision Queue — Queue item derivation.
 *
 * Derives a queue item from a decision brief. The priority class
 * is determined by deterministic law, not opinion:
 *
 *   recovery_needed: invalidated version or recovery-pending blocker
 *   blocked_high: any high-severity blocker
 *   blocked_medium: any medium-severity blocker
 *   approvable: no blockers, approve is in allowed actions
 *   informational: everything else
 */

import type { DecisionBrief } from '../decision/types.js';
import type { QueueItem, PriorityClass } from './types.js';
import type { QueueStore } from './queue-store.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Priority classification ─────────────────────────────────────────

/**
 * Classify priority from brief state. Deterministic.
 */
export function classifyPriority(brief: DecisionBrief): PriorityClass {
  const blockerCodes = new Set(brief.blockers.map(b => b.code));

  // Recovery-needed: invalidated version, all invalidated, or recovery pending
  if (
    blockerCodes.has('invalidated_version') ||
    blockerCodes.has('all_versions_invalidated') ||
    blockerCodes.has('recovery_pending')
  ) {
    return 'recovery_needed';
  }

  // High-severity blockers
  const highBlockers = brief.blockers.filter(b => b.severity === 'high');
  if (highBlockers.length > 0) {
    return 'blocked_high';
  }

  // Medium-severity blockers
  const mediumBlockers = brief.blockers.filter(b => b.severity === 'medium');
  if (mediumBlockers.length > 0) {
    return 'blocked_medium';
  }

  // Approvable: approve is in allowed actions
  if (brief.eligibility.allowedActions.includes('approve')) {
    return 'approvable';
  }

  return 'informational';
}

// ── Queue item derivation ───────────────────────────────────────────

/**
 * Derive a queue item from a decision brief.
 */
export function deriveQueueItem(brief: DecisionBrief): QueueItem {
  const priorityClass = classifyPriority(brief);
  const now = nowISO();

  // Build triage summaries
  const blockerSummary = brief.blockers.length > 0
    ? brief.blockers.map(b => `[${b.severity}] ${b.summary}`).join('; ')
    : 'No blockers';

  const eligibilitySummary = `${brief.eligibility.recommendedAction}: ${brief.eligibility.rationale.join('; ')}`;

  return {
    queueItemId: generateId('qi'),
    handoffId: brief.handoffId,
    packetVersion: brief.packetVersion,
    briefId: brief.briefId,
    role: brief.role,
    status: 'pending',
    priorityClass,
    blockerSummary,
    eligibilitySummary,
    evidenceFingerprint: brief.evidenceCoverage.fingerprint,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Derive a queue item from a brief and persist both.
 */
export function enqueueDecisionBrief(
  queueStore: QueueStore,
  brief: DecisionBrief,
  actor: string,
): QueueItem {
  // Persist the brief
  queueStore.insertBrief(brief);

  // Derive and persist the queue item
  const item = deriveQueueItem(brief);
  queueStore.insertQueueItem(item);

  // Record creation event
  queueStore.insertEvent({
    queueItemId: item.queueItemId,
    kind: 'created',
    toStatus: 'pending',
    toPriority: item.priorityClass,
    actor,
    reason: `Enqueued from brief ${brief.briefId}`,
    createdAt: item.createdAt,
  });

  return item;
}
