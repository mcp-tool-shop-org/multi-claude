/**
 * Handoff Spine — Fallback evidence.
 *
 * Every fallback from spine rendering to legacy rendering
 * MUST leave structured evidence answering:
 *   - Why did spine derivation/rendering fail?
 *   - Which path was used instead?
 *   - Should the fallback run be treated as equivalent or degraded?
 *
 * Without this, the fallback becomes a secret second system.
 */

export type FallbackReason =
  | 'bridge_failed'
  | 'spine_render_failed'
  | 'handoff_create_failed'
  | 'all_versions_invalidated'
  | 'no_prior_handoff';

export type FallbackPath = 'legacy_render' | 'fresh_spine_render';

export interface FallbackEvidence {
  /** When the fallback was triggered */
  timestamp: string;
  /** Execution DB packet ID that triggered the fallback */
  packetId: string;
  /** Run ID */
  runId: string;
  /** Why spine path failed */
  reason: FallbackReason;
  /** Human-readable detail */
  detail: string;
  /** What path was used instead */
  fallbackPath: FallbackPath;
  /** Is this run equivalent to a spine-rendered run, or degraded? */
  equivalence: 'equivalent' | 'degraded';
  /** Handoff ID that was attempted (if available) */
  attemptedHandoffId?: string;
  /** Version that was attempted (if available) */
  attemptedVersion?: number;
}

/**
 * Create a fallback evidence record.
 */
export function createFallbackEvidence(
  packetId: string,
  runId: string,
  reason: FallbackReason,
  detail: string,
  fallbackPath: FallbackPath = 'legacy_render',
  opts?: {
    attemptedHandoffId?: string;
    attemptedVersion?: number;
  },
): FallbackEvidence {
  return {
    timestamp: new Date().toISOString(),
    packetId,
    runId,
    reason,
    detail,
    fallbackPath,
    // Legacy render produces equivalent content but without audit trail
    equivalence: fallbackPath === 'legacy_render' ? 'degraded' : 'equivalent',
    attemptedHandoffId: opts?.attemptedHandoffId,
    attemptedVersion: opts?.attemptedVersion,
  };
}
