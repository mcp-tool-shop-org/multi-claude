/**
 * ReleaseDialog — Release claim with optional reason.
 */

import { useState } from 'react';
import { ActionDialog } from './ActionDialog';

interface ReleaseDialogProps {
  open: boolean;
  queueItemId: string;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
  submitting: boolean;
  error?: string | null;
}

export function ReleaseDialog({ open, queueItemId, onClose, onConfirm, submitting, error }: ReleaseDialogProps) {
  const [reason, setReason] = useState('');

  return (
    <ActionDialog
      title="Release Claim"
      open={open}
      onClose={onClose}
      onSubmit={() => onConfirm(reason || undefined)}
      submitting={submitting}
      error={error}
      submitLabel="Release"
      submitColor="bg-amber-600 hover:bg-amber-500"
    >
      <p className="text-xs text-gray-400">
        Release your claim on <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span>.
        The item returns to pending.
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
