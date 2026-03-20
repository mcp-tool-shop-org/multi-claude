/**
 * Decision Briefs — Deterministic blocker derivation.
 *
 * Blockers are conditions that prevent approval or require recovery.
 * They are derived from state, not invented by a model.
 *
 * Blocker codes:
 *   - invalidated_version: current version is invalidated
 *   - all_versions_invalidated: no valid versions remain
 *   - missing_evidence: required artifacts not present
 *   - high_priority_open_loops: unresolved high-priority items
 *   - instruction_drift: instructions changed without re-review
 *   - no_render_event: packet was never rendered for this role
 *   - approval_revoked: prior approval was revoked
 *   - recovery_pending: packet is in recovery state
 */

import type { HandoffStore } from '../store/handoff-store.js';
import type { HandoffPacket, HandoffId } from '../schema/packet.js';
import type { DecisionBlocker, DecisionRole, EvidenceCoverage } from './types.js';
import type { BaselineDelta } from './types.js';

// ── Blocker derivation ──────────────────────────────────────────────

/**
 * Derive all deterministic blockers for a handoff packet.
 */
export function deriveBlockers(input: {
  store: HandoffStore;
  packet: HandoffPacket;
  role: DecisionRole;
  evidenceCoverage: EvidenceCoverage;
  delta: BaselineDelta | null;
}): DecisionBlocker[] {
  const blockers: DecisionBlocker[] = [];
  const { store, packet, role, evidenceCoverage, delta } = input;
  const handoffId = packet.handoffId as HandoffId;

  // 1. Version invalidated
  if (store.isVersionInvalidated(handoffId, packet.packetVersion)) {
    const invalidations = store.getInvalidations(handoffId)
      .filter(inv => inv.packetVersion === packet.packetVersion);
    const reason = invalidations[0]?.reason ?? 'unknown';
    blockers.push({
      code: 'invalidated_version',
      severity: 'high',
      summary: `Version ${packet.packetVersion} is invalidated: ${reason}`,
    });
  }

  // 2. All versions invalidated (check if any valid remain)
  const versions = store.listVersions(handoffId);
  const allInvalidated = versions.length > 0 && versions.every(
    v => store.isVersionInvalidated(handoffId, v.packetVersion),
  );
  if (allInvalidated) {
    blockers.push({
      code: 'all_versions_invalidated',
      severity: 'high',
      summary: `All ${versions.length} version(s) are invalidated — no valid state to approve`,
    });
  }

  // 3. Missing evidence
  if (evidenceCoverage.missingArtifacts.length > 0) {
    blockers.push({
      code: 'missing_evidence',
      severity: role === 'approver' ? 'high' : 'medium',
      summary: `${evidenceCoverage.missingArtifacts.length} required artifact(s) missing: ${evidenceCoverage.missingArtifacts.join(', ')}`,
    });
  }

  // 4. High-priority open loops
  const highPriorityLoops = packet.openLoops.filter(l => l.priority === 'high');
  if (highPriorityLoops.length > 0) {
    blockers.push({
      code: 'high_priority_open_loops',
      severity: role === 'approver' ? 'high' : 'medium',
      summary: `${highPriorityLoops.length} high-priority open loop(s): ${highPriorityLoops.map(l => l.summary).join('; ')}`,
    });
  }

  // 5. Instruction drift (instructions changed since baseline without re-review)
  if (delta && role === 'approver') {
    if (delta.instructionsChanged || delta.constraintsChanged || delta.prohibitionsChanged) {
      // Check if there's been a review render since the change
      const renderEvents = store.getRenderEvents(handoffId);
      const reviewRenders = renderEvents.filter(
        e => e.roleRenderer === 'reviewer' && e.packetVersion === packet.packetVersion,
      );
      if (reviewRenders.length === 0) {
        blockers.push({
          code: 'instruction_drift',
          severity: 'medium',
          summary: 'Instructions/constraints changed since baseline but no reviewer has seen this version',
        });
      }
    }
  }

  // 6. No render event for this role on this version
  const renderEvents = store.getRenderEvents(handoffId);
  const roleRenders = renderEvents.filter(
    e => e.roleRenderer === role && e.packetVersion === packet.packetVersion,
  );
  // For approver, not a hard blocker — the brief itself creates the render
  if (role === 'reviewer' && roleRenders.length === 0) {
    blockers.push({
      code: 'no_render_event',
      severity: 'low',
      summary: 'This version has not been rendered for a reviewer yet',
    });
  }

  // 7. Approval revoked
  const approvals = store.getApprovals(handoffId);
  const revokedForVersion = approvals.filter(
    a => a.packetVersion === packet.packetVersion && a.approvalStatus === 'revoked',
  );
  if (revokedForVersion.length > 0) {
    blockers.push({
      code: 'approval_revoked',
      severity: 'high',
      summary: `Prior approval for v${packet.packetVersion} was revoked`,
    });
  }

  // 8. Packet in recovery state
  const record = store.getPacket(handoffId);
  if (record && record.status === 'invalidated') {
    blockers.push({
      code: 'recovery_pending',
      severity: 'high',
      summary: 'Handoff packet is in invalidated state — recovery required before approval',
    });
  }

  return blockers;
}
