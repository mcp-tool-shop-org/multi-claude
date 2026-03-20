/**
 * ActionToast — Inline feedback for completed operator actions.
 */

import { useEffect } from 'react';
import type { MonitorCommandResponse } from '../../lib/types';

interface ActionToastProps {
  result: MonitorCommandResponse | null;
  error: string | null;
  onDismiss: () => void;
}

export function ActionToast({ result, error, onDismiss }: ActionToastProps) {
  useEffect(() => {
    if (result || error) {
      const timer = setTimeout(onDismiss, 4000);
      return () => clearTimeout(timer);
    }
  }, [result, error, onDismiss]);

  if (!result && !error) return null;

  const isSuccess = result?.ok;
  const message = isSuccess
    ? `${result!.action} succeeded on ${result!.queueItemId.slice(0, 8)}`
    : error ?? result?.error?.message ?? 'Action failed';

  return (
    <div className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded text-xs shadow-lg border ${
      isSuccess
        ? 'bg-green-900/80 border-green-700 text-green-200'
        : 'bg-red-900/80 border-red-700 text-red-200'
    }`}>
      {message}
    </div>
  );
}
