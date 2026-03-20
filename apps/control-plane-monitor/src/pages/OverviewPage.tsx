import { Link } from 'react-router-dom';
import { useApi, timeAgo } from '../hooks/useApi';
import { StatusDot, HealthBadge } from '../components/StatusDot';
import type { OverviewSnapshot, ActivityEvent } from '../lib/types';

function CountCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? 'text-gray-100'}`}>{value}</span>
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    queue: 'badge-blue',
    supervisor: 'badge-purple',
    routing: 'badge-amber',
    flow: 'badge-green',
    intervention: 'badge-red',
    policy: 'badge-gray',
    outcome: 'badge-green',
    promotion: 'badge-purple',
  };
  return <span className={`badge ${colors[source] ?? 'badge-gray'}`}>{source}</span>;
}

export function OverviewPage() {
  const { data, loading, error } = useApi<OverviewSnapshot>('/api/overview');

  if (loading) return <div className="text-gray-500 text-sm">Loading overview...</div>;
  if (error) return <div className="text-red-400 text-sm">Error: {error}</div>;
  if (!data) return null;

  const { counts, lanes, recentActivity, activePolicy, activeTrials } = data;

  return (
    <div className="space-y-6">
      {/* System counts */}
      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">System</h2>
        <div className="grid grid-cols-4 gap-3">
          <CountCard label="Pending" value={counts.pendingItems} />
          <CountCard label="Claimed" value={counts.claimedItems} accent="text-blue-400" />
          <CountCard label="Deferred" value={counts.deferredItems} />
          <CountCard label="Active" value={counts.totalActiveItems} accent="text-green-400" />
        </div>
        <div className="grid grid-cols-4 gap-3 mt-3">
          <CountCard label="Open Outcomes" value={counts.openOutcomes} />
          <CountCard label="Closed Outcomes" value={counts.closedOutcomes} />
          <CountCard label="Interventions" value={counts.activeInterventions} accent={counts.activeInterventions > 0 ? 'text-red-400' : undefined} />
          <CountCard label="Trials" value={counts.activeTrials} accent={counts.activeTrials > 0 ? 'text-purple-400' : undefined} />
        </div>
      </section>

      {/* Lane strip */}
      <section>
        <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Lanes</h2>
        <div className="grid grid-cols-4 gap-3">
          {lanes.map((lane) => (
            <Link key={lane.lane} to={`/lanes`} className="card hover:border-surface-500 transition-colors">
              <div className="flex items-center gap-2 mb-2">
                <StatusDot state={lane.healthState} />
                <span className="text-sm font-medium text-gray-200">{lane.lane}</span>
                <HealthBadge state={lane.healthState} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                <div>
                  <span className="text-gray-600">active</span>
                  <span className="ml-1 text-gray-300">{lane.activeCount}/{lane.wipCap}</span>
                </div>
                <div>
                  <span className="text-gray-600">pending</span>
                  <span className="ml-1 text-gray-300">{lane.pendingCount}</span>
                </div>
                <div>
                  <span className="text-gray-600">overflow</span>
                  <span className="ml-1 text-gray-300">{lane.overflowCount}</span>
                </div>
              </div>
              {lane.hasIntervention && lane.interventionAction && (
                <div className="mt-2">
                  <span className="badge badge-red">{lane.interventionAction}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* Active policy + trials */}
      <section className="grid grid-cols-2 gap-3">
        <div className="card">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Active Policy</h3>
          {activePolicy.policySetId ? (
            <div className="space-y-1 text-sm">
              <div><span className="text-gray-500">ID:</span> <span className="text-gray-300 font-mono text-xs">{activePolicy.policySetId}</span></div>
              <div><span className="text-gray-500">Version:</span> <span className="text-gray-300">{activePolicy.version}</span></div>
              {activePolicy.activatedAt && (
                <div><span className="text-gray-500">Since:</span> <span className="text-gray-400">{timeAgo(activePolicy.activatedAt)}</span></div>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-600">No active policy</div>
          )}
        </div>
        <div className="card">
          <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Active Trials</h3>
          {activeTrials.length === 0 ? (
            <div className="text-sm text-gray-600">No active trials</div>
          ) : (
            <div className="space-y-2">
              {activeTrials.map((trial) => (
                <div key={trial.promotionId} className="text-sm">
                  <span className="badge badge-purple">{trial.status}</span>
                  <span className="ml-2 text-gray-400 text-xs font-mono">{trial.candidatePolicySetId.slice(0, 8)}</span>
                  <span className="ml-1 text-gray-600">vs</span>
                  <span className="ml-1 text-gray-400 text-xs font-mono">{trial.baselinePolicySetId.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs text-gray-500 uppercase tracking-wider">Recent Activity</h2>
          <Link to="/activity" className="text-xs text-gray-500 hover:text-gray-300">
            View all
          </Link>
        </div>
        <div className="card p-0">
          <ActivityTable events={recentActivity.slice(0, 10)} />
        </div>
      </section>
    </div>
  );
}

function ActivityTable({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return <div className="p-4 text-sm text-gray-600">No recent activity</div>;
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-surface-600 text-gray-500">
          <th className="text-left px-3 py-2 font-medium">Time</th>
          <th className="text-left px-3 py-2 font-medium">Source</th>
          <th className="text-left px-3 py-2 font-medium">Kind</th>
          <th className="text-left px-3 py-2 font-medium">Lane</th>
          <th className="text-left px-3 py-2 font-medium">Detail</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr key={ev.id} className="border-b border-surface-700 hover:bg-surface-800">
            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{timeAgo(ev.timestamp)}</td>
            <td className="px-3 py-2">
              <SourceBadge source={ev.source} />
            </td>
            <td className="px-3 py-2 text-gray-300">{ev.kind}</td>
            <td className="px-3 py-2 text-gray-400">{ev.lane ?? '—'}</td>
            <td className="px-3 py-2 text-gray-400 truncate max-w-xs">{ev.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
