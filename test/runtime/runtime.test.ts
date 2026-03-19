import { describe, it, expect } from 'vitest';
import { getToolProfile, ROLE_TOOL_PROFILES } from '../../src/runtime/tool-profiles.js';
import { reconcileOutput } from '../../src/runtime/reconcile.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

describe('Tool Profiles', () => {
  it('builder has full tool access', () => {
    const tools = getToolProfile('builder');
    expect(tools).toContain('Read');
    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Bash');
  });

  it('verifier-checklist has no Write/Edit', () => {
    const tools = getToolProfile('verifier-checklist');
    expect(tools).toContain('Read');
    expect(tools).toContain('Bash');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('verifier-analysis has no Write/Edit', () => {
    const tools = getToolProfile('verifier-analysis');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('knowledge has no Bash', () => {
    const tools = getToolProfile('knowledge');
    expect(tools).toContain('Write');
    expect(tools).not.toContain('Bash');
  });

  it('docs has no Bash', () => {
    const tools = getToolProfile('docs');
    expect(tools).toContain('Write');
    expect(tools).not.toContain('Bash');
  });

  it('unknown role falls back to builder', () => {
    const tools = getToolProfile('unknown-role');
    expect(tools).toEqual(ROLE_TOOL_PROFILES['builder']!.tools);
  });

  it('all defined roles have tools', () => {
    for (const [role, profile] of Object.entries(ROLE_TOOL_PROFILES)) {
      expect(profile.tools.length).toBeGreaterThan(0);
      expect(profile.role).toBe(role);
    }
  });
});

describe('Diff Reconciliation', () => {
  const testDir = join(tmpdir(), `mc-reconcile-test-${Date.now()}`);
  const worktreePath = join(testDir, 'worktree');
  const outputDir = join(testDir, 'output');

  function setupGitWorktree() {
    mkdirSync(worktreePath, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    execSync('git init', { cwd: worktreePath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: worktreePath, stdio: 'pipe' });
    execSync('git config user.name "test"', { cwd: worktreePath, stdio: 'pipe' });
    writeFileSync(join(worktreePath, 'existing.ts'), 'export const x = 1;');
    execSync('git add -A && git commit -m "init"', { cwd: worktreePath, stdio: 'pipe' });
  }

  function teardown() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  it('passes when manifest matches actual diff', () => {
    setupGitWorktree();
    try {
      // Create a new file (untracked)
      writeFileSync(join(worktreePath, 'new-file.ts'), 'export const y = 2;');
      // Modify existing file
      writeFileSync(join(worktreePath, 'existing.ts'), 'export const x = 42;');

      // Write matching manifest
      writeFileSync(join(outputDir, 'artifacts.json'), JSON.stringify({
        files_created: ['new-file.ts'],
        files_modified: ['existing.ts'],
        files_deleted: [],
        test_files: [],
      }));

      const result = reconcileOutput(worktreePath, outputDir, [], []);
      expect(result.pass).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      teardown();
    }
  });

  it('fails when undeclared files are changed', () => {
    setupGitWorktree();
    try {
      writeFileSync(join(worktreePath, 'new-file.ts'), 'export const y = 2;');
      writeFileSync(join(worktreePath, 'sneaky.ts'), 'export const z = 3;');

      // Only declare one of two new files
      writeFileSync(join(outputDir, 'artifacts.json'), JSON.stringify({
        files_created: ['new-file.ts'],
        files_modified: [],
        files_deleted: [],
        test_files: [],
      }));

      const result = reconcileOutput(worktreePath, outputDir, [], []);
      expect(result.pass).toBe(false);
      expect(result.undeclaredFiles).toContain('sneaky.ts');
    } finally {
      teardown();
    }
  });

  it('fails when forbidden files are touched', () => {
    setupGitWorktree();
    try {
      writeFileSync(join(worktreePath, 'forbidden.ts'), 'bad');

      writeFileSync(join(outputDir, 'artifacts.json'), JSON.stringify({
        files_created: ['forbidden.ts'],
        files_modified: [],
        files_deleted: [],
        test_files: [],
      }));

      const result = reconcileOutput(worktreePath, outputDir, [], ['forbidden.ts']);
      expect(result.pass).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden'))).toBe(true);
    } finally {
      teardown();
    }
  });

  it('returns error when no artifacts.json exists', () => {
    mkdirSync(outputDir, { recursive: true });
    try {
      const result = reconcileOutput('/tmp/nonexistent', outputDir, [], []);
      expect(result.pass).toBe(false);
      expect(result.errors[0]).toContain('No artifacts.json');
    } finally {
      teardown();
    }
  });

  it('warns about files outside allowed scope', () => {
    setupGitWorktree();
    try {
      writeFileSync(join(worktreePath, 'outside.ts'), 'out of scope');

      writeFileSync(join(outputDir, 'artifacts.json'), JSON.stringify({
        files_created: ['outside.ts'],
        files_modified: [],
        files_deleted: [],
        test_files: [],
      }));

      const result = reconcileOutput(worktreePath, outputDir, ['src/allowed.ts'], []);
      expect(result.warnings.some(w => w.includes('outside allowed scope'))).toBe(true);
    } finally {
      teardown();
    }
  });
});
