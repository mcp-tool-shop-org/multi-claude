/**
 * Canonical submission schema — single source of truth.
 *
 * Used by:
 *   1. submit.ts validator (validates worker output)
 *   2. render.ts prompt builder (instructs worker what to produce)
 *   3. auto.ts worker prompt (SDK session instructions)
 *   4. contract harness tests (proves all three agree)
 *
 * If you change this file, all four consumers update automatically.
 * Do NOT define submission shapes anywhere else.
 */

// ─── Artifact Manifest ──────────────────────────────────────────

export interface ArtifactManifest {
  files_created: string[];
  files_modified: string[];
  files_deleted: string[];
  test_files: string[];
}

// ─── Writeback ──────────────────────────────────────────────────

export interface WritebackProse {
  what_changed: string;
  why_changed: string;
  what_to_watch: string;
  what_affects_next: string;
}

export interface WritebackStructured {
  module: string;
  change_type: string;
  summary: string;
  files_touched: string[];
  contract_delta: string;
  risks: string;
  dependencies_affected: string[];
  tests_added: string[];
  docs_required: boolean;
  architecture_impact: string | null;
  relationship_suggestions: string[];
}

export interface WritebackPayload {
  writeback: WritebackStructured & { prose: WritebackProse };
}

// ─── JSON Schema Strings (for worker prompts) ───────────────────

export const ARTIFACT_MANIFEST_EXAMPLE = JSON.stringify({
  files_created: ['path/to/new-file.ts'],
  files_modified: ['path/to/existing-file.ts'],
  files_deleted: [],
  test_files: ['path/to/new-file.test.ts'],
}, null, 2);

export const WRITEBACK_EXAMPLE = JSON.stringify({
  writeback: {
    module: 'packages/domain/src',
    change_type: 'feature',
    summary: 'Added validation types for anchor checking',
    files_touched: ['packages/domain/src/anchor.ts'],
    contract_delta: 'none',
    risks: 'None — additive changes only',
    dependencies_affected: [],
    tests_added: ['packages/domain/src/anchor.test.ts'],
    docs_required: false,
    architecture_impact: null,
    relationship_suggestions: [],
    prose: {
      what_changed: 'Added AnchorValidationRule and AnchorWarning types',
      why_changed: 'Contract required for anchor validation feature',
      what_to_watch: 'Downstream consumers need to import these types',
      what_affects_next: 'Backend and state packets can now implement validation logic',
    },
  },
}, null, 2);

export const WORKER_OUTPUT_INSTRUCTIONS = `
WHEN COMPLETE, write these two JSON files (these ARE your completion signal — no other marker needed):

1. artifacts.json — what files you changed:
${ARTIFACT_MANIFEST_EXAMPLE}

2. writeback.json — structured knowledge writeback (MUST match this exact shape):
${WRITEBACK_EXAMPLE}

IMPORTANT: writeback.json MUST have a top-level "writeback" key containing all fields.
The "prose" object MUST be nested inside "writeback", not at the top level.
All string fields must be non-empty. "summary" must be at least 10 characters.

The system detects completion by validating these JSON files. Do NOT write a separate COMPLETE file.

IF YOU ENCOUNTER AN ERROR:
- Write the error description to ERROR
- Do NOT write artifacts.json or writeback.json if there was an unrecoverable error
`.trim();

// ─── Validation Helpers ─────────────────────────────────────────

export function validateArtifactManifest(raw: string): { manifest: ArtifactManifest } | { error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { error: 'Invalid JSON in artifacts.json' }; }

  const m = parsed as Record<string, unknown>;
  if (!Array.isArray(m.files_created)) return { error: 'Missing files_created array' };
  if (!Array.isArray(m.files_modified)) return { error: 'Missing files_modified array' };
  if (!Array.isArray(m.files_deleted)) return { error: 'Missing files_deleted array' };
  if (!Array.isArray(m.test_files)) return { error: 'Missing test_files array' };

  const totalFiles = (m.files_created as string[]).length + (m.files_modified as string[]).length;
  if (totalFiles === 0) return { error: 'No files created or modified' };

  return { manifest: m as unknown as ArtifactManifest };
}

export function validateWriteback(raw: string, required: boolean): { writeback: WritebackPayload } | { error: string } {
  if (!required) {
    try { return { writeback: JSON.parse(raw) as WritebackPayload }; } catch { return { error: 'Invalid JSON in writeback.json' }; }
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { error: 'Invalid JSON in writeback.json' }; }

  const w = (parsed as Record<string, unknown>).writeback as Record<string, unknown> | undefined;
  if (!w) return { error: 'Missing top-level "writeback" key. The JSON must be { "writeback": { ... } }' };

  for (const field of ['module', 'change_type', 'summary'] as const) {
    if (!w[field] || typeof w[field] !== 'string' || (w[field] as string).trim() === '') {
      return { error: `Writeback field '${field}' is empty or missing` };
    }
  }

  if (!Array.isArray(w.files_touched) || w.files_touched.length === 0) {
    return { error: 'Writeback files_touched is empty or missing' };
  }

  const prose = w.prose as Record<string, unknown> | undefined;
  if (!prose) return { error: 'Missing writeback.prose object. Must be nested inside "writeback"' };

  for (const field of ['what_changed', 'why_changed', 'what_to_watch', 'what_affects_next'] as const) {
    if (!prose[field] || typeof prose[field] !== 'string' || (prose[field] as string).trim() === '') {
      return { error: `Writeback prose field '${field}' is empty or missing` };
    }
  }

  const summary = (w.summary as string).toLowerCase();
  if (summary === 'implemented the feature' || summary === 'done' || summary.length < 10) {
    return { error: 'Writeback summary is too generic — describe what actually changed' };
  }

  return { writeback: parsed as WritebackPayload };
}
