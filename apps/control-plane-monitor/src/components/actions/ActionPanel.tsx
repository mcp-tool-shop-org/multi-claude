/**
 * ActionPanel — Renders eligible operator action buttons for an item.
 *
 * Used in ItemDetailPage for the full action surface.
 * Shows disabled buttons with reason tooltips for ineligible actions.
 */

import type { ActionEligibility, OperatorAction } from '../../lib/types';

interface ActionPanelProps {
  actions: ActionEligibility;
  onAction: (action: OperatorAction) => void;
  pending: boolean;
}

const ACTION_CONFIG: Array<{
  action: OperatorAction;
  label: string;
  color: string;
  disabledColor: string;
}> = [
  { action: 'claim', label: 'Claim', color: 'bg-blue-600 hover:bg-blue-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  { action: 'release', label: 'Release', color: 'bg-amber-600 hover:bg-amber-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  { action: 'defer', label: 'Defer', color: 'bg-gray-600 hover:bg-gray-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  { action: 'requeue', label: 'Requeue', color: 'bg-purple-600 hover:bg-purple-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
  { action: 'escalate', label: 'Escalate', color: 'bg-red-600 hover:bg-red-500 text-white', disabledColor: 'bg-surface-700 text-gray-600' },
];

export function ActionPanel({ actions, onAction, pending }: ActionPanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {ACTION_CONFIG.map(({ action, label, color, disabledColor }) => {
          const entry = actions[action];
          const disabled = !entry.allowed || pending;

          return (
            <div key={action} className="relative group">
              <button
                onClick={() => onAction(action)}
                disabled={disabled}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  disabled ? disabledColor : color
                } disabled:cursor-not-allowed`}
              >
                {label}
              </button>
              {!entry.allowed && entry.reason && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-gray-300 bg-surface-900 border border-surface-600 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  {entry.reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
