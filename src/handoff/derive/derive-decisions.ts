/**
 * Handoff Spine — Derive decisions from execution truth.
 *
 * Decisions are what was decided and why during the run.
 * They prevent thrash and re-litigation by the next agent.
 */

import type { HandoffDecision, HandoffRejection } from '../schema/packet.js';
import { generateId } from '../../lib/ids.js';

export interface DecisionSource {
  approvals: Array<{
    scopeType: string;
    scopeId: string;
    decision: string;
    rationale?: string;
  }>;
  contractDeltas: Array<{
    description: string;
    status: string;
    resolutionNotes?: string;
  }>;
  customDecisions?: Array<{
    summary: string;
    rationale: string;
    evidenceRefs?: string[];
  }>;
}

export function deriveDecisions(source: DecisionSource): HandoffDecision[] {
  const decisions: HandoffDecision[] = [];

  for (const approval of source.approvals) {
    if (approval.decision === 'approved' || approval.decision === 'approved_with_conditions') {
      decisions.push({
        id: generateId('dec'),
        summary: `Approved ${approval.scopeType} ${approval.scopeId}`,
        rationale: approval.rationale ?? 'No rationale recorded',
      });
    }
  }

  for (const delta of source.contractDeltas) {
    if (delta.status === 'landed' || delta.status === 'approved') {
      decisions.push({
        id: generateId('dec'),
        summary: `Contract delta: ${delta.description}`,
        rationale: delta.resolutionNotes ?? 'Accepted as proposed',
      });
    }
  }

  if (source.customDecisions) {
    for (const custom of source.customDecisions) {
      decisions.push({
        id: generateId('dec'),
        summary: custom.summary,
        rationale: custom.rationale,
        evidenceRefs: custom.evidenceRefs,
      });
    }
  }

  return decisions;
}

export interface RejectionSource {
  rejectedApprovals: Array<{
    scopeType: string;
    scopeId: string;
    rationale?: string;
  }>;
  rejectedDeltas: Array<{
    description: string;
    resolutionNotes?: string;
  }>;
  customRejections?: Array<{
    summary: string;
    rationale: string;
  }>;
}

export function deriveRejections(source: RejectionSource): HandoffRejection[] {
  const rejections: HandoffRejection[] = [];

  for (const r of source.rejectedApprovals) {
    rejections.push({
      id: generateId('rej'),
      summary: `Rejected ${r.scopeType} ${r.scopeId}`,
      rationale: r.rationale ?? 'No rationale recorded',
    });
  }

  for (const d of source.rejectedDeltas) {
    rejections.push({
      id: generateId('rej'),
      summary: `Rejected delta: ${d.description}`,
      rationale: d.resolutionNotes ?? 'Rejected without notes',
    });
  }

  if (source.customRejections) {
    for (const custom of source.customRejections) {
      rejections.push({
        id: generateId('rej'),
        summary: custom.summary,
        rationale: custom.rationale,
      });
    }
  }

  return rejections;
}
