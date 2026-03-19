import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactManifest } from '../schema/submission.js';

export interface ReconciliationResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
  actualFiles: { created: string[]; modified: string[]; deleted: string[] };
  declaredFiles: { created: string[]; modified: string[]; deleted: string[] };
  undeclaredFiles: string[];
  missingDeclaredFiles: string[];
}

/** Get actual changed files from git diff in worktree */
function getActualDiff(worktreePath: string): { created: string[]; modified: string[]; deleted: string[] } {
  try {
    // Untracked files = created
    const untrackedRaw = execSync('git ls-files --others --exclude-standard', {
      cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const created = untrackedRaw ? untrackedRaw.split('\n').filter(f => f.length > 0) : [];

    // Modified tracked files
    const modifiedRaw = execSync('git diff --name-only', {
      cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const modified = modifiedRaw ? modifiedRaw.split('\n').filter(f => f.length > 0) : [];

    // Staged changes
    const stagedRaw = execSync('git diff --cached --name-only', {
      cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const staged = stagedRaw ? stagedRaw.split('\n').filter(f => f.length > 0) : [];

    // Deleted files from diff
    const deletedRaw = execSync('git diff --name-only --diff-filter=D', {
      cwd: worktreePath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const deleted = deletedRaw ? deletedRaw.split('\n').filter(f => f.length > 0) : [];

    // Merge modified + staged, dedup
    const allModified = [...new Set([...modified, ...staged])].filter(f => !deleted.includes(f));

    return { created, modified: allModified, deleted };
  } catch {
    return { created: [], modified: [], deleted: [] };
  }
}

/** Reconcile declared manifest against actual worktree diff */
export function reconcileOutput(
  worktreePath: string,
  outputDir: string,
  allowedFiles: string[],
  forbiddenFiles: string[],
): ReconciliationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Read declared manifest
  const artifactsPath = join(outputDir, 'artifacts.json');
  if (!existsSync(artifactsPath)) {
    return {
      pass: false, errors: ['No artifacts.json found'], warnings: [],
      actualFiles: { created: [], modified: [], deleted: [] },
      declaredFiles: { created: [], modified: [], deleted: [] },
      undeclaredFiles: [], missingDeclaredFiles: [],
    };
  }

  let manifest: ArtifactManifest;
  try {
    manifest = JSON.parse(readFileSync(artifactsPath, 'utf-8'));
  } catch {
    return {
      pass: false, errors: ['Invalid JSON in artifacts.json'], warnings: [],
      actualFiles: { created: [], modified: [], deleted: [] },
      declaredFiles: { created: [], modified: [], deleted: [] },
      undeclaredFiles: [], missingDeclaredFiles: [],
    };
  }

  // 2. Get actual diff
  const actual = getActualDiff(worktreePath);

  // 3. Compare declared vs actual
  const allDeclared = [...manifest.files_created, ...manifest.files_modified, ...manifest.files_deleted];
  const allActual = [...actual.created, ...actual.modified, ...actual.deleted];

  // Normalize paths for comparison
  const normalize = (f: string) => f.replace(/\\/g, '/').replace(/^\.\//, '');
  const declaredSet = new Set(allDeclared.map(normalize));
  const actualSet = new Set(allActual.map(normalize));

  // Filter out non-source files from actual (e.g. lock files, build artifacts)
  const ignoredPatterns = ['node_modules/', 'dist/', 'target/', '.tsbuildinfo', 'pnpm-lock.yaml', 'Cargo.lock', '.multi-claude/'];
  const filteredActual = [...actualSet].filter(f => !ignoredPatterns.some(p => f.includes(p)));
  const filteredActualSet = new Set(filteredActual);

  // Undeclared: in actual but not in declared
  const undeclaredFiles = filteredActual.filter(f => !declaredSet.has(f));

  // Missing: in declared but not in actual
  const missingDeclaredFiles = [...declaredSet].filter(f => !filteredActualSet.has(f));

  if (undeclaredFiles.length > 0) {
    errors.push(`Undeclared file changes: ${undeclaredFiles.join(', ')}`);
  }

  if (missingDeclaredFiles.length > 0) {
    warnings.push(`Declared but not found in diff: ${missingDeclaredFiles.join(', ')}`);
  }

  // 4. Check forbidden files in actual diff
  for (const file of filteredActual) {
    if (forbiddenFiles.some(f => normalize(f) === file || file.startsWith(normalize(f)))) {
      errors.push(`Forbidden file touched: ${file}`);
    }
  }

  // 5. Check allowed files scope (if allowed_files is non-empty, everything must be within it)
  if (allowedFiles.length > 0) {
    const allowedSet = new Set(allowedFiles.map(normalize));
    for (const file of filteredActual) {
      if (!allowedSet.has(file)) {
        // Check if it's a test file or closely related
        const isTestFile = file.includes('.test.') || file.includes('__tests__');
        if (isTestFile) {
          // Tests in the same module family are allowed
          continue;
        }
        warnings.push(`File outside allowed scope: ${file}`);
      }
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    actualFiles: actual,
    declaredFiles: { created: manifest.files_created, modified: manifest.files_modified, deleted: manifest.files_deleted },
    undeclaredFiles,
    missingDeclaredFiles,
  };
}
