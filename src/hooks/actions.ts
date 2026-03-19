/** Actions the policy engine can produce */
export type HookAction =
  | 'stay_single'
  | 'launch_workers'
  | 'launch_verifier'
  | 'launch_docs'
  | 'retry_once'
  | 'pause_human_gate'
  | 'resume_integration'
  | 'surface_blocker'
  | 'escalate';

export interface HookDecision {
  action: HookAction;
  packets: string[];
  role: string;
  model: string;
  playbookId: string;
  reason: string;
  requiresHumanApproval: boolean;
  contextBundle: {
    include: string[];
    exclude: string[];
  };
}

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
  const MODEL_MAP: Record<string, string> = {
    architect: 'claude-opus-4-6',
    integrator: 'claude-opus-4-6',
    builder: 'claude-sonnet-4-6',
    'verifier-checklist': 'claude-haiku-4-5',
    'verifier-analysis': 'claude-sonnet-4-6',
    knowledge: 'claude-haiku-4-5',
    docs: 'claude-haiku-4-5',
  };

  return {
    action,
    packets,
    role,
    model: MODEL_MAP[role] ?? 'claude-sonnet-4-6',
    playbookId: `${role}-playbook`,
    reason,
    requiresHumanApproval: false,
    contextBundle: DEFAULT_CONTEXT_BUNDLE,
    ...overrides,
  };
}
