import { useParams, Link } from 'react-router-dom';
import { useApi, timeAgo, formatDuration } from '../hooks/useApi';
import { HealthBadge } from '../components/StatusDot';
import type { ItemDetailView } from '../lib/types';

export function ItemDetailPage() {
  const { queueItemId } = useParams<{ queueItemId: string }>();
  const { data, loading, error } = useApi<ItemDetailView>(
    `/api/items/${queueItemId}`,
    10000,
  );

  if (loading) return <div className="text-gray-500 text-sm">Loading item...</div>;
  if (error) return <div className="text-red-400 text-sm">Error: {error}</div>;
  if (!data) return <div className="text-gray-500 text-sm">Item not found</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/queue" className="text-xs text-gray-500 hover:text-gray-300">&larr; Queue</Link>
        <h2 className="text-sm font-medium text-gray-200 font-mono">{data.queueItemId}</h2>
        <span className="badge badge-blue">{data.status}</span>
        <span className="badge badge-gray">{data.priorityClass}</span>
        <span className="text-xs text-gray-500">{data.role}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          {/* Handoff */}
          <Section title="Handoff">
            <KV label="Handoff ID" value={data.handoffId} mono />
            <KV label="Created" value={timeAgo(data.createdAt)} />
            {data.handoffSummary && <KV label="Summary" value={data.handoffSummary} />}
          </Section>

          {/* Brief */}
          {data.brief && (
            <Section title="Decision Brief">
              <KV label="Brief ID" value={data.brief.briefId} mono />
              <KV label="Role" value={data.brief.role} />
              {data.brief.renderedText && (
                <div className="mt-2 text-xs text-gray-400 bg-surface-900 rounded p-2 whitespace-pre-wrap">
                  {data.brief.renderedText}
                </div>
              )}
            </Section>
          )}

          {/* Blockers */}
          {data.blockers.length > 0 && (
            <Section title="Blockers">
              {data.blockers.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`badge ${b.severity === 'hard' ? 'badge-red' : 'badge-amber'}`}>{b.severity}</span>
                  <span className="text-gray-300">{b.code}</span>
                  {b.detail && <span className="text-gray-500">— {b.detail}</span>}
                </div>
              ))}
            </Section>
          )}

          {/* Routing */}
          <Section title="Routing">
            <KV label="Lane" value={data.routing.currentLane ?? 'unrouted'} />
            <KV label="Target" value={data.routing.assignedTarget ?? '—'} />
            {data.routing.routeHistory.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-gray-500 mb-1">Route History</div>
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
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Supervisor */}
          <Section title="Supervisor">
            {data.supervisor.activeClaim ? (
              <>
                <KV label="Claimant" value={data.supervisor.activeClaim.actor} mono />
                <KV label="Status" value={data.supervisor.activeClaim.status} />
                <KV label="Claimed" value={timeAgo(data.supervisor.activeClaim.claimedAt)} />
                <KV label="Expires" value={timeAgo(data.supervisor.activeClaim.expiresAt)} />
              </>
            ) : (
              <div className="text-xs text-gray-600">No active claim</div>
            )}
            {data.supervisor.claimHistory.length > 1 && (
              <div className="mt-2 text-xs text-gray-500">
                {data.supervisor.claimHistory.length} total claims
              </div>
            )}
          </Section>

          {/* Flow */}
          <Section title="Flow">
            <KV label="Overflow" value={data.flow.isOverflow ? 'yes' : 'no'} />
            {data.flow.overflowSince && <KV label="Since" value={timeAgo(data.flow.overflowSince)} />}
          </Section>

          {/* Intervention */}
          <Section title="Intervention">
            {data.intervention.laneHealth && (
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500">Lane health:</span>
                <HealthBadge state={data.intervention.laneHealth} />
              </div>
            )}
            {data.intervention.activeIntervention ? (
              <>
                <KV label="Action" value={data.intervention.activeIntervention.action} />
                <KV label="Reason" value={data.intervention.activeIntervention.reason} />
                <KV label="Triggered" value={timeAgo(data.intervention.activeIntervention.triggeredAt)} />
              </>
            ) : (
              <div className="text-xs text-gray-600">No active intervention</div>
            )}
          </Section>

          {/* Outcome */}
          {data.outcome && (
            <Section title="Outcome">
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
            </Section>
          )}

          {/* Policy */}
          <Section title="Policy Context">
            <KV label="Policy Set" value={data.policy.policySetId ?? '—'} mono />
            <KV label="Version" value={String(data.policy.policyVersion ?? '—')} />
            <KV label="Trial" value={data.policy.isTrialPolicy ? 'yes' : 'no'} />
            {data.policy.promotionId && <KV label="Promotion" value={data.policy.promotionId} mono />}
          </Section>
        </div>
      </div>

      {/* Timeline */}
      <Section title="Event Timeline">
        {data.timeline.length === 0 ? (
          <div className="text-xs text-gray-600">No events</div>
        ) : (
          <div className="space-y-1">
            {data.timeline.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="text-gray-600 w-16 shrink-0 text-right">{timeAgo(ev.timestamp)}</span>
                <span className={`badge ${sourceBadgeClass(ev.source)}`}>{ev.source}</span>
                <span className="text-gray-300">{ev.kind}</span>
                <span className="text-gray-500 truncate">{ev.detail}</span>
                {ev.actor && <span className="text-gray-600 font-mono">{ev.actor}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

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
