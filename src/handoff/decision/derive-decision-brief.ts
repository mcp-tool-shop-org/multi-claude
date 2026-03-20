/**
 * Decision Briefs — Core derivation engine.
 *
 * Derives a structured DecisionBrief from canonical packet state.
 * The brief is the deterministic judgment frame — not an opinion.
 *
 * Pipeline:
 *   packet → baseline resolution → delta → blockers → evidence → eligibility → brief
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket, HandoffId } from '../schema/packet.js';
import type {
  DecisionBrief,
  DecisionRole,
  ActionEligibility,
} from './types.js';
import { resolveBaseline, computeBaselineDelta, type ResolvedBaseline } from './derive-baseline-delta.js';
import { deriveBlockers } from './derive-blockers.js';
import { deriveEvidenceCoverage } from './derive-evidence-coverage.js';
import { generateId, nowISO } from '../../lib/ids.js';

// ── Public API ──────────────────────────────────────────────────────

export interface DeriveBriefInput {
  store: HandoffStore;
  packet: HandoffPacket;
  role: DecisionRole;
  /** Content hash / output hash from the render event */
  fingerprint: string;
}

export interface DeriveBriefResult {
  ok: true;
  brief: DecisionBrief;
}

export interface DeriveBriefError {
  ok: false;
  error: string;
}

/**
 * Derive a decision brief from a canonical packet.
 */
export function deriveDecisionBrief(
  input: DeriveBriefInput,
): DeriveBriefResult | DeriveBriefError {
  const { store, packet, role, fingerprint } = input;
  const handoffId = packet.handoffId as HandoffId;

  // Step 1: Resolve baseline
  const baseline: ResolvedBaseline = resolveBaseline(store, handoffId, packet.packetVersion);

  // Step 2: Compute delta (if baseline exists)
  const delta = baseline.packet
    ? computeBaselineDelta(baseline.packet, packet, baseline.type as 'approved' | 'last_valid')
    : null;

  // Step 3: Evidence coverage
  const evidenceCoverage = deriveEvidenceCoverage(packet, fingerprint);

  // Step 4: Blockers
  const blockers = deriveBlockers({
    store,
    packet,
    role,
    evidenceCoverage,
    delta,
  });

  // Step 5: Risks (from state, not opinion)
  const risks = deriveRisks(packet, delta, blockers);

  // Step 6: Action eligibility
  const eligibility = deriveActionEligibility(role, blockers, packet);

  // Step 7: Open loops as strings
  const openLoops = packet.openLoops.map(
    l => `[${l.priority}] ${l.summary}${l.ownerRole ? ` (owner: ${l.ownerRole})` : ''}`,
  );

  // Step 8: Decision refs
  const decisionRefs = packet.decisions.map(d => `${d.id}: ${d.summary}`);

  // Step 9: Build brief
  const brief: DecisionBrief = {
    briefId: generateId('dbr'),
    handoffId: packet.handoffId,
    packetVersion: packet.packetVersion,
    baselinePacketVersion: baseline.version,
    briefVersion: '1.0.0',
    createdAt: nowISO(),
    role,

    summary: packet.summary,
    deltaSummary: delta?.deltaLines ?? ['No baseline available — first version'],

    blockers,
    evidenceCoverage,
    eligibility,

    risks,
    openLoops,
    decisionRefs,
  };

  return { ok: true, brief };
}

// ── Risk derivation ─────────────────────────────────────────────────

function deriveRisks(
  packet: HandoffPacket,
  delta: ReturnType<typeof computeBaselineDelta> | null,
  blockers: ReturnType<typeof deriveBlockers>,
): string[] {
  const risks: string[] = [];

  // High-severity blockers are inherently risky
  const highBlockers = blockers.filter(b => b.severity === 'high');
  if (highBlockers.length > 0) {
    risks.push(`${highBlockers.length} high-severity blocker(s) present`);
  }

  // Instruction changes are always worth flagging
  if (delta?.instructionsChanged) {
    risks.push('Authoritative instructions changed since baseline');
  }
  if (delta?.prohibitionsChanged) {
    risks.push('Prohibitions changed since baseline — scope may have shifted');
  }

  // High open loops
  const highLoops = packet.openLoops.filter(l => l.priority === 'high');
  if (highLoops.length > 0) {
    risks.push(`${highLoops.length} high-priority unresolved item(s)`);
  }

  // No artifacts at all
  if (packet.artifacts.length === 0) {
    risks.push('No artifact references — evidence may be missing');
  }

  return risks;
}

// ── Action eligibility ──────────────────────────────────────────────

function deriveActionEligibility(
  role: DecisionRole,
  blockers: ReturnType<typeof deriveBlockers>,
  _packet: HandoffPacket,
): ActionEligibility {
  const highBlockers = blockers.filter(b => b.severity === 'high');
  const rationale: string[] = [];

  // Reviewer actions
  if (role === 'reviewer') {
    if (highBlockers.length > 0) {
      rationale.push(`${highBlockers.length} high-severity blocker(s) prevent approval recommendation`);
      return {
        allowedActions: ['reject', 'request-recovery', 'needs-review'],
        recommendedAction: highBlockers.some(b => b.code === 'all_versions_invalidated' || b.code === 'invalidated_version')
          ? 'request-recovery'
          : 'needs-review',
        rationale,
      };
    }

    const mediumBlockers = blockers.filter(b => b.severity === 'medium');
    if (mediumBlockers.length > 0) {
      rationale.push(`${mediumBlockers.length} medium-severity issue(s) require attention`);
      return {
        allowedActions: ['approve', 'reject', 'request-recovery', 'needs-review'],
        recommendedAction: 'needs-review',
        rationale,
      };
    }

    rationale.push('No blockers detected — eligible for approval recommendation');
    return {
      allowedActions: ['approve', 'reject', 'needs-review'],
      recommendedAction: 'approve',
      rationale,
    };
  }

  // Approver actions
  if (highBlockers.length > 0) {
    rationale.push(`${highBlockers.length} high-severity blocker(s) prevent approval`);

    const needsRecovery = highBlockers.some(
      b => b.code === 'all_versions_invalidated' || b.code === 'invalidated_version' || b.code === 'recovery_pending',
    );

    return {
      allowedActions: needsRecovery
        ? ['reject', 'request-recovery']
        : ['reject', 'request-recovery', 'needs-review'],
      recommendedAction: needsRecovery ? 'request-recovery' : 'reject',
      rationale,
    };
  }

  const mediumBlockers = blockers.filter(b => b.severity === 'medium');
  if (mediumBlockers.length > 0) {
    rationale.push(`${mediumBlockers.length} medium-severity issue(s) — approval possible with caveats`);
    return {
      allowedActions: ['approve', 'reject', 'request-recovery', 'needs-review'],
      recommendedAction: 'needs-review',
      rationale,
    };
  }

  rationale.push('All checks pass — approval is eligible');
  return {
    allowedActions: ['approve', 'reject'],
    recommendedAction: 'approve',
    rationale,
  };
}
