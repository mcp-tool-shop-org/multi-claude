export interface McfSuccess<T = unknown> {
  ok: true;
  command: string;
  result: T;
  transitions: StateTransitionRecord[];
}

export interface McfError {
  ok: false;
  command: string;
  error_code: string;
  message: string;
  context: Record<string, unknown>;
}

export type McfResult<T = unknown> = McfSuccess<T> | McfError;

export interface StateTransitionRecord {
  entity_type: EntityType;
  entity_id: string;
  from_state: string | null;
  to_state: string;
}

export type EntityType =
  | 'feature'
  | 'packet'
  | 'claim'
  | 'submission'
  | 'verification_result'
  | 'amendment'
  | 'contract_delta'
  | 'integration_run'
  | 'knowledge_promotion';

export type FeatureStatus =
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'verifying'
  | 'complete'
  | 'abandoned'
  | 'superseded';

export type PacketStatus =
  | 'draft'
  | 'ready'
  | 'claimed'
  | 'in_progress'
  | 'submitted'
  | 'verifying'
  | 'verified'
  | 'integrating'
  | 'merged'
  | 'blocked'
  | 'failed'
  | 'abandoned'
  | 'superseded';

export type PacketLayer =
  | 'contract'
  | 'backend'
  | 'state'
  | 'ui'
  | 'integration'
  | 'docs'
  | 'test';

export type PacketRole =
  | 'builder'
  | 'verifier'
  | 'integrator'
  | 'coordinator'
  | 'architect'
  | 'knowledge'
  | 'sweep';

export type DependencyType = 'hard' | 'soft';

export type RuleProfile = 'builder' | 'integration' | 'contract' | 'docs';

export type Priority = 'critical' | 'high' | 'normal' | 'low';

export type ApprovalScopeType =
  | 'feature'
  | 'packet'
  | 'packet_graph'
  | 'contract_delta'
  | 'integration_run'
  | 'amendment'
  | 'law_amendment'
  | 'exception';

export type ApprovalType =
  | 'feature_approval'
  | 'packet_graph_approval'
  | 'protected_file_change'
  | 'contract_delta_approval'
  | 'merge_approval'
  | 'amendment_approval'
  | 'law_amendment'
  | 'exception';

export type ApprovalDecision = 'approved' | 'rejected' | 'approved_with_conditions';

export type ActorType =
  | 'coordinator'
  | 'architect'
  | 'builder'
  | 'verifier'
  | 'integrator'
  | 'knowledge'
  | 'sweep'
  | 'human'
  | 'system';
