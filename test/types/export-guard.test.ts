/**
 * Export Contract Guard Tests — Phase 10D-203
 *
 * Traps:
 *   - Canonical export types exist
 *   - No local redefinition in consumers
 *   - Format/target catalogs are complete
 *   - Export references canonical types, not redeclared
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

describe('Canonical export types', () => {
  const exportSrc = readSrc('types/export.ts');

  const expectedTypes = [
    'ExportFormat', 'ExportTarget', 'NoteSeverity',
    'ExportSection', 'ExportEvidenceRef', 'ExportGateVerdict',
    'ExportApprovalState', 'ExportContribution', 'ExportBlocker',
    'ExportNote', 'ExportModel', 'ExportRenderOptions',
  ];

  for (const typeName of expectedTypes) {
    it(`defines ${typeName}`, () => {
      expect(hasLocalDefinition(exportSrc, typeName)).toBe(true);
    });
  }

  const expectedSets = [
    'EXPORT_FORMATS', 'EXPORT_TARGETS', 'NOTE_SEVERITIES',
  ];

  for (const setName of expectedSets) {
    it(`defines ${setName} set`, () => {
      expect(exportSrc).toContain(setName);
    });
  }

  it('defines EXPORT_SCHEMA_VERSION', () => {
    expect(exportSrc).toContain('EXPORT_SCHEMA_VERSION');
  });
});

// ── No local redefinition in consumers ──────────────────────────

describe('No local redefinition of export types', () => {
  const consumers = [
    'console/export-model.ts',
    'console/export-markdown.ts',
    'console/export-json.ts',
    'commands/console-export.ts',
  ];

  const guardedTypes = [
    'ExportFormat', 'ExportTarget', 'ExportModel',
    'ExportGateVerdict', 'ExportApprovalState',
    'NoteSeverity', 'ExportContribution', 'ExportBlocker',
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
    EXPORT_FORMATS,
    EXPORT_TARGETS,
    NOTE_SEVERITIES,
    EXPORT_SCHEMA_VERSION,
  } = await import('../../src/types/export.js');

  it('EXPORT_FORMATS has 2 values', () => {
    expect(EXPORT_FORMATS.size).toBe(2);
    expect(EXPORT_FORMATS.has('markdown')).toBe(true);
    expect(EXPORT_FORMATS.has('json')).toBe(true);
  });

  it('EXPORT_TARGETS has 3 values', () => {
    expect(EXPORT_TARGETS.size).toBe(3);
    expect(EXPORT_TARGETS.has('handoff')).toBe(true);
    expect(EXPORT_TARGETS.has('approval')).toBe(true);
    expect(EXPORT_TARGETS.has('gate')).toBe(true);
  });

  it('NOTE_SEVERITIES has 4 values', () => {
    expect(NOTE_SEVERITIES.size).toBe(4);
    expect(NOTE_SEVERITIES.has('informational')).toBe(true);
    expect(NOTE_SEVERITIES.has('caution')).toBe(true);
    expect(NOTE_SEVERITIES.has('material')).toBe(true);
    expect(NOTE_SEVERITIES.has('review_blocking')).toBe(true);
  });

  it('EXPORT_SCHEMA_VERSION is 1', () => {
    expect(EXPORT_SCHEMA_VERSION).toBe(1);
  });
});

// ── Cross-domain imports correct ────────────────────────────────

describe('Export imports from canonical sources', () => {
  it('export types import from handoff, outcome, approval', () => {
    const src = readSrc('types/export.ts');
    expect(src).toContain("from './handoff.js'");
    expect(src).toContain("from './outcome.js'");
    expect(src).toContain("from './approval.js'");
  });

  it('export-model imports from types/export', () => {
    const src = readSrc('console/export-model.ts');
    expect(src).toContain("from '../types/export.js'");
  });

  it('export-markdown imports from types/export', () => {
    const src = readSrc('console/export-markdown.ts');
    expect(src).toContain("from '../types/export.js'");
  });

  it('export-json imports from types/export', () => {
    const src = readSrc('console/export-json.ts');
    expect(src).toContain("from '../types/export.js'");
  });
});
