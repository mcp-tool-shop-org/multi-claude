import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import type { StopReason } from './types.js';
import { completeEnvelopeOnExit } from './envelope.js';

/**
 * Cleanup policy by outcome:
 * - completed → cleanup worktree (code already merged)
 * - failed → preserve worktree + output for diagnosis
 * - timed_out → preserve evidence
 * - stopped → preserve evidence
 * - malformed_output → preserve output dir + diff for diagnosis
 */
export function cleanupWorkerArtifacts(
  repoRoot: string,
  packetId: string,
  stopReason: StopReason,
): { cleaned: boolean; preserved: string[] } {
  const branchName = `multi-claude/${packetId}`;
  const worktreePath = `${repoRoot}/.multi-claude/worktrees/${packetId}`;
  const preserved: string[] = [];

  if (stopReason === 'completed') {
    // Success: clean up worktree and branch
    if (existsSync(worktreePath)) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot, stdio: 'pipe' });
      } catch { /* ignore */ }
    }
    try {
      execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' });
    } catch { /* ignore */ }
    return { cleaned: true, preserved: [] };
  }

  // All failure modes: preserve evidence
  if (existsSync(worktreePath)) {
    preserved.push(worktreePath);
  }

  const outputDir = `${repoRoot}/.multi-claude/workers/${packetId}`;
  if (existsSync(outputDir)) {
    preserved.push(outputDir);
  }

  return { cleaned: false, preserved };
}

/**
 * Unified cleanup entry point for the orchestrator.
 * Handles worktree/branch cleanup AND envelope finalization in one call.
 */
export function cleanupOnStop(
  repoRoot: string,
  packetId: string,
  stopReason: StopReason,
  dbPath: string,
  sessionId?: string,
): { cleaned: boolean; preserved: string[]; envelopeCompleted: boolean } {
  const { cleaned, preserved } = cleanupWorkerArtifacts(repoRoot, packetId, stopReason);

  let envelopeCompleted = false;
  if (sessionId) {
    const result = completeEnvelopeOnExit(dbPath, sessionId, stopReason);
    envelopeCompleted = result.ok;
  }

  return { cleaned, preserved, envelopeCompleted };
}

/**
 * Scans worktree directory for orphans not matching any known packet.
 * Reports only — does NOT delete (deletion is an operator decision).
 */
export function cleanupOrphanWorktrees(
  repoRoot: string,
  knownPacketIds: string[],
): { orphans: string[]; total: number } {
  const worktreeDir = `${repoRoot}/.multi-claude/worktrees`;

  if (!existsSync(worktreeDir)) {
    return { orphans: [], total: 0 };
  }

  const entries = readdirSync(worktreeDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  const knownSet = new Set(knownPacketIds);
  const orphans = dirs.filter(name => !knownSet.has(name));

  return { orphans, total: dirs.length };
}
