import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi, timeAgo, formatDuration } from '../hooks/useApi';
import { useActions } from '../hooks/useActions';
import { useDecision } from '../hooks/useDecision';
import { HealthBadge } from '../components/StatusDot';
import { ActionPanel } from '../components/actions/ActionPanel';
import { ClaimDialog } from '../components/actions/ClaimDialog';
import { ReleaseDialog } from '../components/actions/ReleaseDialog';
import { DeferDialog } from '../components/actions/DeferDialog';
import { RequeueDialog } from '../components/actions/RequeueDialog';
import { EscalateDialog } from '../components/actions/EscalateDialog';
import { DecisionWorkbench } from '../components/actions/DecisionWorkbench';
import { DecisionDialog } from '../components/actions/DecisionDialog';
import { ActionToast } from '../components/actions/ActionToast';
import type { ItemDetailView, OperatorAction, DecisionAction } from '../lib/types';

export function ItemDetailPage() {
  const { queueItemId } = useParams<{ queueItemId: string }>();
  const { data, loading, error, refetch } = useApi<ItemDetailView>(
    `/api/items/${queueItemId}`,
    10000,
  );

  const actions = useActions(undefined, refetch);
  const decision = useDecision(undefined, refetch);
  const [openDialog, setOpenDialog] = useState<OperatorAction | null>(null);
  const [decisionAction, setDecisionAction] = useState<DecisionAction | null>(null);

  const handleAction = (action: OperatorAction) => {
    actions.clearResult();
    setOpenDialog(action);
  };

  const handleDecision = (action: DecisionAction) => {
    decision.clearResult();
    setDecisionAction(action);
  };

  const closeDialog = () => setOpenDialog(null);
  const closeDecisionDialog = () => setDecisionAction(null);

  if (loading) return <div className="text-gray-500 text-sm">Loading item...</div>;
  if (error) return <div className="text-red-400 text-sm">Error: {error}</div>;
  if (!data) return <div className="text-gray-500 text-sm">Item not found</div>;

  const decisionToastResult = decision.state.lastResult ? {
    ok: decision.state.lastResult.ok,
    action: decision.state.lastResult.action as OperatorAction,
    queueItemId: decision.state.lastResult.queueItemId,
    error: decision.state.lastResult.error,
  } : null;

  return (
    <div className="space-y-4">
      {/* ── 1. What's happening now ────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link to="/queue" className="text-xs text-gray-500 hover:text-gray-300">&larr; Queue</Link>
        <span className="badge badge-blue">{data.status}</span>
        <span className="badge badge-gray">{data.priorityClass}</span>
        <span className="text-xs text-gray-500">{data.role}</span>
        <span className="text-xs text-gray-600 ml-auto">{timeAgo(data.createdAt)}</span>
      </div>

      <Situation data={data} />

      {/* ── 2. Why it matters / what's blocked ────────────────── */}
      {data.workbench && (
        <DecisionWorkbench
          workbench={data.workbench}
          affordance={data.decisionAffordance}
          onDecide={handleDecision}
          pending={decision.state.pending}
        />
      )}

      {/* ── 3. What I can do next ─────────────────────────────── */}
      <div className="card">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Actions</h3>
        <ActionPanel
          actions={data.actions}
          onAction={handleAction}
          pending={actions.state.pending}
        />
      </div>

      {/* ── 4. What changed ───────────────────────────────────── */}
      {data.timeline.length > 0 && (
        <Collapsible title="Recent Activity" defaultOpen={data.timeline.length <= 5}>
          <div className="space-y-1">
            {data.timeline.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-gray-600 w-16 shrink-0 text-right">{timeAgo(ev.timestamp)}</span>
                <span className={`badge ${sourceBadgeClass(ev.source)}`}>{ev.source}</span>
                <span className="text-gray-300">{ev.kind}</span>
                <span className="text-gray-500 truncate">{ev.detail}</span>
              </div>
            ))}
          </div>
        </Collapsible>
      )}

      {/* ── 5. Proof behind the fold ──────────────────────────── */}
      <Collapsible title="Routing" defaultOpen={false}>
        <KV label="Lane" value={data.routing.currentLane ?? 'unrouted'} />
        <KV label="Target" value={data.routing.assignedTarget ?? '—'} />
        {data.routing.routeHistory.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {data.routing.routeHistory.map((r) => (
              <div key={r.routeId} className="text-xs text-gray-400 flex gap-2">
                <span className="text-gray-600">{timeAgo(r.routedAt)}</span>
                <span>{r.lane}</span>
                <span className="text-gray-600">{r.reasonCode}</span>
                <span className={r.status === 'active' ? 'text-green-400' : 'text-gray-500'}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </Collapsible>

      <Collapsible title="Supervisor" defaultOpen={false}>
        {data.supervisor.activeClaim ? (
          <div className="space-y-1">
            <KV label="Claimant" value={data.supervisor.activeClaim.actor} mono />
            <KV label="Status" value={data.supervisor.activeClaim.status} />
            <KV label="Claimed" value={timeAgo(data.supervisor.activeClaim.claimedAt)} />
            <KV label="Expires" value={timeAgo(data.supervisor.activeClaim.expiresAt)} />
          </div>
        ) : (
          <div className="text-xs text-gray-600">No active claim</div>
        )}
        {data.supervisor.claimHistory.length > 1 && (
          <div className="mt-2 text-xs text-gray-500">
            {data.supervisor.claimHistory.length} total claims
          </div>
        )}
      </Collapsible>

      {data.outcome && (
        <Collapsible title="Outcome" defaultOpen={false}>
          <KV label="Status" value={data.outcome.status} />
          {data.outcome.finalAction && <KV label="Action" value={data.outcome.finalAction} />}
          {data.outcome.resolutionQuality && <KV label="Quality" value={data.outcome.resolutionQuality} />}
          {data.outcome.durationMs != null && <KV label="Duration" value={formatDuration(data.outcome.durationMs)} />}
          <div className="grid grid-cols-4 gap-2 mt-2 text-xs text-gray-400">
            <div>Claims: {data.outcome.claimCount}</div>
            <div>Defers: {data.outcome.deferCount}</div>
            <div>Reroutes: {data.outcome.rerouteCount}</div>
            <div>Escalations: {data.outcome.escalationCount}</div>
          </div>
        </Collapsible>
      )}

      <Collapsible title="IDs &amp; Context" defaultOpen={false}>
        <KV label="Item" value={data.queueItemId} mono />
        <KV label="Handoff" value={data.handoffId} mono />
        {data.handoffSummary && <KV label="Summary" value={data.handoffSummary} />}
        {data.intervention.laneHealth && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500">Lane health:</span>
            <HealthBadge state={data.intervention.laneHealth} />
          </div>
        )}
        {data.intervention.activeIntervention && (
          <div className="mt-1">
            <KV label="Intervention" value={`${data.intervention.activeIntervention.action}: ${data.intervention.activeIntervention.reason}`} />
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-surface-700 space-y-1">
          <KV label="Policy" value={data.policy.policySetId ?? '—'} mono />
          <KV label="Version" value={String(data.policy.policyVersion ?? '—')} />
          {data.policy.isTrialPolicy && <KV label="Trial" value="yes" />}
        </div>
        {data.flow.isOverflow && (
          <div className="mt-1">
            <KV label="Overflow" value={data.flow.overflowSince ? `since ${timeAgo(data.flow.overflowSince)}` : 'yes'} />
          </div>
        )}
      </Collapsible>

      {/* ── Dialogs (13B) ─────────────────────────────────────── */}
      <ClaimDialog
        open={openDialog === 'claim'}
        queueItemId={data.queueItemId}
        onClose={closeDialog}
        onConfirm={async () => { await actions.claim(data.queueItemId); closeDialog(); }}
        submitting={actions.state.pending}
        error={actions.state.lastError}
      />
      <ReleaseDialog
        open={openDialog === 'release'}
        queueItemId={data.queueItemId}
        onClose={closeDialog}
        onConfirm={async (reason) => { await actions.release(data.queueItemId, reason); closeDialog(); }}
        submitting={actions.state.pending}
        error={actions.state.lastError}
      />
      <DeferDialog
        open={openDialog === 'defer'}
        queueItemId={data.queueItemId}
        onClose={closeDialog}
        onConfirm={async (reason, until) => { await actions.defer(data.queueItemId, reason, until); closeDialog(); }}
        submitting={actions.state.pending}
        error={actions.state.lastError}
      />
      <RequeueDialog
        open={openDialog === 'requeue'}
        queueItemId={data.queueItemId}
        onClose={closeDialog}
        onConfirm={async (reason) => { await actions.requeue(data.queueItemId, reason); closeDialog(); }}
        submitting={actions.state.pending}
        error={actions.state.lastError}
      />
      <EscalateDialog
        open={openDialog === 'escalate'}
        queueItemId={data.queueItemId}
        onClose={closeDialog}
        onConfirm={async (reason, target) => { await actions.escalate(data.queueItemId, reason, target); closeDialog(); }}
        submitting={actions.state.pending}
        error={actions.state.lastError}
      />

      {/* Decision Dialog (13C) */}
      <DecisionDialog
        open={decisionAction !== null}
        queueItemId={data.queueItemId}
        action={decisionAction}
        evidenceFingerprint={data.workbench?.evidenceCoverage.fingerprint ?? ''}
        onClose={closeDecisionDialog}
        onConfirm={async (reason) => {
          if (decisionAction) {
            await decision.decide(data.queueItemId, decisionAction, reason);
            closeDecisionDialog();
          }
        }}
        submitting={decision.state.pending}
        error={decision.state.lastError}
      />

      {/* Toasts */}
      <ActionToast
        result={actions.state.lastResult}
        error={actions.state.lastError}
        onDismiss={actions.clearResult}
      />
      <ActionToast
        result={decisionToastResult}
        error={decision.state.lastError}
        onDismiss={decision.clearResult}
      />
    </div>
  );
}

// ── Situation banner ───────────────────────────────────────────────

function Situation({ data }: { data: ItemDetailView }) {
  // ── State: what is this and where is it ──
  const state: string[] = [];
  if (data.handoffSummary) state.push(data.handoffSummary);
  if (data.supervisor.activeClaim) {
    state.push(`Claimed by ${data.supervisor.activeClaim.actor}`);
  } else if (data.status === 'pending') {
    state.push('Unclaimed — waiting for operator');
  } else {
    state.push(data.status);
  }

  // ── Risk: what's blocked or dangerous ──
  const risks: string[] = [];
  if (data.workbench) {
    const high = data.workbench.blockers.filter(b => b.severity === 'high').length;
    const med = data.workbench.blockers.filter(b => b.severity === 'medium').length;
    if (high > 0) risks.push(`${high} high-severity blocker${high > 1 ? 's' : ''}`);
    if (med > 0) risks.push(`${med} medium-severity blocker${med > 1 ? 's' : ''}`);
    if (data.workbench.evidenceCoverage.missingArtifacts.length > 0) {
      risks.push(`Missing: ${data.workbench.evidenceCoverage.missingArtifacts.join(', ')}`);
    }
  }
  if (data.intervention.activeIntervention) {
    risks.push(`Intervention: ${data.intervention.activeIntervention.action}`);
  }
  if (data.flow.isOverflow) {
    risks.push('Lane in overflow');
  }

  // ── Next move: concrete operator instruction ──
  let nextMove: string | null = null;
  if (data.workbench?.eligibility.recommendedAction) {
    const rec = data.workbench.eligibility.recommendedAction;
    const verb: Record<string, string> = {
      'approve': 'Approve this handoff',
      'reject': 'Reject this handoff',
      'request-recovery': 'Send back for recovery',
      'needs-review': 'Escalate to reviewer',
    };
    nextMove = verb[rec] ?? rec;
    if (data.workbench.eligibility.rationale.length > 0) {
      nextMove += ` — ${data.workbench.eligibility.rationale[0]}`;
    }
  } else if (!data.supervisor.activeClaim && data.actions.claim.allowed) {
    nextMove = 'Claim this item to start working it';
  } else if (data.supervisor.activeClaim && data.decisionAffordance.decisionEnabled) {
    nextMove = 'Review the brief and decide';
  } else if (data.supervisor.activeClaim && !data.decisionAffordance.decisionEnabled) {
    nextMove = data.decisionAffordance.disabledReason
      ? `Blocked: ${data.decisionAffordance.disabledReason}`
      : 'Wait for brief to become available';
  } else if (!data.supervisor.activeClaim && !data.actions.claim.allowed) {
    nextMove = data.actions.claim.reason ?? 'Cannot act — claim not available';
  }

  if (state.length === 0 && risks.length === 0 && !nextMove) return null;

  return (
    <div className="card bg-surface-800/60 border-surface-600 space-y-2">
      {/* State */}
      {state.length > 0 && (
        <div>
          {state.map((s, i) => (
            <div key={i} className={`text-sm ${i === 0 ? 'text-gray-200' : 'text-gray-400'}`}>{s}</div>
          ))}
        </div>
      )}
      {/* Risk */}
      {risks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {risks.map((r, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-300">{r}</span>
          ))}
        </div>
      )}
      {/* Next move */}
      {nextMove && (
        <div className="text-sm text-blue-300 font-medium">{nextMove}</div>
      )}
    </div>
  );
}

// ── Collapsible section ────────────────────────────────────────────

function Collapsible({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card">
      <button
        className="w-full flex items-center justify-between text-xs text-gray-500 uppercase tracking-wider"
        onClick={() => setOpen(!open)}
      >
        {title}
        <span className="text-gray-600">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 w-20 shrink-0">{label}</span>
      <span className={`text-gray-300 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    queue: 'badge-blue',
    supervisor: 'badge-purple',
    routing: 'badge-amber',
    flow: 'badge-green',
    intervention: 'badge-red',
    policy: 'badge-gray',
    outcome: 'badge-green',
    promotion: 'badge-purple',
  };
  return map[source] ?? 'badge-gray';
}
