/**
 * DecisionDialog — Confirm a decision action with mandatory reason.
 *
 * Shows the action being taken, evidence fingerprint for context,
 * and requires a reason before submission.
 */

import { useState } from 'react';
import { ActionDialog } from './ActionDialog';
import type { DecisionAction } from '../../lib/types';

interface DecisionDialogProps {
  open: boolean;
  queueItemId: string;
  action: DecisionAction | null;
  evidenceFingerprint: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
  error?: string | null;
}

const ACTION_META: Record<DecisionAction, { label: string; description: string; color: string }> = {
  'approve': {
    label: 'Approve',
    description: 'Approve this item for forward motion.',
    color: 'bg-green-600 hover:bg-green-500',
  },
  'reject': {
    label: 'Reject',
    description: 'Reject this item. No forward motion.',
    color: 'bg-red-600 hover:bg-red-500',
  },
  'request-recovery': {
    label: 'Request Recovery',
    description: 'Escalate to recovery path for remediation.',
    color: 'bg-amber-600 hover:bg-amber-500',
  },
  'needs-review': {
    label: 'Needs Review',
    description: 'Return to review for deeper inspection.',
    color: 'bg-blue-600 hover:bg-blue-500',
  },
};

export function DecisionDialog({
  open, queueItemId, action, evidenceFingerprint,
  onClose, onConfirm, submitting, error,
}: DecisionDialogProps) {
  const [reason, setReason] = useState('');

  if (!action) return null;

  const meta = ACTION_META[action];
  const canSubmit = reason.trim().length > 0;

  return (
    <ActionDialog
      title={`Decision: ${meta.label}`}
      open={open}
      onClose={onClose}
      onSubmit={() => {
        if (canSubmit) onConfirm(reason);
      }}
      submitting={submitting || !canSubmit}
      error={error}
      submitLabel={meta.label}
      submitColor={meta.color}
    >
      <p className="text-xs text-gray-400">{meta.description}</p>
      <p className="text-xs text-gray-400">
        Item: <span className="font-mono text-gray-300">{queueItemId.slice(0, 12)}</span>
      </p>
      <div className="text-xs text-gray-500 bg-surface-900 rounded px-2 py-1">
        Evidence fingerprint: <span className="font-mono text-gray-400">{evidenceFingerprint.slice(0, 16)}...</span>
      </div>
      <input
        type="text"
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-surface-900 border border-surface-600 rounded px-2 py-1.5 text-xs text-gray-300 placeholder-gray-600"
        autoFocus
      />
    </ActionDialog>
  );
}
