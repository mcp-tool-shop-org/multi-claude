/**
 * Approval Contract Guard Tests — Phase 10B-203
 *
 * Structurally traps:
 *   - canonical approval types exist and are imported
 *   - no local redefinition in consumer files
 *   - catalog completeness for eligibility, status, decisions, invalidation reasons
 *   - no ghost states
 *   - cross-domain imports correct
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(join(ROOT, 'src', relPath), 'utf-8');
}

function hasLocalDefinition(source: string, name: string): boolean {
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

describe('Canonical approval types', () => {
  const approvalSrc = readSrc('types/approval.ts');

  const expectedTypes = [
    'PromotionEligibility', 'ApprovalStatus', 'PromotionBlocker',
    'PromotionCheckResult', 'ApprovalBinding', 'ApprovalRecord',
    'InvalidationReason', 'ApprovalInvalidation', 'PromotionDecision',
  ];

  for (const typeName of expectedTypes) {
    it(`defines ${typeName}`, () => {
      expect(hasLocalDefinition(approvalSrc, typeName)).toBe(true);
    });
  }

  const expectedSets = [
    'PROMOTION_ELIGIBILITIES', 'APPROVAL_STATUSES',
    'INVALIDATION_REASONS', 'PROMOTION_DECISIONS',
  ];

  for (const setName of expectedSets) {
    it(`defines ${setName} set`, () => {
      expect(approvalSrc).toContain(setName);
    });
  }
});

// ── No local redefinition in consumers ──────────────────────────

describe('No local redefinition of approval types', () => {
  const consumers = [
    'console/promotion-check.ts',
    'console/approval-invalidation.ts',
    'console/approval-store.ts',
    'console/approval-executor.ts',
    'console/approval-render.ts',
    'commands/console-approval.ts',
  ];

  const guardedTypes = [
    'PromotionEligibility', 'ApprovalStatus', 'PromotionBlocker',
    'PromotionCheckResult', 'ApprovalBinding', 'ApprovalRecord',
    'InvalidationReason', 'ApprovalInvalidation', 'PromotionDecision',
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

// ── Catalog completeness ────────────────────────────────────────

describe('Catalog completeness', async () => {
  const {
    PROMOTION_ELIGIBILITIES,
    APPROVAL_STATUSES,
    INVALIDATION_REASONS,
    PROMOTION_DECISIONS,
  } = await import('../../src/types/approval.js');

  it('PROMOTION_ELIGIBILITIES has 4 values', () => {
    expect(PROMOTION_ELIGIBILITIES.size).toBe(4);
    expect(PROMOTION_ELIGIBILITIES.has('promotable')).toBe(true);
    expect(PROMOTION_ELIGIBILITIES.has('promotable_with_notes')).toBe(true);
    expect(PROMOTION_ELIGIBILITIES.has('not_promotable')).toBe(true);
    expect(PROMOTION_ELIGIBILITIES.has('ineligible')).toBe(true);
  });

  it('APPROVAL_STATUSES has 4 values', () => {
    expect(APPROVAL_STATUSES.size).toBe(4);
    expect(APPROVAL_STATUSES.has('pending')).toBe(true);
    expect(APPROVAL_STATUSES.has('approved')).toBe(true);
    expect(APPROVAL_STATUSES.has('rejected')).toBe(true);
    expect(APPROVAL_STATUSES.has('invalidated')).toBe(true);
  });

  it('INVALIDATION_REASONS has 6 values', () => {
    expect(INVALIDATION_REASONS.size).toBe(6);
    expect(INVALIDATION_REASONS.has('handoff_changed')).toBe(true);
    expect(INVALIDATION_REASONS.has('outcome_changed')).toBe(true);
    expect(INVALIDATION_REASONS.has('new_blocker')).toBe(true);
    expect(INVALIDATION_REASONS.has('intervention_occurred')).toBe(true);
    expect(INVALIDATION_REASONS.has('evidence_missing')).toBe(true);
    expect(INVALIDATION_REASONS.has('verdict_changed')).toBe(true);
  });

  it('PROMOTION_DECISIONS has 3 values', () => {
    expect(PROMOTION_DECISIONS.size).toBe(3);
    expect(PROMOTION_DECISIONS.has('approved')).toBe(true);
    expect(PROMOTION_DECISIONS.has('rejected')).toBe(true);
    expect(PROMOTION_DECISIONS.has('refused')).toBe(true);
  });
});

// ── Cross-domain imports ────────────────────────────────────────

describe('Approval imports from canonical sources', () => {
  it('approval types import HandoffVerdict from handoff', () => {
    const src = readSrc('types/approval.ts');
    expect(src).toContain("from './handoff.js'");
  });

  it('promotion-check imports from types/approval', () => {
    const src = readSrc('console/promotion-check.ts');
    expect(src).toContain("from '../types/approval.js'");
  });

  it('promotion-check imports from types/handoff', () => {
    const src = readSrc('console/promotion-check.ts');
    expect(src).toContain("from '../types/handoff.js'");
  });

  it('approval-invalidation imports from types/approval', () => {
    const src = readSrc('console/approval-invalidation.ts');
    expect(src).toContain("from '../types/approval.js'");
  });

  it('approval-store imports from types/approval', () => {
    const src = readSrc('console/approval-store.ts');
    expect(src).toContain("from '../types/approval.js'");
  });

  it('approval-executor imports from types/approval', () => {
    const src = readSrc('console/approval-executor.ts');
    expect(src).toContain("from '../types/approval.js'");
  });
});
