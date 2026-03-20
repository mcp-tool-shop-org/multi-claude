/**
 * DeferDialog — Defer with reason and optional until timestamp.
 */

import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

interface DeferDialogProps {
  open: boolean;
  queueItemId: string;
  onClose: () => void;
  onConfirm: (reason: string, until?: string) => void;
  submitting: boolean;
  error?: string | null;
}

const DEFER_PRESETS = [
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
];

export function DeferDialog({ open, queueItemId, onClose, onConfirm, submitting, error }: DeferDialogProps) {
  const [reason, setReason] = useState('');
  const [selectedPreset, setSelectedPreset] = useState(0);

  const canSubmit = reason.trim().length > 0;

  return (
    <ActionDialog
      title="Defer Item"
      open={open}
      onClose={onClose}
      onSubmit={() => {
        if (!canSubmit) return;
        const until = new Date(Date.now() + DEFER_PRESETS[selectedPreset]!.ms).toISOString();
        onConfirm(reason, until);
      }}
      submitting={submitting || !canSubmit}
      error={error}
      submitLabel="Defer"
      submitColor="bg-gray-600 hover:bg-gray-500"
    >
      <p className="text-xs text-gray-400">
        Defer <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span>.
        Claim stays active but item is excluded from next-item.
      </p>
      <div className="flex gap-1">
        {DEFER_PRESETS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => setSelectedPreset(i)}
            className={`px-2 py-1 text-xs rounded border ${
              selectedPreset === i
                ? 'border-blue-500 bg-blue-900/30 text-blue-300'
                : 'border-surface-600 text-gray-500 hover:text-gray-300'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600"
      />
    </ActionDialog>
  );
}
