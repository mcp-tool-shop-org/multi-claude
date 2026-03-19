/**
 * Contract harness: proves prompt instructions, worker output, and CLI validator
 * all agree on the exact submission shape.
 *
 * If this test fails, the prompt and validator have drifted apart.
 */
import { describe, it, expect } from 'vitest';
import {
  validateArtifactManifest,
  validateWriteback,
  ARTIFACT_MANIFEST_EXAMPLE,
  WRITEBACK_EXAMPLE,
  WORKER_OUTPUT_INSTRUCTIONS,
} from '../../src/schema/submission.js';

describe('submission contract harness', () => {
  describe('example artifacts pass validation', () => {
    it('ARTIFACT_MANIFEST_EXAMPLE passes validateArtifactManifest', () => {
      const result = validateArtifactManifest(ARTIFACT_MANIFEST_EXAMPLE);
      expect('manifest' in result).toBe(true);
      if ('error' in result) throw new Error(`Validator rejected example: ${result.error}`);
    });
  });

  describe('example writeback passes validation', () => {
    it('WRITEBACK_EXAMPLE passes validateWriteback (required=true)', () => {
      const result = validateWriteback(WRITEBACK_EXAMPLE, true);
      expect('writeback' in result).toBe(true);
      if ('error' in result) throw new Error(`Validator rejected example: ${result.error}`);
    });
  });

  describe('worker instructions reference correct shape', () => {
    it('instructions mention top-level writeback key', () => {
      expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('"writeback"');
    });

    it('instructions mention prose sub-object', () => {
      expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('"prose"');
    });

    it('instructions mention all prose fields', () => {
      for (const field of ['what_changed', 'why_changed', 'what_to_watch', 'what_affects_next']) {
        expect(WORKER_OUTPUT_INSTRUCTIONS).toContain(`"${field}"`);
      }
    });

    it('instructions mention all structured fields', () => {
      for (const field of ['module', 'change_type', 'summary', 'files_touched', 'contract_delta']) {
        expect(WORKER_OUTPUT_INSTRUCTIONS).toContain(`"${field}"`);
      }
    });
  });

  describe('real worker output from SDK run passes validation', () => {
    // This is the actual output produced by the Opus worker session
    const realWorkerArtifacts = JSON.stringify({
      files_created: ['packages/domain/src/anchor-validation.test.ts'],
      files_modified: ['packages/domain/src/anchor.ts'],
      files_deleted: [],
      test_files: ['packages/domain/src/anchor-validation.test.ts'],
    });

    it('real worker artifacts pass validation', () => {
      const result = validateArtifactManifest(realWorkerArtifacts);
      expect('manifest' in result).toBe(true);
    });

    // This is what the worker SHOULD have produced (with correct nesting)
    const correctlyNestedWriteback = JSON.stringify({
      writeback: {
        module: 'packages/domain/src',
        change_type: 'contract',
        summary: 'Added AnchorValidationRule, AnchorValidationSeverity, AnchorWarning, and AnchorValidationResult types to the anchor domain.',
        files_touched: ['packages/domain/src/anchor.ts', 'packages/domain/src/anchor-validation.test.ts'],
        contract_delta: 'none',
        risks: 'None — additive type-only changes with no runtime impact.',
        dependencies_affected: ['anchor-validation backend packet'],
        tests_added: ['packages/domain/src/anchor-validation.test.ts'],
        docs_required: false,
        architecture_impact: null,
        relationship_suggestions: [],
        prose: {
          what_changed: 'Added four new types to anchor.ts for anchor validation contracts.',
          why_changed: 'Contract required before implementing validation logic.',
          what_to_watch: 'Downstream consumers need to import these types.',
          what_affects_next: 'Backend and state packets can now implement validation logic.',
        },
      },
    });

    it('correctly nested writeback passes validation', () => {
      const result = validateWriteback(correctlyNestedWriteback, true);
      expect('writeback' in result).toBe(true);
      if ('error' in result) throw new Error(`Validator rejected: ${result.error}`);
    });
  });

  describe('malformed outputs are rejected', () => {
    it('flat writeback (no top-level key) is rejected', () => {
      const flat = JSON.stringify({
        module: 'packages/domain/src',
        change_type: 'contract',
        summary: 'Added types',
        files_touched: ['file.ts'],
        what_changed: 'stuff',
      });
      const result = validateWriteback(flat, true);
      expect('error' in result).toBe(true);
    });

    it('writeback without prose is rejected', () => {
      const noProse = JSON.stringify({
        writeback: {
          module: 'packages/domain/src',
          change_type: 'contract',
          summary: 'Added types for anchor validation',
          files_touched: ['file.ts'],
          contract_delta: 'none',
          risks: 'none',
          dependencies_affected: [],
          tests_added: [],
          docs_required: false,
          architecture_impact: null,
          relationship_suggestions: [],
        },
      });
      const result = validateWriteback(noProse, true);
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('prose');
    });

    it('generic summary is rejected', () => {
      const generic = JSON.stringify({
        writeback: {
          module: 'src',
          change_type: 'feature',
          summary: 'done',
          files_touched: ['file.ts'],
          contract_delta: 'none',
          risks: 'none',
          dependencies_affected: [],
          tests_added: [],
          docs_required: false,
          architecture_impact: null,
          relationship_suggestions: [],
          prose: {
            what_changed: 'stuff',
            why_changed: 'reasons',
            what_to_watch: 'things',
            what_affects_next: 'more things',
          },
        },
      });
      const result = validateWriteback(generic, true);
      expect('error' in result).toBe(true);
      if ('error' in result) expect(result.error).toContain('generic');
    });

    it('empty artifacts rejected', () => {
      const empty = JSON.stringify({
        files_created: [],
        files_modified: [],
        files_deleted: [],
        test_files: [],
      });
      const result = validateArtifactManifest(empty);
      expect('error' in result).toBe(true);
    });
  });
});
