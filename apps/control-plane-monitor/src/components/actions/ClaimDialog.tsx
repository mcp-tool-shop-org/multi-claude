/**
 * ClaimDialog — Confirm claim on a queue item.
 */

import { ActionDialog } from './ActionDialog';

interface ClaimDialogProps {
  open: boolean;
  queueItemId: string;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  error?: string | null;
}

export function ClaimDialog({ open, queueItemId, onClose, onConfirm, submitting, error }: ClaimDialogProps) {
  return (
    <ActionDialog
      title="Claim Item"
      open={open}
      onClose={onClose}
      onSubmit={onConfirm}
      submitting={submitting}
      error={error}
      submitLabel="Claim"
    >
      <p className="text-xs text-gray-400">
        Take a lease on <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span>.
        You will be the active reviewer until the lease expires or you release it.
      </p>
    </ActionDialog>
  );
}
