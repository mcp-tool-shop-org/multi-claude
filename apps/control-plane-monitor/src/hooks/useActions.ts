/**
 * Operator Action Hooks — Phase 13B.
 *
 * Thin mutation hooks for operator intents.
 * Call command endpoint → surface result/error → trigger refetch.
 */

import { useState, useCallback } from 'react';
import * as commands from '../lib/api/command-client';
import type { MonitorCommandResponse, OperatorAction } from '../lib/types';

/** Default operator ID — simple local identity for 13B */
const DEFAULT_OPERATOR = 'monitor-operator';

export interface ActionState {
  pending: boolean;
  lastResult: MonitorCommandResponse | null;
  lastError: string | null;
}

export interface UseActionsResult {
  state: ActionState;
  claim: (queueItemId: string) => Promise<MonitorCommandResponse>;
  release: (queueItemId: string, reason?: string) => Promise<MonitorCommandResponse>;
  defer: (queueItemId: string, reason: string, until?: string) => Promise<MonitorCommandResponse>;
  requeue: (queueItemId: string, reason?: string) => Promise<MonitorCommandResponse>;
  escalate: (queueItemId: string, reason: string, target?: string) => Promise<MonitorCommandResponse>;
  clearResult: () => void;
}

export function useActions(
  operatorId: string = DEFAULT_OPERATOR,
  onSuccess?: () => void,
): UseActionsResult {
  const [state, setState] = useState<ActionState>({
    pending: false,
    lastResult: null,
    lastError: null,
  });

  const execute = useCallback(async (
    action: OperatorAction,
    fn: () => Promise<MonitorCommandResponse>,
  ): Promise<MonitorCommandResponse> => {
    setState({ pending: true, lastResult: null, lastError: null });
    try {
      const result = await fn();
      setState({ pending: false, lastResult: result, lastError: result.ok ? null : (result.error?.message ?? 'Unknown error') });
      if (result.ok && onSuccess) onSuccess();
      return result;
    } catch (err) {
      const msg = String(err);
      setState({ pending: false, lastResult: null, lastError: msg });
      return { ok: false, action, queueItemId: '', error: { code: 'network', message: msg } };
    }
  }, [onSuccess]);

  const claim = useCallback((queueItemId: string) =>
    execute('claim', () => commands.claimItem(queueItemId, operatorId)),
  [execute, operatorId]);

  const release = useCallback((queueItemId: string, reason?: string) =>
    execute('release', () => commands.releaseItem(queueItemId, operatorId, reason)),
  [execute, operatorId]);

  const defer = useCallback((queueItemId: string, reason: string, until?: string) =>
    execute('defer', () => commands.deferItem(queueItemId, operatorId, reason, until)),
  [execute, operatorId]);

  const requeue = useCallback((queueItemId: string, reason?: string) =>
    execute('requeue', () => commands.requeueItem(queueItemId, operatorId, reason)),
  [execute, operatorId]);

  const escalate = useCallback((queueItemId: string, reason: string, target?: string) =>
    execute('escalate', () => commands.escalateItem(queueItemId, operatorId, reason, target)),
  [execute, operatorId]);

  const clearResult = useCallback(() => {
    setState({ pending: false, lastResult: null, lastError: null });
  }, []);

  return { state, claim, release, defer, requeue, escalate, clearResult };
}
