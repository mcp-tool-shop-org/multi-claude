/**
 * ActionDialog — Shared modal shell for operator action dialogs.
 *
 * Renders as an overlay with card styling. All action-specific
 * dialogs compose this for consistent look and behavior.
 */

import { useEffect, useRef } from 'react';

interface ActionDialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error?: string | null;
  children: React.ReactNode;
  submitLabel?: string;
  submitColor?: string;
}

export function ActionDialog({
  title,
  open,
  onClose,
  onSubmit,
  submitting,
  error,
  children,
  submitLabel = 'Confirm',
  submitColor = 'bg-blue-600 hover:bg-blue-500',
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="card w-96 max-w-[90vw] shadow-xl border border-surface-600"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <h3 className="text-sm font-medium text-gray-200 mb-3">{title}</h3>

        <div className="space-y-3">
          {children}
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-900/20 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded border border-surface-600"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className={`px-3 py-1.5 text-xs text-white rounded ${submitColor} disabled:opacity-50`}
          >
            {submitting ? 'Submitting...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
