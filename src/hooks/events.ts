/** Hook events emitted by CLI commands */
export type HookEvent =
  | 'feature.approved'
  | 'packet.ready'
  | 'packet.claimed'
  | 'packet.verified'
  | 'packet.failed'
  | 'wave.claimable'
  | 'wave.empty'
  | 'integration.ready'
  | 'approval.recorded'
  | 'queue.stalled';

export interface HookEventPayload {
  event: HookEvent;
  entityType: 'feature' | 'packet' | 'wave' | 'approval' | 'run';
  entityId: string;
  featureId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
