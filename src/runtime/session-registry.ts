/**
 * Session Registry — tracks live worker sessions for external stop control.
 *
 * The registry is in-memory only (lives for the duration of the auto run process).
 * It maps (runId, packetId) → WorkerSessionHandle so that:
 *   - CLI stop commands can target a specific live session
 *   - Timeout cleanup can abort specific sessions
 *   - Evidence is preserved on stop
 */

import type { WorkerSessionHandle } from './types.js';

interface RegisteredSession {
  handle: WorkerSessionHandle;
  runId: string;
  packetId: string;
  registeredAt: string;
}

const registry = new Map<string, RegisteredSession>();

function key(runId: string, packetId: string): string {
  return `${runId}::${packetId}`;
}

/** Register a live session handle */
export function registerSession(runId: string, handle: WorkerSessionHandle): void {
  registry.set(key(runId, handle.packetId), {
    handle,
    runId,
    packetId: handle.packetId,
    registeredAt: new Date().toISOString(),
  });
}

/** Unregister a session (after completion or cleanup) */
export function unregisterSession(runId: string, packetId: string): void {
  registry.delete(key(runId, packetId));
}

/** Get a live session handle */
export function getSession(runId: string, packetId: string): WorkerSessionHandle | null {
  return registry.get(key(runId, packetId))?.handle ?? null;
}

/** Stop a specific live session */
export function stopSession(runId: string, packetId: string): { stopped: boolean; wasRegistered: boolean } {
  const entry = registry.get(key(runId, packetId));
  if (!entry) {
    return { stopped: false, wasRegistered: false };
  }
  entry.handle.abort();
  return { stopped: true, wasRegistered: true };
}

/** Stop all sessions for a run */
export function stopAllSessions(runId: string): { stoppedCount: number } {
  let count = 0;
  for (const [, entry] of registry) {
    if (entry.runId === runId) {
      entry.handle.abort();
      count++;
    }
  }
  return { stoppedCount: count };
}

/** List all active sessions */
export function listActiveSessions(): Array<{ runId: string; packetId: string; registeredAt: string }> {
  return Array.from(registry.values()).map(s => ({
    runId: s.runId,
    packetId: s.packetId,
    registeredAt: s.registeredAt,
  }));
}

/** Get registry size */
export function registrySize(): number {
  return registry.size;
}
