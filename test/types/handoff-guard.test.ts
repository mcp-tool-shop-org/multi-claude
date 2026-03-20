/**
 * Handoff Contract Guard Tests — Phase 10A-203
 *
 * Structurally traps the same bug class as 9D-301 / 9E-203:
 *   - canonical handoff types exist and are imported
 *   - no local redefinition in consumer files
 *   - verdict catalog completeness
 *   - readiness logic cannot mark review-ready when blocker exists
 *   - outcome/readiness/handoff verdict relationships remain legal
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, 'src', relPath), 'utf-8');
}

/**
 * Detect local type/interface/const definitions that should come from canonical.
 */
function hasLocalDefinition(source: string, name: string): boolean {
  // Match: export type Name =, export interface Name {, type Name =, interface Name {, const Name =
  const patterns = [
    new RegExp(`^\\s*export\\s+type\\s+${name}\\s*=`, 'm'),
    new RegExp(`^\\s*export\\s+interface\\s+${name}\\s*\\{`, 'm'),
    new RegExp(`^\\s*type\\s+${name}\\s*=`, 'm'),
    new RegExp(`^\\s*interface\\s+${name}\\s*\\{`, 'm'),
    new RegExp(`^\\s*export\\s+const\\s+${name}\\s*[:=]`, 'm'),
  ];
  return patterns.some(p => p.test(source));
}

// ── Canonical definitions exist ──────────────────────────────────

describe('Canonical handoff types', () => {
  const handoffSrc = readSrc('types/handoff.ts');

  const expectedTypes = [
    'HandoffVerdict', 'ReviewReadiness', 'ReadinessBlocker', 'ReadinessNote',
    'ContributionSummary', 'ChangeSummary', 'OutstandingIssue',
    'HandoffFollowUp', 'InterventionDigest', 'InterventionEvent',
    'EvidenceReference', 'RunHandoff',
  ];

  for (const typeName of expectedTypes) {
    it(`defines ${typeName}`, () => {
      expect(hasLocalDefinition(handoffSrc, typeName)).toBe(true);
    });
  }

  it('defines HANDOFF_VERDICTS set', () => {
    expect(handoffSrc).toContain('HANDOFF_VERDICTS');
  });
});

// ── No local redefinition in consumers ──────────────────────────

describe('No local redefinition of handoff types', () => {
  const consumers = [
    'console/handoff-readiness.ts',
    'console/run-handoff.ts',
    'console/handoff-render.ts',
    'commands/console-handoff.ts',
  ];

  const guardedTypes = [
    'HandoffVerdict', 'ReviewReadiness', 'ReadinessBlocker', 'ReadinessNote',
    'ContributionSummary', 'OutstandingIssue', 'HandoffFollowUp',
    'InterventionDigest', 'EvidenceReference', 'RunHandoff',
  ];

  for (const consumer of consumers) {
    for (const typeName of guardedTypes) {
      it(`${consumer} does not locally define ${typeName}`, () => {
        const source = readSrc(consumer);
        expect(hasLocalDefinition(source, typeName)).toBe(false);
      });
    }
  }
});

// ── Verdict catalog completeness ────────────────────────────────

describe('Verdict catalog completeness', async () => {
  const { HANDOFF_VERDICTS } = await import('../../src/types/handoff.js');

  const expectedVerdicts = [
    'review_ready', 'review_ready_with_notes', 'not_review_ready',
    'incomplete', 'blocked',
  ];

  for (const v of expectedVerdicts) {
    it(`HANDOFF_VERDICTS includes "${v}"`, () => {
      expect(HANDOFF_VERDICTS.has(v as any)).toBe(true);
    });
  }

  it('has exactly the expected number of verdicts', () => {
    expect(HANDOFF_VERDICTS.size).toBe(expectedVerdicts.length);
  });
});

// ── Readiness logic constraints ─────────────────────────────────

describe('Readiness logic constraints', async () => {
  const { assessReadiness } = await import('../../src/console/handoff-readiness.js');

  function makeContrib(overrides: Partial<import('../../src/types/handoff.js').ContributionSummary> = {}): import('../../src/types/handoff.js').ContributionSummary {
    return {
      packetId: 'pkt-1',
      title: 'Test packet',
      role: 'builder',
      layer: 'backend',
      wave: 1,
      status: 'resolved',
      attempts: 1,
      wasRetried: false,
      wasRecovered: false,
      hadIntervention: false,
      contributesToResult: true,
      changedFiles: null,
      ...overrides,
    };
  }

  function makeInterventions(occurred = false): import('../../src/types/handoff.js').InterventionDigest {
    return {
      occurred,
      summary: { totalActions: occurred ? 1 : 0, retries: occurred ? 1 : 0, stops: 0, resumes: 0, gateApprovals: 0, hookResolutions: 0 },
      significantActions: [],
    };
  }

  it('cannot mark review_ready when blocker exists (failed packet)', () => {
    const result = assessReadiness({
      outcomeStatus: 'partial_success',
      acceptable: false,
      contributions: [
        makeContrib({ status: 'resolved' }),
        makeContrib({ packetId: 'pkt-2', status: 'failed', contributesToResult: false }),
      ],
      outstandingIssues: [{
        id: 'issue-0', severity: 'critical', kind: 'failed_packet',
        description: 'pkt-2 failed', blocksReview: true, recommendedAction: null,
      }],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).not.toBe('review_ready');
    expect(result.verdict).not.toBe('review_ready_with_notes');
    expect(result.ready).toBe(false);
  });

  it('cannot mark review_ready when blocker exists (pending hook)', () => {
    const result = assessReadiness({
      outcomeStatus: 'clean_success',
      acceptable: true,
      contributions: [makeContrib()],
      outstandingIssues: [{
        id: 'issue-0', severity: 'warning', kind: 'pending_hook',
        description: 'hook pending', blocksReview: true, recommendedAction: null,
      }],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).not.toBe('review_ready');
    expect(result.ready).toBe(false);
  });

  it('marks review_ready for clean acceptable run', () => {
    const result = assessReadiness({
      outcomeStatus: 'clean_success',
      acceptable: true,
      contributions: [makeContrib()],
      outstandingIssues: [],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('review_ready');
    expect(result.ready).toBe(true);
  });

  it('marks review_ready_with_notes when intervention occurred', () => {
    const result = assessReadiness({
      outcomeStatus: 'assisted_success',
      acceptable: true,
      contributions: [makeContrib()],
      outstandingIssues: [],
      interventions: makeInterventions(true),
    });

    expect(result.verdict).toBe('review_ready_with_notes');
    expect(result.ready).toBe(true);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('marks review_ready_with_notes when recovery occurred', () => {
    const result = assessReadiness({
      outcomeStatus: 'assisted_success',
      acceptable: true,
      contributions: [makeContrib({ wasRecovered: true })],
      outstandingIssues: [],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('review_ready_with_notes');
    expect(result.ready).toBe(true);
  });

  it('marks incomplete for in_progress run', () => {
    const result = assessReadiness({
      outcomeStatus: 'in_progress',
      acceptable: false,
      contributions: [],
      outstandingIssues: [],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('incomplete');
    expect(result.ready).toBe(false);
  });

  it('marks incomplete for stopped run', () => {
    const result = assessReadiness({
      outcomeStatus: 'stopped',
      acceptable: false,
      contributions: [],
      outstandingIssues: [],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('incomplete');
    expect(result.ready).toBe(false);
  });

  it('marks not_review_ready for terminal_failure', () => {
    const result = assessReadiness({
      outcomeStatus: 'terminal_failure',
      acceptable: false,
      contributions: [makeContrib({ status: 'failed', contributesToResult: false })],
      outstandingIssues: [{
        id: 'issue-0', severity: 'critical', kind: 'failed_packet',
        description: 'all failed', blocksReview: true, recommendedAction: null,
      }],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('not_review_ready');
    expect(result.ready).toBe(false);
  });

  it('marks blocked when acceptable but gate open', () => {
    const result = assessReadiness({
      outcomeStatus: 'clean_success',
      acceptable: true,
      contributions: [makeContrib()],
      outstandingIssues: [{
        id: 'issue-0', severity: 'warning', kind: 'unresolved_gate',
        description: 'gate open', blocksReview: true, recommendedAction: null,
      }],
      interventions: makeInterventions(false),
    });

    expect(result.verdict).toBe('blocked');
    expect(result.ready).toBe(false);
  });
});

// ── Cross-domain relationships ──────────────────────────────────

describe('Handoff imports from canonical sources', () => {
  it('handoff-readiness imports from types/handoff', () => {
    const src = readSrc('console/handoff-readiness.ts');
    expect(src).toContain("from '../types/handoff.js'");
  });

  it('run-handoff imports from types/handoff', () => {
    const src = readSrc('console/run-handoff.ts');
    expect(src).toContain("from '../types/handoff.js'");
  });

  it('run-handoff imports outcome types from canonical', () => {
    const src = readSrc('console/run-handoff.ts');
    expect(src).toContain("from '../types/outcome.js'");
  });

  it('run-handoff imports action types from canonical', () => {
    const src = readSrc('console/run-handoff.ts');
    expect(src).toContain("from '../types/actions.js'");
  });

  it('handoff-readiness imports outcome types from canonical', () => {
    const src = readSrc('console/handoff-readiness.ts');
    expect(src).toContain("from '../types/outcome.js'");
  });
});
