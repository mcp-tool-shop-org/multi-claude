/**
 * Contract Guard Tests — Phase 9D-301
 *
 * These tests detect local redefinition of canonical types.
 * If any consumer file defines its own version of a type that
 * should come from types/statuses.ts or types/actions.ts,
 * these tests fail.
 *
 * Purpose: prevent the repeated semantic drift bug class
 * identified in Phase 8B and confirmed in 9C (ActionResult duplication).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

// ── Helper: detect local type/interface/const definitions ───────────

/**
 * Returns true if the file defines a given name as a type, interface,
 * const, or function — excluding re-exports and imports.
 */
function hasLocalDefinition(content: string, name: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip imports and re-exports
    if (trimmed.startsWith('import ')) continue;
    if (trimmed.startsWith('export type {')) continue;
    if (trimmed.startsWith('export { ')) continue;
    if (trimmed.includes('from \'')) continue;
    if (trimmed.includes('from "')) continue;

    // Skip comments
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (trimmed.startsWith('/*')) continue;
    if (trimmed.startsWith('/**')) continue;

    // Check for local definition patterns
    const patterns = [
      new RegExp(`^export\\s+type\\s+${name}\\s*=`),
      new RegExp(`^export\\s+interface\\s+${name}\\s*\\{`),
      new RegExp(`^export\\s+interface\\s+${name}\\s*$`),
      new RegExp(`^export\\s+const\\s+${name}\\s*[=:]`),
      new RegExp(`^export\\s+function\\s+${name}\\s*\\(`),
      new RegExp(`^type\\s+${name}\\s*=`),
      new RegExp(`^interface\\s+${name}\\s*\\{`),
      new RegExp(`^const\\s+${name}\\s*[=:]`),
    ];

    for (const pat of patterns) {
      if (pat.test(trimmed)) return true;
    }
  }
  return false;
}

// ── Status contract guards ──────────────────────────────────────────

describe('Status contract (types/statuses.ts)', () => {
  const canonicalFile = 'types/statuses.ts';
  const canonicalContent = readSrc(canonicalFile);

  // Verify the canonical file actually defines these
  it('canonical file defines all expected status types', () => {
    expect(hasLocalDefinition(canonicalContent, 'RunStatus')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'WorkerStatus')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'OperatorDecision')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'WorkerOutcome')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'TERMINAL_RUN_STATUSES')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'TERMINAL_WORKER_STATUSES')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'RESOLVED_PACKET_STATUSES')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'ROLE_MODEL_MAP')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'getModelForRole')).toBe(true);
  });

  // Consumer files that MUST NOT redefine status types
  const statusConsumers = [
    'console/action-availability.ts',
    'console/action-executor.ts',
    'console/next-action.ts',
    'console/render.ts',
    'console/run-model.ts',
    'hooks/actions.ts',
    'hooks/engine.ts',
    'hooks/policy.ts',
    'commands/auto.ts',
  ];

  const statusNames = [
    'TERMINAL_RUN_STATUSES',
    'RESOLVED_PACKET_STATUSES',
    'ROLE_MODEL_MAP',
    'getModelForRole',
  ];

  for (const consumer of statusConsumers) {
    for (const name of statusNames) {
      it(`${consumer} must not locally define ${name}`, () => {
        let content: string;
        try {
          content = readSrc(consumer);
        } catch {
          // File doesn't exist yet — not a violation
          return;
        }
        expect(hasLocalDefinition(content, name)).toBe(false);
      });
    }
  }
});

// ── Action contract guards ──────────────────────────────────────────

describe('Action contract (types/actions.ts)', () => {
  const canonicalFile = 'types/actions.ts';
  const canonicalContent = readSrc(canonicalFile);

  // Verify the canonical file actually defines these
  it('canonical file defines all expected action types', () => {
    expect(hasLocalDefinition(canonicalContent, 'OperatorAction')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'HookAction')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'HookEvent')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'ActionTargetType')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'Precondition')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'ActionAvailability')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'ActionResult')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'NextAction')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'HookDecision')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'HookDecisionLog')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'AuditEntry')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'OPERATOR_ACTIONS')).toBe(true);
    expect(hasLocalDefinition(canonicalContent, 'HOOK_ACTIONS')).toBe(true);
  });

  // Consumer files that MUST NOT redefine action types
  const actionConsumers = [
    'console/action-availability.ts',
    'console/action-executor.ts',
    'console/next-action.ts',
    'console/audit-trail.ts',
    'hooks/actions.ts',
    'hooks/events.ts',
    'hooks/engine.ts',
    'commands/console-actions.ts',
  ];

  const actionTypeNames = [
    'HookAction',
    'HookDecision',
    'HookDecisionLog',
    'Precondition',
    'ActionAvailability',
    'ActionResult',
    'NextAction',
    'AuditEntry',
    'HookEventPayload',
  ];

  for (const consumer of actionConsumers) {
    for (const name of actionTypeNames) {
      it(`${consumer} must not locally define ${name}`, () => {
        let content: string;
        try {
          content = readSrc(consumer);
        } catch {
          return;
        }
        expect(hasLocalDefinition(content, name)).toBe(false);
      });
    }
  }
});

// ── Catalog completeness guards ─────────────────────────────────────

describe('Catalog completeness', () => {
  it('OPERATOR_ACTIONS matches executor switch cases', async () => {
    const executorContent = readSrc('console/action-executor.ts');
    const casePattern = /case\s+'(\w+)':/g;
    const cases = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = casePattern.exec(executorContent)) !== null) {
      cases.add(match[1]);
    }

    // Import canonical set
    const { OPERATOR_ACTIONS } = await import('../../src/types/actions.js');

    // Every switch case must be in the canonical set
    for (const c of cases) {
      expect(OPERATOR_ACTIONS.has(c)).toBe(true);
    }
    // Every canonical action must appear as a switch case
    for (const a of OPERATOR_ACTIONS) {
      expect(cases.has(a)).toBe(true);
    }
  });

  it('HOOK_ACTIONS matches policy rule actions', async () => {
    const policyContent = readSrc('hooks/policy.ts');
    // Find all makeDecision calls with their first argument
    const makeDecisionPattern = /makeDecision\(\s*'(\w+)'/g;
    const usedActions = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = makeDecisionPattern.exec(policyContent)) !== null) {
      usedActions.add(match[1]);
    }

    const { HOOK_ACTIONS } = await import('../../src/types/actions.js');

    // Every policy-used action must be in the canonical set
    for (const a of usedActions) {
      expect(HOOK_ACTIONS.has(a)).toBe(true);
    }
  });

  it('ActionAvailability targetType uses only canonical ActionTargetType values', () => {
    const availContent = readSrc('console/action-availability.ts');
    // Find all targetType assignments
    const targetTypePattern = /targetType:\s*'(\w+)'/g;
    const usedTypes = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = targetTypePattern.exec(availContent)) !== null) {
      usedTypes.add(match[1]);
    }

    const validTypes = new Set(['run', 'packet', 'gate', 'hook_decision']);
    for (const t of usedTypes) {
      expect(validTypes.has(t)).toBe(true);
    }
  });
});

// ── Cross-domain separation guards ──────────────────────────────────

describe('Status domain separation', () => {
  it('render.ts does not use WorkerStatus "completed" for packet dependency checks', () => {
    const renderContent = readSrc('console/render.ts');
    // The bug was: d.status !== 'completed' — completed is a worker status
    // The fix: !RESOLVED_PACKET_STATUSES.has(d.status)
    // Guard: 'completed' should not appear in dependency-checking context
    const lines = renderContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('dependencies') || line.includes('blockers')) {
        // Within 5 lines of dependency context, 'completed' should not be a status check
        for (let j = i; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].includes("'completed'") && lines[j].includes('status')) {
            expect.fail(
              `render.ts:${j + 1} uses WorkerStatus 'completed' in packet dependency context. ` +
              `Use RESOLVED_PACKET_STATUSES instead.`
            );
          }
        }
      }
    }
  });

  it('RESOLVED_PACKET_STATUSES does not include worker-only statuses', async () => {
    const { RESOLVED_PACKET_STATUSES } = await import('../../src/types/statuses.js');
    const workerOnly = ['completed', 'timed_out', 'retrying', 'launching'];
    for (const ws of workerOnly) {
      expect(RESOLVED_PACKET_STATUSES.has(ws)).toBe(false);
    }
  });

  it('TERMINAL_RUN_STATUSES does not include ghost statuses', async () => {
    const { TERMINAL_RUN_STATUSES } = await import('../../src/types/statuses.js');
    // 'cancelled' was a ghost status that appeared in action-availability.ts
    // but was never produced by any code
    expect(TERMINAL_RUN_STATUSES.has('cancelled')).toBe(false);
  });
});
