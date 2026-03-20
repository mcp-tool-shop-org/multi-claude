/**
 * Run Handoff Derivation Engine — Phase 10A-103
 *
 * Derives a canonical RunHandoff from existing execution truth:
 *   - run outcome (9F)
 *   - run model (9B)
 *   - audit trail (9C)
 *   - hook feed (9B)
 *   - reconcile truth where available
 *
 * Key rules:
 *   - Handoff is derived, not stored.
 *   - Handoff is stricter than outcome.
 *   - No invented evidence. Only references grounded truth.
 *   - Interventions are surfaced, never hidden.
 */

import type { RunModel } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { AuditEntry } from '../types/actions.js';
import type { RunOutcome, PacketOutcome, UnresolvedItem } from '../types/outcome.js';
import type {
  RunHandoff,
  ContributionSummary,
  OutstandingIssue,
  HandoffFollowUp,
  InterventionDigest,
  InterventionEvent,
  EvidenceReference,
} from '../types/handoff.js';
import { assessReadiness } from './handoff-readiness.js';
import { deriveOutcomeFromModels } from './run-outcome.js';
import { queryRunModel } from './run-model.js';
import { queryHookFeed } from './hook-feed.js';
import { queryAuditTrail } from './audit-trail.js';
import { nowISO } from '../lib/ids.js';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Derive the canonical handoff artifact for a run.
 */
export function deriveRunHandoff(
  dbPath: string,
  runId?: string,
): RunHandoff | null {
  const runModel = queryRunModel(dbPath, runId);
  if (!runModel) return null;

  const hookFeed = queryHookFeed(dbPath, runModel.overview.featureId);
  const auditEntries = queryAuditTrail(dbPath, { limit: 500 });
  const outcome = deriveOutcomeFromModels(runModel, hookFeed, auditEntries);

  return deriveHandoffFromModels(runModel, outcome, hookFeed, auditEntries);
}

/**
 * Derive handoff from pre-loaded models (for testing and composition).
 */
export function deriveHandoffFromModels(
  runModel: RunModel,
  outcome: RunOutcome,
  hookFeed: HookFeedResult,
  auditEntries: AuditEntry[],
): RunHandoff {
  const contributions = deriveContributions(runModel, outcome, auditEntries);
  const outstandingIssues = deriveOutstandingIssues(outcome, hookFeed, runModel);
  const interventions = deriveInterventionDigest(auditEntries);
  const followUps = deriveFollowUps(outcome, outstandingIssues);
  const evidenceRefs = deriveEvidenceRefs(outcome, interventions, runModel);

  const reviewReadiness = assessReadiness({
    outcomeStatus: outcome.status,
    acceptable: outcome.acceptable,
    contributions,
    outstandingIssues,
    interventions,
  });

  const landedContributions = contributions.filter(c => c.contributesToResult).length;
  const failedContributions = contributions.filter(c => c.status === 'failed').length;
  const recoveredContributions = contributions.filter(c => c.wasRecovered).length;

  const totalFilesChanged = contributions.reduce((sum, c) => {
    return sum + (c.changedFiles?.totalFiles ?? 0);
  }, 0);

  return {
    runId: outcome.runId,
    featureId: outcome.featureId,
    featureTitle: outcome.featureTitle,

    verdict: reviewReadiness.verdict,
    reviewReadiness,

    summary: outcome.summary,
    attemptedGoal: deriveAttemptedGoal(runModel),
    outcomeStatus: outcome.status,
    acceptable: outcome.acceptable,
    acceptabilityReason: outcome.acceptabilityReason,

    contributions,
    totalContributions: contributions.length,
    landedContributions,
    failedContributions,
    recoveredContributions,

    hasChangeEvidence: contributions.some(c => c.changedFiles !== null),
    totalFilesChanged,

    interventions,

    outstandingIssues,
    reviewBlockingIssues: outstandingIssues.filter(i => i.blocksReview).length,

    followUps,
    evidenceRefs,

    generatedAt: nowISO(),
    elapsedMs: outcome.elapsedMs,
  };
}

// ── Contribution derivation ─────────────────────────────────────────

function deriveContributions(
  runModel: RunModel,
  outcome: RunOutcome,
  auditEntries: AuditEntry[],
): ContributionSummary[] {
  // Build lookup for audit actions targeting packets
  const packetAuditActions = new Set<string>();
  for (const entry of auditEntries) {
    if (entry.targetType === 'packet') {
      packetAuditActions.add(entry.targetId);
    }
  }

  // Build packet outcome lookup
  const packetOutcomeMap = new Map<string, PacketOutcome>();
  for (const po of outcome.packets) {
    packetOutcomeMap.set(po.packetId, po);
  }

  return runModel.packets.map(packet => {
    const po = packetOutcomeMap.get(packet.packetId);
    const status = po?.status ?? 'pending';
    const wasRetried = po?.wasRetried ?? false;
    const wasRecovered = status === 'recovered';
    const hadIntervention = packetAuditActions.has(packet.packetId);
    const contributesToResult = status === 'resolved' || status === 'recovered';

    return {
      packetId: packet.packetId,
      title: packet.title,
      role: packet.role,
      layer: packet.layer,
      wave: packet.wave,
      status,
      attempts: po?.attempts ?? packet.attemptNumber,
      wasRetried,
      wasRecovered,
      hadIntervention,
      contributesToResult,
      changedFiles: null, // File evidence populated when reconcile truth available
    };
  });
}

// ── Outstanding issues ──────────────────────────────────────────────

function deriveOutstandingIssues(
  outcome: RunOutcome,
  _hookFeed: HookFeedResult,
  _runModel: RunModel,
): OutstandingIssue[] {
  const issues: OutstandingIssue[] = [];
  let issueIdx = 0;

  for (const item of outcome.unresolvedItems) {
    issues.push({
      id: `issue-${issueIdx++}`,
      severity: unresolvedItemSeverity(item),
      kind: item.type,
      description: item.description,
      blocksReview: unresolvedItemBlocksReview(item),
      recommendedAction: unresolvedItemAction(item),
    });
  }

  return issues;
}

function unresolvedItemSeverity(item: UnresolvedItem): OutstandingIssue['severity'] {
  switch (item.type) {
    case 'failed_packet': return 'critical';
    case 'blocked_packet': return 'critical';
    case 'pending_hook': return 'warning';
    case 'unresolved_gate': return 'warning';
    case 'pending_packet': return 'info';
    default: return 'info';
  }
}

function unresolvedItemBlocksReview(item: UnresolvedItem): boolean {
  switch (item.type) {
    case 'failed_packet': return true;
    case 'blocked_packet': return true;
    case 'pending_hook': return true;
    case 'unresolved_gate': return true;
    case 'pending_packet': return false; // pending = not yet started, not a failure
    default: return false;
  }
}

function unresolvedItemAction(item: UnresolvedItem): string | null {
  switch (item.type) {
    case 'failed_packet':
      return `multi-claude console act retry_packet --target ${item.targetId}`;
    case 'blocked_packet':
      return `multi-claude console recover --target ${item.targetId}`;
    case 'pending_hook':
      return `multi-claude console act resolve_hook --target ${item.targetId}`;
    case 'unresolved_gate':
      return `multi-claude console act approve_gate --target ${item.targetId}`;
    case 'pending_packet':
      return null; // system will claim it when ready
    default:
      return null;
  }
}

// ── Intervention digest ─────────────────────────────────────────────

function deriveInterventionDigest(auditEntries: AuditEntry[]): InterventionDigest {
  const significantActions: InterventionEvent[] = [];

  for (const entry of auditEntries) {
    if (entry.success) {
      significantActions.push({
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        description: `${entry.action} on ${entry.targetType} ${entry.targetId}: ${entry.beforeState} → ${entry.afterState}`,
        timestamp: entry.timestamp,
      });
    }
  }

  return {
    occurred: auditEntries.length > 0,
    summary: {
      totalActions: auditEntries.length,
      retries: auditEntries.filter(e => e.action === 'retry_packet').length,
      stops: auditEntries.filter(e => e.action === 'stop_run').length,
      resumes: auditEntries.filter(e => e.action === 'resume_run').length,
      gateApprovals: auditEntries.filter(e => e.action === 'approve_gate').length,
      hookResolutions: auditEntries.filter(e => e.action === 'resolve_hook').length,
    },
    significantActions,
  };
}

// ── Follow-up recommendations ───────────────────────────────────────

function deriveFollowUps(
  outcome: RunOutcome,
  outstandingIssues: OutstandingIssue[],
): HandoffFollowUp[] {
  const followUps: HandoffFollowUp[] = [];

  // Primary follow-up from outcome
  if (outcome.followUp.kind !== 'none') {
    followUps.push({
      action: outcome.followUp.kind,
      reason: outcome.followUp.reason,
      urgency: followUpUrgency(outcome.followUp.kind),
      command: outcome.followUp.command,
      description: outcome.followUp.title,
    });
  }

  // Per-issue follow-ups for critical/warning issues with actions
  const actionableIssues = outstandingIssues.filter(
    i => i.severity !== 'info' && i.recommendedAction !== null,
  );
  for (const issue of actionableIssues) {
    followUps.push({
      action: 'recover',
      reason: issue.description,
      urgency: issue.severity === 'critical' ? 'immediate' : 'soon',
      command: issue.recommendedAction,
      description: `Resolve ${issue.kind}: ${issue.description}`,
    });
  }

  // If review-ready with clean success, suggest merge
  if (outcome.status === 'clean_success') {
    followUps.push({
      action: 'merge',
      reason: 'All packets resolved cleanly — ready for merge review',
      urgency: 'when_ready',
      command: null,
      description: 'Review and merge the contributed changes',
    });
  }

  return followUps;
}

function followUpUrgency(kind: string): HandoffFollowUp['urgency'] {
  switch (kind) {
    case 'recover': return 'immediate';
    case 'replan': return 'immediate';
    case 'resume': return 'soon';
    case 'review': return 'when_ready';
    default: return 'when_ready';
  }
}

// ── Evidence references ─────────────────────────────────────────────

function deriveEvidenceRefs(
  outcome: RunOutcome,
  interventions: InterventionDigest,
  _runModel: RunModel,
): EvidenceReference[] {
  const refs: EvidenceReference[] = [];

  // Run outcome is always evidence
  refs.push({
    kind: 'run_outcome',
    description: `Run outcome: ${outcome.status} — ${outcome.summary}`,
    command: `multi-claude console outcome --run ${outcome.runId}`,
  });

  // Audit trail if interventions occurred
  if (interventions.occurred) {
    refs.push({
      kind: 'audit_trail',
      description: `${interventions.summary.totalActions} operator intervention(s) recorded`,
      command: `multi-claude console audit`,
    });
  }

  return refs;
}

// ── Goal derivation ─────────────────────────────────────────────────

function deriveAttemptedGoal(runModel: RunModel): string {
  const ov = runModel.overview;
  const packetCount = ov.totalPackets;
  const waveCount = ov.totalWaves;

  if (ov.featureTitle) {
    return `Deliver "${ov.featureTitle}" — ${packetCount} packets across ${waveCount} wave(s)`;
  }

  return `Run ${ov.runId} — ${packetCount} packets across ${waveCount} wave(s)`;
}
