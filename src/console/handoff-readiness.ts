/**
 * Handoff Readiness — Phase 10A-102
 *
 * Rule engine for handoff verdict and review-readiness classification.
 * This is the heart of 10A: "done" ≠ "review-ready."
 *
 * Rules are explicit and deterministic. No vibes.
 *
 * Review-ready if:
 *   - outcome is acceptable
 *   - no blocking unresolved issues
 *   - all required contributions accounted for
 *   - no critical gate/dependency failure open
 *
 * Review-ready-with-notes if:
 *   - acceptable overall
 *   - interventions or recoveries occurred
 *   - non-blocking caveats remain
 *
 * Not-review-ready if:
 *   - unacceptable outcome
 *   - unresolved blocker affects correctness
 *   - required contribution missing
 *
 * Incomplete if:
 *   - run stopped, in progress, or paused
 *
 * Blocked if:
 *   - run completed but critical dependency/gate remains open
 */

import type {
  ReviewReadiness,
  ReadinessBlocker,
  ReadinessNote,
  HandoffVerdict,
  ContributionSummary,
  OutstandingIssue,
} from '../types/handoff.js';
import type { RunOutcomeStatus } from '../types/outcome.js';
import type { InterventionDigest } from '../types/handoff.js';

// ── Public API ──────────────────────────────────────────────────────

export interface ReadinessInput {
  outcomeStatus: RunOutcomeStatus;
  acceptable: boolean;
  contributions: ContributionSummary[];
  outstandingIssues: OutstandingIssue[];
  interventions: InterventionDigest;
}

/**
 * Assess review-readiness from execution truth.
 * Returns a deterministic verdict with structured reasoning.
 */
export function assessReadiness(input: ReadinessInput): ReviewReadiness {
  const blockers = collectBlockers(input);
  const notes = collectNotes(input);
  const verdict = classifyVerdict(input, blockers);

  return {
    ready: verdict === 'review_ready' || verdict === 'review_ready_with_notes',
    verdict,
    reason: buildReason(verdict, blockers, notes),
    blockers,
    notes,
  };
}

// ── Verdict classification ──────────────────────────────────────────

function classifyVerdict(
  input: ReadinessInput,
  blockers: ReadinessBlocker[],
): HandoffVerdict {
  const { outcomeStatus, acceptable, contributions, interventions } = input;

  // Incomplete: run did not finish
  if (outcomeStatus === 'in_progress' || outcomeStatus === 'stopped') {
    return 'incomplete';
  }

  // Any review-blocking issues → check if blocked vs not-review-ready
  const hasReviewBlockers = blockers.length > 0;

  if (hasReviewBlockers) {
    // Blocked: completed but critical gate/dependency open
    const hasGateOrDepBlocker = blockers.some(b =>
      b.kind === 'open_gate' || b.kind === 'pending_hook',
    );
    if (hasGateOrDepBlocker && acceptable) {
      return 'blocked';
    }

    return 'not_review_ready';
  }

  // No blockers — is it clean or does it need notes?
  if (!acceptable) {
    // Should not happen (unacceptable → blocker), but defensive
    return 'not_review_ready';
  }

  // Check if interventions or recoveries occurred
  const hadIntervention = interventions.occurred;
  const hadRecovery = contributions.some(c => c.wasRecovered);
  const hasNotes = hadIntervention || hadRecovery;

  if (hasNotes) {
    return 'review_ready_with_notes';
  }

  return 'review_ready';
}

// ── Blocker collection ──────────────────────────────────────────────

function collectBlockers(input: ReadinessInput): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];
  const { outcomeStatus, acceptable, contributions, outstandingIssues } = input;

  // Rule: run incomplete → blocker
  if (outcomeStatus === 'in_progress' || outcomeStatus === 'stopped') {
    blockers.push({
      kind: 'run_incomplete',
      description: outcomeStatus === 'stopped'
        ? 'Run was stopped by operator — cannot hand off incomplete work'
        : 'Run is still in progress — wait for conclusion',
      targetType: 'run',
      targetId: null,
    });
  }

  // Rule: unacceptable outcome → blocker
  if (!acceptable && outcomeStatus !== 'in_progress' && outcomeStatus !== 'stopped') {
    blockers.push({
      kind: 'unacceptable_outcome',
      description: `Run outcome "${outcomeStatus}" is not acceptable for review`,
      targetType: 'run',
      targetId: null,
    });
  }

  // Rule: failed contributions that are required → blocker
  const failedContributions = contributions.filter(c =>
    c.status === 'failed' && !c.wasRecovered,
  );
  for (const fc of failedContributions) {
    blockers.push({
      kind: 'unresolved_failure',
      description: `Packet ${fc.packetId} (${fc.title}) failed and was not recovered`,
      targetType: 'packet',
      targetId: fc.packetId,
    });
  }

  // Rule: missing contributions (blocked/pending) → blocker
  const missingContributions = contributions.filter(c =>
    c.status === 'blocked' || c.status === 'pending',
  );
  for (const mc of missingContributions) {
    blockers.push({
      kind: 'missing_contribution',
      description: `Packet ${mc.packetId} (${mc.title}) is ${mc.status} — contribution missing`,
      targetType: 'packet',
      targetId: mc.packetId,
    });
  }

  // Rule: outstanding issues that block review
  for (const issue of outstandingIssues) {
    if (issue.blocksReview) {
      const kind = issueKindToBlockerKind(issue.kind);
      if (kind) {
        blockers.push({
          kind,
          description: issue.description,
          targetType: issueTargetType(issue.kind),
          targetId: issue.id,
        });
      }
    }
  }

  return blockers;
}

function issueKindToBlockerKind(
  kind: OutstandingIssue['kind'],
): ReadinessBlocker['kind'] | null {
  switch (kind) {
    case 'pending_hook': return 'pending_hook';
    case 'unresolved_gate': return 'open_gate';
    case 'failed_packet': return 'unresolved_failure';
    case 'blocked_packet': return 'missing_contribution';
    case 'pending_packet': return 'missing_contribution';
    default: return null;
  }
}

function issueTargetType(kind: OutstandingIssue['kind']): ReadinessBlocker['targetType'] {
  switch (kind) {
    case 'failed_packet':
    case 'blocked_packet':
    case 'pending_packet':
      return 'packet';
    case 'pending_hook':
      return 'hook_decision';
    case 'unresolved_gate':
      return 'gate';
    default:
      return 'system';
  }
}

// ── Note collection ─────────────────────────────────────────────────

function collectNotes(input: ReadinessInput): ReadinessNote[] {
  const notes: ReadinessNote[] = [];
  const { contributions, interventions } = input;

  // Interventions occurred
  if (interventions.occurred) {
    const parts: string[] = [];
    const s = interventions.summary;
    if (s.retries > 0) parts.push(`${s.retries} retries`);
    if (s.gateApprovals > 0) parts.push(`${s.gateApprovals} gate approvals`);
    if (s.hookResolutions > 0) parts.push(`${s.hookResolutions} hook resolutions`);
    if (s.stops > 0) parts.push(`${s.stops} stops`);
    if (s.resumes > 0) parts.push(`${s.resumes} resumes`);

    notes.push({
      kind: 'intervention_occurred',
      description: `Operator intervened ${s.totalActions} time(s): ${parts.join(', ')}`,
    });
  }

  // Recoveries occurred
  const recovered = contributions.filter(c => c.wasRecovered);
  if (recovered.length > 0) {
    notes.push({
      kind: 'recovery_occurred',
      description: `${recovered.length} packet(s) recovered via retry: ${recovered.map(c => c.packetId).join(', ')}`,
    });
  }

  // Scope limitation: no file-level change evidence
  const hasAnyChangeEvidence = contributions.some(c => c.changedFiles !== null);
  if (!hasAnyChangeEvidence && contributions.length > 0) {
    notes.push({
      kind: 'scope_limitation',
      description: 'No file-level change evidence available — reviewer must inspect worktrees directly',
    });
  }

  // Reconcile warnings
  const reconWarnings = contributions.filter(c =>
    c.changedFiles !== null && c.changedFiles.reconciled && !c.changedFiles.reconcilePass,
  );
  if (reconWarnings.length > 0) {
    notes.push({
      kind: 'caveat',
      description: `${reconWarnings.length} packet(s) had reconciliation warnings: ${reconWarnings.map(c => c.packetId).join(', ')}`,
    });
  }

  return notes;
}

// ── Reason builder ──────────────────────────────────────────────────

function buildReason(
  verdict: HandoffVerdict,
  blockers: ReadinessBlocker[],
  notes: ReadinessNote[],
): string {
  switch (verdict) {
    case 'review_ready':
      return 'All contributions accounted for, no blockers, safe to hand off for review';

    case 'review_ready_with_notes':
      return `Ready for review with ${notes.length} note(s) — interventions or caveats require inspection`;

    case 'not_review_ready':
      return `Not review-ready: ${blockers.length} blocker(s) — ${blockers[0]?.description ?? 'unknown'}`;

    case 'incomplete':
      return `Run did not finish — ${blockers[0]?.description ?? 'awaiting conclusion'}`;

    case 'blocked':
      return `Run completed but blocked — ${blockers[0]?.description ?? 'open gate or pending decision'}`;
  }
}
