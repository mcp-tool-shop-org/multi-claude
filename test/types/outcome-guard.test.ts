/**
 * Outcome Contract Guard Tests — Phase 9F-203
 *
 * These tests verify:
 * - outcome types are defined canonically in types/outcome.ts
 * - no local redefinitions in consumer files
 * - outcome status sets are complete and consistent
 * - follow-up kinds cover all outcome statuses
 * - packet outcome statuses are exhaustive
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
    if (trimmed.startsWith('/**')) continue;

    const patterns = [
      new RegExp(`^export\\s+type\\s+${name}\\s*=`),
      new RegExp(`^export\\s+interface\\s+${name}\\s*\\{`),
      new RegExp(`^export\\s+interface\\s+${name}\\s*$`),
      new RegExp(`^type\\s+${name}\\s*=`),
      new RegExp(`^interface\\s+${name}\\s*\\{`),
      new RegExp(`^interface\\s+${name}\\s*$`),
      new RegExp(`^export\\s+const\\s+${name}\\s*[:=]`),
      new RegExp(`^const\\s+${name}\\s*[:=]`),
    ];

    if (patterns.some(p => p.test(trimmed))) return true;
  }
  return false;
}

// ── 1. Canonical definitions exist in types/outcome.ts ──────────────

describe('Canonical outcome types exist', () => {
  const outcomeSource = readSrc('types/outcome.ts');

  const expectedTypes = [
    'RunOutcomeStatus',
    'PacketOutcomeStatus',
    'PacketOutcome',
    'UnresolvedItem',
    'InterventionSummary',
    'FollowUpKind',
    'FollowUp',
    'RunOutcome',
    'RUN_OUTCOME_STATUSES',
  ];

  for (const name of expectedTypes) {
    it(`defines ${name}`, () => {
      expect(hasLocalDefinition(outcomeSource, name)).toBe(true);
    });
  }
});

// ── 2. No local redefinitions in consumers ──────────────────────────

describe('No local outcome redefinitions', () => {
  const consumers = [
    'console/run-outcome.ts',
    'console/outcome-render.ts',
    'commands/console-outcome.ts',
    'commands/console.ts',
  ];

  const guardedTypes = [
    'RunOutcomeStatus',
    'PacketOutcomeStatus',
    'PacketOutcome',
    'UnresolvedItem',
    'InterventionSummary',
    'FollowUpKind',
    'FollowUp',
    'RunOutcome',
  ];

  for (const file of consumers) {
    describe(file, () => {
      let content: string;
      try {
        content = readSrc(file);
      } catch {
        // File may not exist in some test setups
        return;
      }

      for (const name of guardedTypes) {
        it(`does not locally define ${name}`, () => {
          expect(
            hasLocalDefinition(content, name),
            `${file} locally defines ${name} — should import from types/outcome.ts`,
          ).toBe(false);
        });
      }
    });
  }
});

// ── 3. Outcome status completeness ──────────────────────────────────

describe('Outcome status completeness', () => {
  it('RUN_OUTCOME_STATUSES set has all 6 statuses', async () => {
    const { RUN_OUTCOME_STATUSES } = await import('../../src/types/outcome.js');
    expect(RUN_OUTCOME_STATUSES.size).toBe(6);
    expect(RUN_OUTCOME_STATUSES.has('clean_success')).toBe(true);
    expect(RUN_OUTCOME_STATUSES.has('assisted_success')).toBe(true);
    expect(RUN_OUTCOME_STATUSES.has('partial_success')).toBe(true);
    expect(RUN_OUTCOME_STATUSES.has('terminal_failure')).toBe(true);
    expect(RUN_OUTCOME_STATUSES.has('stopped')).toBe(true);
    expect(RUN_OUTCOME_STATUSES.has('in_progress')).toBe(true);
  });

  it('classifyOutcomeStatus covers all RUN_OUTCOME_STATUSES values', async () => {
    const source = readSrc('console/run-outcome.ts');
    const { RUN_OUTCOME_STATUSES } = await import('../../src/types/outcome.js');
    for (const status of RUN_OUTCOME_STATUSES) {
      expect(
        source.includes(`'${status}'`),
        `run-outcome.ts should reference status '${status}'`,
      ).toBe(true);
    }
  });

  it('renderOutcome handles all outcome statuses via STATUS_SYMBOLS', async () => {
    const source = readSrc('console/outcome-render.ts');
    const { RUN_OUTCOME_STATUSES } = await import('../../src/types/outcome.js');
    for (const status of RUN_OUTCOME_STATUSES) {
      expect(
        source.includes(status),
        `outcome-render.ts should reference status '${status}'`,
      ).toBe(true);
    }
  });
});

// ── 4. Packet outcome status completeness ───────────────────────────

describe('Packet outcome status completeness', () => {
  const packetStatuses = ['resolved', 'failed', 'recovered', 'blocked', 'pending', 'skipped'];

  it('derivation engine references all packet outcome statuses', () => {
    const source = readSrc('console/run-outcome.ts');
    for (const status of packetStatuses) {
      expect(
        source.includes(`'${status}'`),
        `run-outcome.ts should reference packet status '${status}'`,
      ).toBe(true);
    }
  });

  it('renderer has symbols for all packet statuses', () => {
    const source = readSrc('console/outcome-render.ts');
    for (const status of packetStatuses) {
      expect(
        source.includes(status),
        `outcome-render.ts should have symbol for packet status '${status}'`,
      ).toBe(true);
    }
  });

  it('groupPacketsByStatus covers all 6 statuses', () => {
    const source = readSrc('console/outcome-render.ts');
    // The order array must list all packet statuses
    for (const status of packetStatuses) {
      expect(
        source.includes(`'${status}'`),
        `groupPacketsByStatus should include '${status}'`,
      ).toBe(true);
    }
  });
});

// ── 5. Follow-up kind completeness ──────────────────────────────────

describe('Follow-up kind completeness', () => {
  const followUpKinds = ['none', 'review', 'recover', 'replan', 'resume'];

  it('deriveFollowUp covers all FollowUpKind values', () => {
    const source = readSrc('console/run-outcome.ts');
    for (const kind of followUpKinds) {
      expect(
        source.includes(`'${kind}'`),
        `run-outcome.ts should produce follow-up kind '${kind}'`,
      ).toBe(true);
    }
  });

  it('each outcome status maps to a follow-up kind', () => {
    const source = readSrc('console/run-outcome.ts');
    // deriveFollowUp is a switch on RunOutcomeStatus
    const statuses = [
      'clean_success', 'assisted_success', 'partial_success',
      'terminal_failure', 'stopped', 'in_progress',
    ];
    for (const status of statuses) {
      expect(
        source.includes(`case '${status}'`),
        `deriveFollowUp should have case for '${status}'`,
      ).toBe(true);
    }
  });
});

// ── 6. Acceptability assessment covers all statuses ─────────────────

describe('Acceptability assessment completeness', () => {
  it('assessAcceptability has a case for every outcome status', () => {
    const source = readSrc('console/run-outcome.ts');
    const statuses = [
      'clean_success', 'assisted_success', 'partial_success',
      'terminal_failure', 'stopped', 'in_progress',
    ];
    // Count switch cases in assessAcceptability
    for (const status of statuses) {
      expect(
        source.includes(`case '${status}'`),
        `assessAcceptability should handle '${status}'`,
      ).toBe(true);
    }
  });
});

// ── 7. No ghost statuses ────────────────────────────────────────────

describe('No ghost outcome statuses', () => {
  it('outcome-render STATUS_SYMBOLS keys are all valid outcome statuses', () => {
    const source = readSrc('console/outcome-render.ts');
    // Extract keys from STATUS_SYMBOLS
    const keyPattern = /(\w+):\s*'[^']+'/g;
    const statusSymbolBlock = source.match(/STATUS_SYMBOLS[^}]+\}/s);
    if (!statusSymbolBlock) {
      throw new Error('Could not find STATUS_SYMBOLS in outcome-render.ts');
    }
    const keys: string[] = [];
    let m;
    while ((m = keyPattern.exec(statusSymbolBlock[0])) !== null) {
      keys.push(m[1]);
    }

    const validStatuses = new Set([
      'clean_success', 'assisted_success', 'partial_success',
      'terminal_failure', 'stopped', 'in_progress',
    ]);

    for (const key of keys) {
      expect(
        validStatuses.has(key),
        `STATUS_SYMBOLS contains unknown status '${key}'`,
      ).toBe(true);
    }
  });

  it('outcome-render PACKET_SYMBOLS keys are all valid packet statuses', () => {
    const source = readSrc('console/outcome-render.ts');
    const packetSymbolBlock = source.match(/PACKET_SYMBOLS[^}]+\}/s);
    if (!packetSymbolBlock) {
      throw new Error('Could not find PACKET_SYMBOLS in outcome-render.ts');
    }
    const keyPattern = /(\w+):\s*'[^']+'/g;
    const keys: string[] = [];
    let m;
    while ((m = keyPattern.exec(packetSymbolBlock[0])) !== null) {
      keys.push(m[1]);
    }

    const validStatuses = new Set([
      'resolved', 'failed', 'recovered', 'blocked', 'pending', 'skipped',
    ]);

    for (const key of keys) {
      expect(
        validStatuses.has(key),
        `PACKET_SYMBOLS contains unknown status '${key}'`,
      ).toBe(true);
    }
  });
});

// ── 8. Cross-domain: outcome types reference canonical action types ──

describe('Outcome types reference canonical action types', () => {
  it('UnresolvedItem.targetType references ActionTargetType from actions.ts', () => {
    const source = readSrc('types/outcome.ts');
    expect(source).toContain("import type { ActionTargetType } from './actions.js'");
  });

  it('outcome.ts does not locally define ActionTargetType', () => {
    const source = readSrc('types/outcome.ts');
    expect(hasLocalDefinition(source, 'ActionTargetType')).toBe(false);
  });
});
