/**
 * EscalateDialog — Escalate to higher review with reason.
 */

import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

interface EscalateDialogProps {
  open: boolean;
  queueItemId: string;
  onClose: () => void;
  onConfirm: (reason: string, target?: string) => void;
  submitting: boolean;
  error?: string | null;
}

export function EscalateDialog({ open, queueItemId, onClose, onConfirm, submitting, error }: EscalateDialogProps) {
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState('');

  const canSubmit = reason.trim().length > 0;

  return (
    <ActionDialog
      title="Escalate Item"
      open={open}
      onClose={onClose}
      onSubmit={() => {
        if (!canSubmit) return;
        onConfirm(reason, target || undefined);
      }}
      submitting={submitting || !canSubmit}
      error={error}
      submitLabel="Escalate"
      submitColor="bg-red-600 hover:bg-red-500"
    >
      <p className="text-xs text-gray-400">
        Escalate <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span> to higher review.
      </p>
      <input
        type="text"
        placeholder="Escalation target (optional)"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600"
      />
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
