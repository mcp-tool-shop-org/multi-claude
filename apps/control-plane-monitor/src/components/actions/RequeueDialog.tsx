/**
 * RequeueDialog — Requeue deferred/escalated item back to pending.
 */

import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

interface RequeueDialogProps {
  open: boolean;
  queueItemId: string;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  submitting: boolean;
  error?: string | null;
}

export function RequeueDialog({ open, queueItemId, onClose, onConfirm, submitting, error }: RequeueDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <ActionDialog
      title="Requeue Item"
      open={open}
      onClose={onClose}
      onSubmit={() => onConfirm(reason || undefined)}
      submitting={submitting}
      error={error}
      submitLabel="Requeue"
      submitColor="bg-purple-600 hover:bg-purple-500"
    >
      <p className="text-xs text-gray-400">
        Return <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span> to pending.
        Creates a fresh claim opportunity.
      </p>
      <input
        type="text"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600"
      />
    </ActionDialog>
  );
}
