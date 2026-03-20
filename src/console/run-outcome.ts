/**
 * Run Outcome Derivation Engine — Phase 9F-102
 *
 * Derives a canonical RunOutcome from DB truth:
 * - run model (status, packets, workers, gates)
 * - audit trail (operator interventions)
 * - hook feed (pending decisions)
 *
 * Key rule: outcome is derived, not stored.
 * Key rule: "all packets ended" ≠ "run is acceptable."
 */

import type { RunModel } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { AuditEntry } from '../types/actions.js';
import type {
  RunOutcome,
  RunOutcomeStatus,
  PacketOutcome,
  PacketOutcomeStatus,
  UnresolvedItem,
  InterventionSummary,
  FollowUp,
} from '../types/outcome.js';
import { queryRunModel } from './run-model.js';
import { queryHookFeed } from './hook-feed.js';
import { queryAuditTrail } from './audit-trail.js';
import { RESOLVED_PACKET_STATUSES } from '../types/statuses.js';
import { nowISO } from '../lib/ids.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Derive the canonical outcome for a run.
 */
export function deriveRunOutcome(
  dbPath: string,
  runId?: string,
): RunOutcome | null {
  const runModel = queryRunModel(dbPath, runId);
  if (!runModel) return null;

  const hookFeed = queryHookFeed(dbPath, runModel.overview.featureId);
  const auditEntries = queryAuditTrail(dbPath, { limit: 500 });

  return deriveOutcomeFromModels(runModel, hookFeed, auditEntries);
}

/**
 * Derive outcome from pre-loaded models (for testing and composition).
 */
export function deriveOutcomeFromModels(
  runModel: RunModel,
  hookFeed: HookFeedResult,
  auditEntries: AuditEntry[],
): RunOutcome {
  const ov = runModel.overview;
  const packetOutcomes = derivePacketOutcomes(runModel);
  const interventions = deriveInterventions(auditEntries);
  const unresolvedItems = deriveUnresolvedItems(runModel, hookFeed);
  const status = classifyOutcomeStatus(runModel, packetOutcomes, interventions);
  const { acceptable, reason: acceptabilityReason } = assessAcceptability(status, packetOutcomes, unresolvedItems);
  const followUp = deriveFollowUp(status, unresolvedItems, runModel);

  const resolvedCount = packetOutcomes.filter(p => p.status === 'resolved').length;
  const failedCount = packetOutcomes.filter(p => p.status === 'failed').length;
  const recoveredCount = packetOutcomes.filter(p => p.status === 'recovered').length;
  const unresolvedCount = packetOutcomes.filter(p =>
    p.status === 'blocked' || p.status === 'pending' || p.status === 'skipped',
  ).length;

  const elapsed = ov.startedAt && ov.completedAt
    ? new Date(ov.completedAt).getTime() - new Date(ov.startedAt).getTime()
    : ov.startedAt
      ? Date.now() - new Date(ov.startedAt).getTime()
      : null;

  return {
    runId: ov.runId,
    featureId: ov.featureId,
    featureTitle: ov.featureTitle,
    status,
    summary: buildSummary(status, resolvedCount, failedCount, recoveredCount, ov.totalPackets),
    packets: packetOutcomes,
    resolvedCount,
    failedCount,
    recoveredCount,
    unresolvedCount,
    totalPackets: ov.totalPackets,
    unresolvedItems,
    interventions,
    acceptable,
    acceptabilityReason,
    followUp,
    derivedAt: nowISO(),
    runStatus: ov.status,
    elapsedMs: elapsed,
  };
}

// ── Packet outcome derivation ───────────────────────────────────────

function derivePacketOutcomes(runModel: RunModel): PacketOutcome[] {
  return runModel.packets.map(packet => {
    const wasRetried = packet.attemptNumber > 1;
    let status: PacketOutcomeStatus;

    if (RESOLVED_PACKET_STATUSES.has(packet.status)) {
      status = wasRetried ? 'recovered' : 'resolved';
    } else if (packet.status === 'failed') {
      status = 'failed';
    } else if (packet.status === 'blocked') {
      status = 'blocked';
    } else if (runModel.overview.status === 'stopped' && packet.status === 'ready') {
      status = 'skipped';
    } else {
      status = 'pending';
    }

    return {
      packetId: packet.packetId,
      title: packet.title,
      status,
      wave: packet.wave || 0,
      attempts: packet.attemptNumber,
      wasRetried,
      finalState: packet.status,
    };
  });
}

// ── Intervention summary derivation ─────────────────────────────────

function deriveInterventions(auditEntries: AuditEntry[]): InterventionSummary {
  const summary: InterventionSummary = {
    totalActions: auditEntries.length,
    retries: 0,
    stops: 0,
    resumes: 0,
    gateApprovals: 0,
    hookResolutions: 0,
  };

  for (const entry of auditEntries) {
    switch (entry.action) {
      case 'retry_packet': summary.retries++; break;
      case 'stop_run': summary.stops++; break;
      case 'resume_run': summary.resumes++; break;
      case 'approve_gate': summary.gateApprovals++; break;
      case 'resolve_hook': summary.hookResolutions++; break;
    }
  }

  return summary;
}

// ── Unresolved items derivation ─────────────────────────────────────

function deriveUnresolvedItems(
  runModel: RunModel,
  hookFeed: HookFeedResult,
): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];

  // Failed packets
  for (const p of runModel.packets) {
    if (p.status === 'failed') {
      items.push({
        type: 'failed_packet',
        targetType: 'packet',
        targetId: p.packetId,
        description: `Packet ${p.packetId} failed after ${p.attemptNumber} attempt(s)`,
      });
    }
  }

  // Blocked packets
  for (const p of runModel.packets) {
    if (p.status === 'blocked') {
      items.push({
        type: 'blocked_packet',
        targetType: 'packet',
        targetId: p.packetId,
        description: `Packet ${p.packetId} blocked on unresolved dependencies`,
      });
    }
  }

  // Pending packets (not started, not skipped)
  for (const p of runModel.packets) {
    if (p.status === 'ready' && runModel.overview.status !== 'stopped') {
      items.push({
        type: 'pending_packet',
        targetType: 'packet',
        targetId: p.packetId,
        description: `Packet ${p.packetId} ready but not yet claimed`,
      });
    }
  }

  // Pending hook decisions
  const pendingHooks = hookFeed.events.filter(
    e => e.operatorDecision === 'pending' && e.action !== null,
  );
  for (const h of pendingHooks) {
    items.push({
      type: 'pending_hook',
      targetType: 'hook_decision',
      targetId: h.id,
      description: `Hook decision "${h.action}" for ${h.event} ${h.entityId} awaiting approval`,
    });
  }

  // Unresolved gates
  for (const g of runModel.gates) {
    if (!g.resolved) {
      items.push({
        type: 'unresolved_gate',
        targetType: 'gate',
        targetId: `${g.scopeType}:${g.scopeId}:${g.type}`,
        description: `${g.type.replace('_', ' ')} gate pending for ${g.scopeType} ${g.scopeId}`,
      });
    }
  }

  return items;
}

// ── Outcome status classification ───────────────────────────────────

function classifyOutcomeStatus(
  runModel: RunModel,
  packetOutcomes: PacketOutcome[],
  interventions: InterventionSummary,
): RunOutcomeStatus {
  const ov = runModel.overview;

  // Non-terminal: still in progress
  if (ov.status === 'running' || ov.status === 'paused' || ov.status === 'planned') {
    return 'in_progress';
  }

  // Stopped by operator
  if (ov.status === 'stopped') {
    return 'stopped';
  }

  // Failed run
  if (ov.status === 'failed') {
    const anyResolved = packetOutcomes.some(p => p.status === 'resolved' || p.status === 'recovered');
    return anyResolved ? 'partial_success' : 'terminal_failure';
  }

  // Complete or completing
  if (ov.status === 'complete' || ov.status === 'completing') {
    const allResolved = packetOutcomes.every(p => p.status === 'resolved' || p.status === 'recovered');
    if (!allResolved) {
      return 'partial_success';
    }

    const hadIntervention = interventions.retries > 0 ||
      interventions.hookResolutions > 0 ||
      interventions.gateApprovals > 0;

    const hadRecovery = packetOutcomes.some(p => p.status === 'recovered');

    return (hadIntervention || hadRecovery) ? 'assisted_success' : 'clean_success';
  }

  return 'in_progress';
}

// ── Acceptability assessment ────────────────────────────────────────

function assessAcceptability(
  status: RunOutcomeStatus,
  packetOutcomes: PacketOutcome[],
  unresolvedItems: UnresolvedItem[],
): { acceptable: boolean; reason: string } {
  switch (status) {
    case 'clean_success':
      return { acceptable: true, reason: 'All packets resolved without intervention' };

    case 'assisted_success':
      return { acceptable: true, reason: 'All packets resolved, with operator assistance' };

    case 'partial_success': {
      const resolved = packetOutcomes.filter(p => p.status === 'resolved' || p.status === 'recovered').length;
      const total = packetOutcomes.length;
      return {
        acceptable: false,
        reason: `Only ${resolved}/${total} packets resolved — ${unresolvedItems.length} unresolved item(s) remain`,
      };
    }

    case 'terminal_failure':
      return { acceptable: false, reason: 'Run failed with no resolved packets — re-planning required' };

    case 'stopped':
      return { acceptable: false, reason: 'Run was stopped by operator — review and decide whether to resume or re-plan' };

    case 'in_progress':
      return { acceptable: false, reason: 'Run has not concluded — outcome is preliminary' };
  }
}

// ── Follow-up derivation ────────────────────────────────────────────

function deriveFollowUp(
  status: RunOutcomeStatus,
  unresolvedItems: UnresolvedItem[],
  runModel: RunModel,
): FollowUp {
  const runId = runModel.overview.runId;

  switch (status) {
    case 'clean_success':
      return {
        kind: 'none',
        title: 'No follow-up needed',
        reason: 'Run completed successfully with all packets resolved',
        command: null,
      };

    case 'assisted_success':
      return {
        kind: 'review',
        title: 'Review intervention history',
        reason: 'Run succeeded but required operator intervention — review audit for process improvements',
        command: `multi-claude console audit`,
      };

    case 'partial_success':
      return {
        kind: 'recover',
        title: 'Recover unresolved packets',
        reason: `${unresolvedItems.length} item(s) remain unresolved — use recovery to address`,
        command: `multi-claude console recover`,
      };

    case 'terminal_failure':
      return {
        kind: 'replan',
        title: 'Re-plan the run',
        reason: 'Run failed terminally — review failure evidence and create a new run plan',
        command: `multi-claude auto status --run ${runId}`,
      };

    case 'stopped':
      return {
        kind: 'resume',
        title: 'Resume or re-plan',
        reason: 'Run was stopped — decide whether to resume from current state or start fresh',
        command: `multi-claude console recover`,
      };

    case 'in_progress':
      return {
        kind: 'none',
        title: 'Run is still in progress',
        reason: 'Wait for the run to conclude before evaluating the outcome',
        command: `multi-claude console watch`,
      };
  }
}

// ── Summary builder ─────────────────────────────────────────────────

function buildSummary(
  status: RunOutcomeStatus,
  resolved: number,
  failed: number,
  recovered: number,
  total: number,
): string {
  switch (status) {
    case 'clean_success':
      return `All ${total} packet(s) resolved successfully — clean run`;
    case 'assisted_success':
      return `All ${total} packet(s) resolved — ${recovered} recovered via retry/intervention`;
    case 'partial_success':
      return `${resolved + recovered}/${total} packet(s) resolved, ${failed} failed — partial outcome`;
    case 'terminal_failure':
      return `Run failed — ${failed}/${total} packet(s) failed, none resolved`;
    case 'stopped':
      return `Run stopped by operator — ${resolved + recovered}/${total} resolved before stop`;
    case 'in_progress':
      return `Run in progress — ${resolved + recovered}/${total} resolved so far`;
  }
}
