import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, timeAgo } from '../hooks/useApi';
import type { ActivityEvent, RoutingLane } from '../lib/types';

const SOURCES = ['queue', 'supervisor', 'routing', 'flow', 'intervention', 'policy', 'outcome', 'promotion'] as const;
const LANES: RoutingLane[] = ['reviewer', 'approver', 'recovery', 'escalated_review'];

export function ActivityPage() {
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [laneFilter, setLaneFilter] = useState<string>('');

  const params = new URLSearchParams();
  if (sourceFilter) params.set('source', sourceFilter);
  if (laneFilter) params.set('lane', laneFilter);
  params.set('limit', '200');

  const qs = params.toString();
  const { data, loading, error } = useApi<ActivityEvent[]>(`/api/activity?${qs}`);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xs text-gray-500 uppercase tracking-wider">Activity Timeline</h2>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={laneFilter}
          onChange={(e) => setLaneFilter(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs text-gray-300"
        >
          <option value="">All lanes</option>
          {LANES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>

        {data && (
          <span className="ml-auto text-xs text-gray-600">{data.length} events</span>
        )}
      </div>

      {loading && <div className="text-gray-500 text-sm">Loading activity...</div>}
      {error && <div className="text-red-400 text-sm">Error: {error}</div>}

      {data && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-600 text-gray-500">
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-left px-3 py-2 font-medium">Kind</th>
                <th className="text-left px-3 py-2 font-medium">Lane</th>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-left px-3 py-2 font-medium">Actor</th>
                <th className="text-left px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ev) => (
                <tr key={ev.id} className="border-b border-surface-700 hover:bg-surface-800">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{timeAgo(ev.timestamp)}</td>
                  <td className="px-3 py-2">
                    <SourceBadge source={ev.source} />
                  </td>
                  <td className="px-3 py-2 text-gray-300">{ev.kind}</td>
                  <td className="px-3 py-2 text-gray-400">{ev.lane ?? '—'}</td>
                  <td className="px-3 py-2">
                    {ev.queueItemId ? (
                      <Link
                        to={`/items/${ev.queueItemId}`}
                        className="text-blue-400 hover:text-blue-300 font-mono"
                      >
                        {ev.queueItemId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono">
                    {ev.actor ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 truncate max-w-xs">{ev.detail}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-600">
                    No activity matches filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
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
