/**
 * Recovery Contract Guard Tests — Phase 9E-203
 *
 * These tests verify:
 * - recovery scenarios are a finite, complete set
 * - executable steps map only to canonical operator actions
 * - no local recovery type redefinitions
 * - scenario catalog covers all severity levels
 * - recovery types reference only canonical action types
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve('src');

function readSrc(relPath: string): string {
  return readFileSync(resolve(SRC, relPath), 'utf-8');
}

// ── Helper: detect local definitions ────────────────────────────────

function hasLocalDefinition(content: string, name: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ')) continue;
    if (trimmed.startsWith('export type {')) continue;
    if (trimmed.startsWith('export { ')) continue;
    if (trimmed.includes('from \'')) continue;
    if (trimmed.includes('from "')) continue;
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (trimmed.startsWith('/*')) continue;

    const patterns = [
      new RegExp(`^export\\s+type\\s+${name}\\s*=`),
      new RegExp(`^export\\s+interface\\s+${name}\\s*\\{`),
      new RegExp(`^export\\s+const\\s+${name}\\s*[=:]`),
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

// ── Canonical recovery type existence ───────────────────────────────

describe('Recovery type contract (types/recovery.ts)', () => {
  const canonical = readSrc('types/recovery.ts');

  it('defines all expected recovery types', () => {
    expect(hasLocalDefinition(canonical, 'RecoveryScenarioId')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RECOVERY_SCENARIOS')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoverySeverity')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryStepKind')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryStep')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryBlocker')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryTerminalCondition')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryPlan')).toBe(true);
    expect(hasLocalDefinition(canonical, 'NoRecoveryNeeded')).toBe(true);
    expect(hasLocalDefinition(canonical, 'RecoveryResult')).toBe(true);
  });
});

// ── No local redefinition in consumers ──────────────────────────────

describe('No local recovery type redefinitions', () => {
  const consumers = [
    'console/recovery-catalog.ts',
    'console/recovery-plan.ts',
    'console/recovery-render.ts',
    'commands/console-recover.ts',
  ];

  const recoveryTypes = [
    'RecoveryPlan',
    'RecoveryStep',
    'RecoveryBlocker',
    'RecoveryScenarioId',
    'RecoverySeverity',
    'RecoveryStepKind',
    'RecoveryTerminalCondition',
    'NoRecoveryNeeded',
    'RecoveryResult',
  ];

  for (const consumer of consumers) {
    for (const name of recoveryTypes) {
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

// ── Scenario catalog completeness ───────────────────────────────────

describe('Recovery scenario catalog completeness', () => {
  it('RECOVERY_SCENARIOS set matches all scenario IDs in catalog', async () => {
    const { RECOVERY_SCENARIOS } = await import('../../src/types/recovery.js');
    const catalogContent = readSrc('console/recovery-catalog.ts');

    // Find all scenario string literals used in catalog
    const scenarioPattern = /scenario:\s*'(\w+)'/g;
    const usedScenarios = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = scenarioPattern.exec(catalogContent)) !== null) {
      usedScenarios.add(match[1]);
    }

    // Every catalog scenario must be in canonical set
    for (const s of usedScenarios) {
      expect(RECOVERY_SCENARIOS.has(s)).toBe(true);
    }

    // Every canonical scenario must be used in catalog
    for (const s of RECOVERY_SCENARIOS) {
      expect(usedScenarios.has(s)).toBe(true);
    }
  });

  it('all scenario IDs are handled in the derivation engine switch', async () => {
    const { RECOVERY_SCENARIOS } = await import('../../src/types/recovery.js');
    const planContent = readSrc('console/recovery-plan.ts');

    // Find all case values in the buildPlan switch
    const casePattern = /case\s+'(\w+)':/g;
    const handledCases = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = casePattern.exec(planContent)) !== null) {
      handledCases.add(match[1]);
    }

    for (const s of RECOVERY_SCENARIOS) {
      expect(handledCases.has(s)).toBe(true);
    }
  });
});

// ── Action mapping integrity ────────────────────────────────────────

describe('Recovery action mapping integrity', () => {
  it('executable steps only reference canonical operator actions', async () => {
    const { OPERATOR_ACTIONS } = await import('../../src/types/actions.js');
    const planContent = readSrc('console/recovery-plan.ts');

    // Find all action: 'xxx' assignments in recovery steps
    const actionPattern = /action:\s*'(\w+)'/g;
    const usedActions = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = actionPattern.exec(planContent)) !== null) {
      usedActions.add(match[1]);
    }

    for (const a of usedActions) {
      expect(OPERATOR_ACTIONS.has(a)).toBe(true);
    }
  });

  it('recovery types import from canonical types/actions.ts', () => {
    const recoveryTypes = readSrc('types/recovery.ts');
    expect(recoveryTypes).toContain("from './actions.js'");
  });

  it('recovery catalog imports ActionAvailability from canonical', () => {
    const catalog = readSrc('console/recovery-catalog.ts');
    expect(catalog).toContain("from '../types/actions.js'");
  });

  it('recovery plan imports canonical types', () => {
    const plan = readSrc('console/recovery-plan.ts');
    expect(plan).toContain("from '../types/actions.js'");
    expect(plan).toContain("from '../types/recovery.js'");
  });
});

// ── Severity coverage ───────────────────────────────────────────────

describe('Recovery severity coverage', () => {
  it('catalog assigns all three severity levels', () => {
    const catalogContent = readSrc('console/recovery-catalog.ts');

    expect(catalogContent).toContain("severity: 'critical'");
    expect(catalogContent).toContain("severity: 'actionable'");
    expect(catalogContent).toContain("severity: 'waiting'");
  });
});
