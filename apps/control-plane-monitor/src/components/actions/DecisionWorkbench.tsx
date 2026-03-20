/**
 * DecisionWorkbench — Full brief projection for the judgment surface.
 *
 * Renders the canonical decision brief: blockers, evidence coverage,
 * risks, open loops, delta, eligibility, and decision actions.
 *
 * Law: the UI renders the brief. It does not invent a rubric.
 * recommendedAction is advisory emphasis, not "the correct answer."
 */

import type { BriefWorkbenchView, DecisionAffordance, DecisionAction } from '../../lib/types';

interface DecisionWorkbenchProps {
  workbench: BriefWorkbenchView;
  affordance: DecisionAffordance;
  onDecide: (action: DecisionAction) => void;
  pending: boolean;
}

const ACTION_LABELS: Record<DecisionAction, { label: string; color: string; disabledColor: string }> = {
  'approve': { label: 'Approve', color: 'bg-green-600 hover:bg-green-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  'reject': { label: 'Reject', color: 'bg-red-600 hover:bg-red-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  'request-recovery': { label: 'Request Recovery', color: 'bg-amber-600 hover:bg-amber-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  'needs-review': { label: 'Needs Review', color: 'bg-blue-600 hover:bg-blue-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
};

const SEVERITY_COLORS: Record<string, string> = {
  high: 'badge-red',
  medium: 'badge-amber',
  low: 'badge-gray',
};

export function DecisionWorkbench({ workbench, affordance, onDecide, pending }: DecisionWorkbenchProps) {
  const { eligibility, evidenceCoverage } = workbench;
  const allActions: DecisionAction[] = ['approve', 'reject', 'request-recovery', 'needs-review'];

  return (
    <div className="card space-y-4">
      <h3 className="text-xs text-gray-500 uppercase tracking-wider">Decision Workbench</h3>

      {/* Brief header */}
      <div className="flex items-center gap-3 text-xs">
        <span className="badge badge-purple">{workbench.role}</span>
        <span className="text-gray-400">v{workbench.packetVersion}</span>
        {workbench.baselinePacketVersion != null && (
          <span className="text-gray-600">baseline: v{workbench.baselinePacketVersion}</span>
        )}
        <span className="text-gray-600 font-mono">{workbench.briefId.slice(0, 12)}</span>
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-300 bg-surface-900 rounded p-2">
        {workbench.summary}
      </div>

      {/* Delta */}
      {workbench.deltaSummary.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Delta</div>
          <div className="space-y-0.5">
            {workbench.deltaSummary.map((d, i) => (
              <div key={i} className="text-xs text-gray-400 pl-2 border-l border-surface-600">{d}</div>
            ))}
          </div>
        </div>
      )}

      {/* Blockers */}
      {workbench.blockers.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Blockers</div>
          <div className="space-y-1">
            {workbench.blockers.map((b, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className={`badge ${SEVERITY_COLORS[b.severity] ?? 'badge-gray'}`}>{b.severity}</span>
                <span className="text-gray-300 font-mono">{b.code}</span>
                <span className="text-gray-500">{b.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Coverage */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Evidence Coverage</div>
        <div className="text-xs space-y-0.5">
          <div className="flex gap-2">
            <span className="text-gray-500 w-20">Fingerprint</span>
            <span className="text-gray-400 font-mono">{evidenceCoverage.fingerprint.slice(0, 16)}...</span>
          </div>
          {evidenceCoverage.requiredArtifacts.length > 0 && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20">Required</span>
              <span className="text-gray-400">{evidenceCoverage.requiredArtifacts.join(', ') || '—'}</span>
            </div>
          )}
          {evidenceCoverage.presentArtifacts.length > 0 && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20">Present</span>
              <span className="text-green-400">{evidenceCoverage.presentArtifacts.join(', ')}</span>
            </div>
          )}
          {evidenceCoverage.missingArtifacts.length > 0 && (
            <div className="flex gap-2">
              <span className="text-gray-500 w-20">Missing</span>
              <span className="text-red-400">{evidenceCoverage.missingArtifacts.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Risks & Open Loops */}
      {(workbench.risks.length > 0 || workbench.openLoops.length > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {workbench.risks.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Risks</div>
              {workbench.risks.map((r, i) => (
                <div key={i} className="text-xs text-amber-400 pl-2 border-l border-amber-800">{r}</div>
              ))}
            </div>
          )}
          {workbench.openLoops.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Open Loops</div>
              {workbench.openLoops.map((l, i) => (
                <div key={i} className="text-xs text-gray-400 pl-2 border-l border-surface-600">{l}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Decision Refs */}
      {workbench.decisionRefs.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Decision Refs</div>
          <div className="flex flex-wrap gap-1">
            {workbench.decisionRefs.map((r, i) => (
              <span key={i} className="text-xs font-mono text-gray-400 bg-surface-900 px-1.5 py-0.5 rounded">{r}</span>
            ))}
          </div>
        </div>
      )}

      {/* Decision eligibility + actions */}
      <div className="border-t border-surface-600 pt-3">
        <div className="text-xs text-gray-500 mb-2">Decision</div>

        {/* Recommendation — advisory only */}
        <div className="text-xs text-gray-400 mb-2">
          Recommended by brief: <span className="text-gray-300">{eligibility.recommendedAction}</span>
        </div>

        {/* Rationale */}
        {eligibility.rationale.length > 0 && (
          <div className="text-xs text-gray-500 mb-2 space-y-0.5">
            {eligibility.rationale.map((r, i) => (
              <div key={i} className="pl-2 border-l border-surface-600">{r}</div>
            ))}
          </div>
        )}

        {/* Affordance status */}
        {!affordance.decisionEnabled && affordance.disabledReason && (
          <div className="text-xs text-amber-400 bg-amber-900/20 rounded px-2 py-1.5 mb-2">
            {affordance.disabledReason}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          {allActions.map((action) => {
            const cfg = ACTION_LABELS[action];
            const isAllowed = eligibility.allowedActions.includes(action);
            const isEnabled = isAllowed && affordance.decisionEnabled;
            const isRecommended = action === eligibility.recommendedAction;
            const disabled = !isEnabled || pending;

            return (
              <div key={action} className="relative group">
                <button
                  onClick={() => onDecide(action)}
                  disabled={disabled}
                  className={`px-3 py-1.5 text-xs rounded transition-colors ${
                    disabled ? cfg.disabledColor : cfg.color
                  } disabled:cursor-not-allowed ${
                    isRecommended && isEnabled ? 'ring-1 ring-gray-400' : ''
                  }`}
                >
                  {cfg.label}
                </button>
                {!isAllowed && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-gray-300 bg-surface-900 border border-surface-600 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Not allowed by brief
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
