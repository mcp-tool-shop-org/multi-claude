/**
 * Decision Action Hook — Phase 13C.
 *
 * Thin mutation hook for decision intents.
 * Calls /api/monitor/queue/:id/decide → surfaces result → triggers refetch.
 */

import { useState, useCallback } from 'react';
import { decideItem } from '../lib/api/command-client';
import type { DecisionCommandResponse, DecisionAction } from '../lib/types';

const DEFAULT_OPERATOR = 'monitor-operator';

export interface DecisionState {
  pending: boolean;
  lastResult: DecisionCommandResponse | null;
  lastError: string | null;
}

export interface UseDecisionResult {
  state: DecisionState;
  decide: (queueItemId: string, action: DecisionAction, reason: string) => Promise<DecisionCommandResponse>;
  clearResult: () => void;
}

export function useDecision(
  operatorId: string = DEFAULT_OPERATOR,
  onSuccess?: () => void,
): UseDecisionResult {
  const [state, setState] = useState<DecisionState>({
    pending: false,
    lastResult: null,
    lastError: null,
  });

  const decide = useCallback(async (
    queueItemId: string,
    action: DecisionAction,
    reason: string,
  ): Promise<DecisionCommandResponse> => {
    setState({ pending: true, lastResult: null, lastError: null });
    try {
      const result = await decideItem(queueItemId, operatorId, action, reason);
      setState({
        pending: false,
        lastResult: result,
        lastError: result.ok ? null : (result.error?.message ?? 'Decision failed'),
      });
      if (result.ok && onSuccess) onSuccess();
      return result;
    } catch (err) {
      const msg = String(err);
      setState({ pending: false, lastResult: null, lastError: msg });
      return { ok: false, action, queueItemId, error: { code: 'network', message: msg } };
    }
  }, [operatorId, onSuccess]);

  const clearResult = useCallback(() => {
    setState({ pending: false, lastResult: null, lastError: null });
  }, []);

  return { state, decide, clearResult };
}
