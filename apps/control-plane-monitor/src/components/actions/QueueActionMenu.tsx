/**
 * QueueActionMenu — Compact action menu for queue table rows.
 *
 * Shows only eligible actions as a small inline button group.
 */

import type { ActionEligibility, OperatorAction } from '../../lib/types';

interface QueueActionMenuProps {
  actions: ActionEligibility;
  onAction: (action: OperatorAction) => void;
  pending: boolean;
}

const QUICK_ACTIONS: Array<{ action: OperatorAction; label: string; color: string }> = [
  { action: 'claim', label: 'Claim', color: 'text-blue-400 hover:text-blue-300' },
  { action: 'release', label: 'Release', color: 'text-amber-400 hover:text-amber-300' },
  { action: 'requeue', label: 'Requeue', color: 'text-purple-400 hover:text-purple-300' },
  { action: 'escalate', label: 'Escalate', color: 'text-red-400 hover:text-red-300' },
];

export function QueueActionMenu({ actions, onAction, pending }: QueueActionMenuProps) {
  const eligible = QUICK_ACTIONS.filter(({ action }) => actions[action].allowed);

  if (eligible.length === 0) return <span className="text-gray-700">—</span>;

  return (
    <span className="flex gap-1">
      {eligible.map(({ action, label, color }) => (
        <button
          key={action}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAction(action);
          }}
          disabled={pending}
          className={`text-xs ${color} disabled:opacity-50`}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
