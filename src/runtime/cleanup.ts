import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { StopReason } from './types.js';

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
