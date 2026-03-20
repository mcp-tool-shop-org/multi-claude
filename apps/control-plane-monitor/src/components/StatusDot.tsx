import type { HealthState } from '../lib/types';

const dotColors: Record<HealthState, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-amber-500',
  critical: 'bg-red-500',
};

export function StatusDot({ state }: { state: HealthState }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${dotColors[state]}`}
      title={state}
    />
  );
}

export function HealthBadge({ state }: { state: HealthState }) {
  const colors: Record<HealthState, string> = {
    healthy: 'badge-green',
    degraded: 'badge-amber',
    critical: 'badge-red',
  };
  return <span className={`badge ${colors[state]}`}>{state}</span>;
}
