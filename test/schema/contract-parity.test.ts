import { describe, it, expect } from 'vitest';
import {
  WORKER_OUTPUT_INSTRUCTIONS,
  ARTIFACT_MANIFEST_EXAMPLE,
  WRITEBACK_EXAMPLE,
  validateArtifactManifest,
  validateWriteback,
} from '../../src/schema/submission.js';

describe('Contract Parity — worker instructions, examples, and validators agree', () => {

  it('ARTIFACT_MANIFEST_EXAMPLE passes validateArtifactManifest', () => {
    const result = validateArtifactManifest(ARTIFACT_MANIFEST_EXAMPLE);
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('manifest');
  });

  it('WRITEBACK_EXAMPLE passes validateWriteback (required=true)', () => {
    const result = validateWriteback(WRITEBACK_EXAMPLE, true);
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('writeback');
  });

  it('WORKER_OUTPUT_INSTRUCTIONS contains the artifact example verbatim', () => {
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('files_created');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('files_modified');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('files_deleted');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('test_files');
  });

  it('WORKER_OUTPUT_INSTRUCTIONS contains the writeback nested structure', () => {
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('"writeback"');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('"prose"');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('what_changed');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('why_changed');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('what_to_watch');
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('what_affects_next');
  });

  it('WORKER_OUTPUT_INSTRUCTIONS says no COMPLETE sentinel', () => {
    expect(WORKER_OUTPUT_INSTRUCTIONS).toContain('Do NOT write a separate COMPLETE file');
  });

  it('a realistic worker output passes both validators', () => {
    const artifacts = JSON.stringify({
      files_created: ['packages/domain/src/project.ts', 'packages/domain/src/__tests__/types.test.ts'],
      files_modified: ['packages/domain/src/index.ts'],
      files_deleted: [],
      test_files: ['packages/domain/src/__tests__/types.test.ts'],
    });

    const writeback = JSON.stringify({
      writeback: {
        module: 'packages/domain/src',
        change_type: 'contract',
        summary: 'Added core domain types for Project, Asset, Layer, Command',
        files_touched: ['packages/domain/src/project.ts', 'packages/domain/src/index.ts'],
        contract_delta: 'none',
        risks: 'None — additive type-only changes',
        dependencies_affected: ['state-stores packet will import these types'],
        tests_added: ['packages/domain/src/__tests__/types.test.ts'],
        docs_required: false,
        architecture_impact: 'Establishes domain type contracts',
        relationship_suggestions: [],
        prose: {
          what_changed: 'Created TypeScript interfaces for Project, Asset, Layer, Command, CommandResult, PanelId, WorkspaceLayout',
          why_changed: 'Phase 1 foundation requires shared domain types before state and UI packets can proceed',
          what_to_watch: 'These are the contract types — changes here affect all downstream packages',
          what_affects_next: 'State stores and UI shell packets can now import and use these types',
        },
      },
    });

    const artResult = validateArtifactManifest(artifacts);
    expect(artResult).not.toHaveProperty('error');

    const wbResult = validateWriteback(writeback, true);
    expect(wbResult).not.toHaveProperty('error');
  });

  it('rejects writeback without nested writeback key', () => {
    const flat = JSON.stringify({
      module: 'test',
      change_type: 'feature',
      summary: 'A flat structure without the writeback wrapper',
      files_touched: ['test.ts'],
      contract_delta: 'none',
      risks: 'none',
      prose: { what_changed: 'x', why_changed: 'y', what_to_watch: 'z', what_affects_next: 'w' },
    });
    const result = validateWriteback(flat, true);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('writeback');
  });

  it('rejects artifacts with no files', () => {
    const empty = JSON.stringify({
      files_created: [],
      files_modified: [],
      files_deleted: [],
      test_files: [],
    });
    const result = validateArtifactManifest(empty);
    expect(result).toHaveProperty('error');
  });

  it('rejects writeback with generic summary', () => {
    const generic = JSON.stringify({
      writeback: {
        module: 'test',
        change_type: 'feature',
        summary: 'done',
        files_touched: ['test.ts'],
        contract_delta: 'none',
        risks: 'none',
        dependencies_affected: [],
        tests_added: [],
        docs_required: false,
        architecture_impact: null,
        relationship_suggestions: [],
        prose: { what_changed: 'x', why_changed: 'y', what_to_watch: 'z', what_affects_next: 'w' },
      },
    });
    const result = validateWriteback(generic, true);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('generic');
  });
});
