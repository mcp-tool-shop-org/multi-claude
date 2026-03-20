import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, timeAgo } from '../hooks/useApi';
import { useActions } from '../hooks/useActions';
import { QueueActionMenu } from '../components/actions/QueueActionMenu';
import { ClaimDialog } from '../components/actions/ClaimDialog';
import { ReleaseDialog } from '../components/actions/ReleaseDialog';
import { DeferDialog } from '../components/actions/DeferDialog';
import { RequeueDialog } from '../components/actions/RequeueDialog';
import { EscalateDialog } from '../components/actions/EscalateDialog';
import { ActionToast } from '../components/actions/ActionToast';
import type { QueueListItem, RoutingLane, OperatorAction } from '../lib/types';

const LANES: RoutingLane[] = ['reviewer', 'approver', 'recovery', 'escalated_review'];

export function QueuePage() {
  const [laneFilter, setLaneFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [claimedFilter, setClaimedFilter] = useState<string>('');

  const params = new URLSearchParams();
  if (laneFilter) params.set('lane', laneFilter);
  if (statusFilter) params.set('status', statusFilter);
  if (claimedFilter) params.set('claimed', claimedFilter);
  params.set('limit', '100');

  const qs = params.toString();
  const { data, loading, error, refetch } = useApi<QueueListItem[]>(`/api/queue?${qs}`);

  const actions = useActions(undefined, refetch);
  const [dialogState, setDialogState] = useState<{ action: OperatorAction; queueItemId: string } | null>(null);

  const handleAction = (queueItemId: string, action: OperatorAction) => {
    actions.clearResult();
    setDialogState({ action, queueItemId });
  };

  const closeDialog = () => setDialogState(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xs text-gray-500 uppercase tracking-wider">Queue</h2>

        {/* Filters */}
        <select
          value={laneFilter}
          onChange={(e) => setLaneFilter(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All lanes</option>
          {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="claimed">claimed</option>
          <option value="deferred">deferred</option>
          <option value="completed">completed</option>
        </select>

        <select
          value={claimedFilter}
          onChange={(e) => setClaimedFilter(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">Claimed: any</option>
          <option value="true">Claimed</option>
          <option value="false">Unclaimed</option>
        </select>

        {data && (
          <span className="ml-auto text-xs text-gray-600">{data.length} items</span>
        )}
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading queue...</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {data && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-600 text-gray-500">
                <th className="text-left px-3 py-2 font-medium">ID</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Lane</th>
                <th className="text-left px-3 py-2 font-medium">Claimant</th>
                <th className="text-left px-3 py-2 font-medium">Flow</th>
                <th className="text-left px-3 py-2 font-medium">Outcome</th>
                <th className="text-left px-3 py-2 font-medium">Age</th>
                <th className="text-left px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.queueItemId} className="border-b border-surface-700 hover:bg-surface-800">
                  <td className="px-3 py-2">
                    <Link
                      to={`/items/${item.queueItemId}`}
                      className="text-blue-400 hover:text-blue-300 font-mono"
                    >
                      {item.queueItemId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-300">{item.role}</td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={item.priorityClass} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2 text-gray-400">{item.lane ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-400 font-mono">
                    {item.claimant ? item.claimant.slice(0, 12) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <FlowIndicators overflow={item.isOverflow} starved={item.isStarved} />
                  </td>
                  <td className="px-3 py-2">
                    {item.hasOutcome ? (
                      <span className={`badge ${item.outcomeStatus === 'closed' ? 'badge-green' : 'badge-amber'}`}>
                        {item.outcomeStatus}
                      </span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {timeAgo(item.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <QueueActionMenu
                      actions={item.actions}
                      onAction={(action) => handleAction(item.queueItemId, action)}
                      pending={actions.state.pending}
                    />
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-gray-600">
                    No items match filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Dialogs */}
      {dialogState && (
        <>
          <ClaimDialog
            open={dialogState.action === 'claim'}
            queueItemId={dialogState.queueItemId}
            onClose={closeDialog}
            onConfirm={async () => { await actions.claim(dialogState.queueItemId); closeDialog(); }}
            submitting={actions.state.pending}
            error={actions.state.lastError}
          />
          <ReleaseDialog
            open={dialogState.action === 'release'}
            queueItemId={dialogState.queueItemId}
            onClose={closeDialog}
            onConfirm={async (reason) => { await actions.release(dialogState.queueItemId, reason); closeDialog(); }}
            submitting={actions.state.pending}
            error={actions.state.lastError}
          />
          <DeferDialog
            open={dialogState.action === 'defer'}
            queueItemId={dialogState.queueItemId}
            onClose={closeDialog}
            onConfirm={async (reason, until) => { await actions.defer(dialogState.queueItemId, reason, until); closeDialog(); }}
            submitting={actions.state.pending}
            error={actions.state.lastError}
          />
          <RequeueDialog
            open={dialogState.action === 'requeue'}
            queueItemId={dialogState.queueItemId}
            onClose={closeDialog}
            onConfirm={async (reason) => { await actions.requeue(dialogState.queueItemId, reason); closeDialog(); }}
            submitting={actions.state.pending}
            error={actions.state.lastError}
          />
          <EscalateDialog
            open={dialogState.action === 'escalate'}
            queueItemId={dialogState.queueItemId}
            onClose={closeDialog}
            onConfirm={async (reason, target) => { await actions.escalate(dialogState.queueItemId, reason, target); closeDialog(); }}
            submitting={actions.state.pending}
            error={actions.state.lastError}
          />
        </>
      )}

      {/* Action feedback toast */}
      <ActionToast
        result={actions.state.lastResult}
        error={actions.state.lastError}
        onDismiss={actions.clearResult}
      />
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: 'badge-red',
    high: 'badge-amber',
    normal: 'badge-blue',
    low: 'badge-gray',
  };
  return <span className={`badge ${colors[priority] ?? 'badge-gray'}`}>{priority}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'badge-amber',
    claimed: 'badge-blue',
    deferred: 'badge-gray',
    completed: 'badge-green',
  };
  return <span className={`badge ${colors[status] ?? 'badge-gray'}`}>{status}</span>;
}

function FlowIndicators({ overflow, starved }: { overflow: boolean; starved: boolean }) {
  if (!overflow && !starved) return <span className="text-gray-600">—</span>;
  return (
    <span className="flex gap-1">
      {overflow && <span className="badge badge-red">overflow</span>}
      {starved && <span className="badge badge-amber">starved</span>}
    </span>
  );
}
