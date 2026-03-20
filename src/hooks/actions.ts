import { getModelForRole } from '../types/statuses.js';

/**
 * Hook action types — re-exported from canonical types/actions.ts.
 * Import from here or from '../types/actions.js' — both are valid.
 */
export type { HookAction, HookDecision } from '../types/actions.js';
import type { HookAction, HookDecision } from '../types/actions.js';

/** Default context bundle — minimal worker context */
export const DEFAULT_CONTEXT_BUNDLE = {
  include: [
    'rendered_packet',
    'playbook',
    'allowed_files',
    'forbidden_files',
    'reference_files',
    'output_schema',
    'verification_requirements',
  ],
  exclude: [
    'full_repo_history',
    'phase_transcript',
    'operator_scratchpad',
    'other_worker_outputs',
    'pipeline_state',
    'queue_position',
  ],
};

export function makeDecision(
  action: HookAction,
  packets: string[],
  role: string,
  reason: string,
  overrides?: Partial<HookDecision>,
): HookDecision {
  return {
    action,
    packets,
    role,
    model: getModelForRole(role),
    playbookId: `${role}-playbook`,
    reason,
    requiresHumanApproval: false,
    contextBundle: DEFAULT_CONTEXT_BUNDLE,
    ...overrides,
  };
}
