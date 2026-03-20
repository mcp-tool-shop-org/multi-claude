import { useApi, timeAgo } from '../hooks/useApi';
import { StatusDot, HealthBadge } from '../components/StatusDot';
import type { LaneHealthView, ActivityEvent } from '../lib/types';

export function LanesPage() {
  const { data, loading, error } = useApi<LaneHealthView[]>('/api/lanes');

  if (loading) return <div className="text-gray-500 text-sm">Loading lanes...</div>;
  if (error) return <div className="text-red-400 text-sm">Error: {error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-xs text-gray-500 uppercase tracking-wider">Lane Health</h2>
      <div className="grid grid-cols-1 gap-4">
        {data.map((lane) => (
          <LaneCard key={lane.lane} lane={lane} />
        ))}
      </div>
    </div>
  );
}

function LaneCard({ lane }: { lane: LaneHealthView }) {
  const utilPct = Math.round(lane.utilization * 100);
  const utilColor = utilPct > 90 ? 'text-red-400' : utilPct > 70 ? 'text-amber-400' : 'text-green-400';

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <StatusDot state={lane.healthState} />
        <span className="text-sm font-medium text-gray-200">{lane.lane}</span>
        <HealthBadge state={lane.healthState} />
        {lane.breachCodes.length > 0 && (
          <span className="flex gap-1 ml-2">
            {lane.breachCodes.map((code) => (
              <span key={code} className="badge badge-red">{code}</span>
            ))}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Capacity */}
        <div>
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Capacity</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Utilization</span>
              <span className={utilColor}>{utilPct}%</span>
            </div>
            <div className="w-full bg-surface-900 rounded-full h-1.5 mt-1">
              <div
                className={`h-1.5 rounded-full ${utilPct > 90 ? 'bg-red-500' : utilPct > 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                style={{ width: `${Math.min(utilPct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Active: {lane.activeCount}/{lane.wipCap}</span>
              <span>Pending: {lane.pendingCount}</span>
            </div>
          </div>
        </div>

        {/* Pressure */}
        <div>
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pressure</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">Overflow</span>
              <span className={lane.overflowCount > 0 ? 'text-red-400' : 'text-gray-400'}>{lane.overflowCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Starved</span>
              <span className={lane.starvedCount > 0 ? 'text-amber-400' : 'text-gray-400'}>{lane.starvedCount}</span>
            </div>
          </div>

          <h4 className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2">Policy Inputs</h4>
          <div className="space-y-1 text-xs text-gray-400">
            <div>WIP cap: {lane.policyInputs.wipCap}</div>
            <div>Starvation: {lane.policyInputs.starvationThresholdMs}ms</div>
            <div>Overflow: {lane.policyInputs.overflowThreshold}</div>
          </div>
        </div>

        {/* Intervention + Trial */}
        <div>
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Intervention</h4>
          {lane.intervention ? (
            <div className="space-y-1 text-xs">
              <span className="badge badge-red">{lane.intervention.action}</span>
              <div className="text-gray-400">{lane.intervention.reason}</div>
              <div className="text-gray-500">by {lane.intervention.actor}, {timeAgo(lane.intervention.triggeredAt)}</div>
            </div>
          ) : (
            <div className="text-xs text-gray-600">None</div>
          )}

          <h4 className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-2">Trial</h4>
          {lane.trial ? (
            <div className="space-y-1 text-xs">
              <span className="badge badge-purple">{lane.trial.status}</span>
              <div className="text-gray-400 font-mono text-[10px]">
                {lane.trial.candidatePolicySetId.slice(0, 12)} vs {lane.trial.baselinePolicySetId.slice(0, 12)}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-600">None</div>
          )}
        </div>
      </div>

      {/* Recent events */}
      {lane.recentEvents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-surface-600">
          <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Recent Events</h4>
          <div className="space-y-1">
            {lane.recentEvents.slice(0, 5).map((ev: ActivityEvent) => (
              <div key={ev.id} className="flex items-center gap-2 text-xs">
                <span className="text-gray-600 w-14 shrink-0 text-right">{timeAgo(ev.timestamp)}</span>
                <span className="text-gray-300">{ev.kind}</span>
                <span className="text-gray-500 truncate">{ev.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
