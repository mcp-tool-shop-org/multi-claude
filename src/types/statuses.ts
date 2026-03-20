/**
 * Canonical status types and role-model mapping.
 *
 * ALL consumers must import from here — no local redefinition.
 * See Phase 9D contract: docs/trials/9D-000-CONTRACT-FREEZE.md
 */

// ── Run statuses ────────────────────────────────────────────────────

export type RunStatus =
  | 'planned'
  | 'running'
  | 'paused'
  | 'completing'
  | 'complete'
  | 'failed'
  | 'stopped';

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'complete', 'failed', 'stopped',
]);

export function isTerminalRunStatus(status: string): status is RunStatus {
  return TERMINAL_RUN_STATUSES.has(status as RunStatus);
}

// ── Worker statuses ─────────────────────────────────────────────────

export type WorkerStatus =
  | 'pending'
  | 'launching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'retrying';

export const TERMINAL_WORKER_STATUSES: ReadonlySet<WorkerStatus> = new Set([
  'completed', 'failed', 'timed_out',
]);

// ── Operator decision statuses ──────────────────────────────────────

export type OperatorDecision = 'pending' | 'confirmed' | 'rejected' | 'auto';

// ── Worker outcome (from StopReason → run-level outcome) ────────────

export type WorkerOutcome = 'complete' | 'error' | 'timeout';

// ── Resolved dependency statuses ────────────────────────────────────
// Canonical set: a hard dependency is resolved if the upstream packet
// is in one of these states. Used by wave computation, worklist,
// next-action, and packet graph rendering.

export const RESOLVED_PACKET_STATUSES: ReadonlySet<string> = new Set([
  'verified', 'integrating', 'merged',
]);

// ── Role → Model canonical map ──────────────────────────────────────

export const ROLE_MODEL_MAP: Readonly<Record<string, string>> = {
  coordinator: 'claude-opus-4-6',
  architect: 'claude-opus-4-6',
  integrator: 'claude-opus-4-6',
  builder: 'claude-sonnet-4-6',
  'verifier-checklist': 'claude-haiku-4-5',
  'verifier-analysis': 'claude-sonnet-4-6',
  knowledge: 'claude-haiku-4-5',
  sweep: 'claude-haiku-4-5',
  docs: 'claude-haiku-4-5',
};

export function getModelForRole(role: string): string {
  return ROLE_MODEL_MAP[role] ?? 'claude-sonnet-4-6';
}
