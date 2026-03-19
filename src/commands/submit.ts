import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { McfResult } from '../types/common.js';
import { minimatch } from '../lib/glob.js';
import { validateArtifactManifest, validateWriteback } from '../schema/submission.js';

export interface SubmitResult {
  submission_id: string;
  packet_id: string;
  attempt_number: number;
  merge_ready: boolean;
  contract_delta: string | null;
  artifacts_count: number;
  tests_count: number;
}

function checkFileAgainstGlobs(file: string, globs: string[]): boolean {
  return globs.some(glob => minimatch(file, glob));
}

export function runSubmit(
  dbPath: string,
  packetId: string,
  worker: string,
  artifactsJson: string,
  writebackJson: string,
  mergeReady: boolean,
  summary: string,
  patchRef?: string,
  deltaRef?: string,
  seamChangesJson?: string,
  amendmentsApplied?: string[],
  blockers?: string[],
): McfResult<SubmitResult> {
  const db = openDb(dbPath);
  try {
    // 1. Verify packet is in_progress
    const packet = db.prepare(`
      SELECT packet_id, status, allowed_files, forbidden_files, contract_delta_policy,
             knowledge_writeback_required, protected_file_access, seam_file_access
      FROM packets WHERE packet_id = ?
    `).get(packetId) as {
      packet_id: string; status: string;
      allowed_files: string; forbidden_files: string;
      contract_delta_policy: string; knowledge_writeback_required: number;
      protected_file_access: string; seam_file_access: string;
    } | undefined;

    if (!packet) return mcfError('multi-claude submit', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
    if (packet.status !== 'in_progress') return mcfError('multi-claude submit', ERR.PACKET_NOT_IN_PROGRESS, `Packet is '${packet.status}', expected 'in_progress'`, { current_status: packet.status });

    // 2. Verify active claim owned by worker
    const claim = db.prepare(`
      SELECT claim_id, attempt_id, claimed_by FROM claims WHERE packet_id = ? AND is_active = 1
    `).get(packetId) as { claim_id: string; attempt_id: string; claimed_by: string } | undefined;

    if (!claim || claim.claimed_by !== worker) {
      return mcfError('multi-claude submit', ERR.NOT_OWNER, `Worker '${worker}' does not own the active claim`, { packet_id: packetId });
    }

    // 3. Validate artifact manifest
    const artifactResult = validateArtifactManifest(artifactsJson);
    if ('error' in artifactResult) {
      return mcfError('multi-claude submit', ERR.INVALID_ARTIFACTS, artifactResult.error, { validation_errors: [artifactResult.error] });
    }
    const manifest = artifactResult.manifest;

    // 4. Check test requirement
    if (manifest.test_files.length === 0 && packet.knowledge_writeback_required) {
      return mcfError('multi-claude submit', ERR.NO_TESTS, 'No test files in submission — tests are required', {});
    }

    // 5. Validate writeback
    const writebackResult = validateWriteback(writebackJson, packet.knowledge_writeback_required === 1);
    if ('error' in writebackResult) {
      return mcfError('multi-claude submit', ERR.INVALID_WRITEBACK, writebackResult.error, { missing_fields: [writebackResult.error] });
    }

    // 6. Check file scope — all artifact files must be within allowed_files
    const allowedGlobs = JSON.parse(packet.allowed_files) as string[];
    const forbiddenGlobs = JSON.parse(packet.forbidden_files) as string[];

    const allFiles = [...manifest.files_created, ...manifest.files_modified, ...manifest.files_deleted];

    if (allowedGlobs.length > 0) {
      for (const file of allFiles) {
        if (!checkFileAgainstGlobs(file, allowedGlobs)) {
          return mcfError('multi-claude submit', ERR.SCOPE_VIOLATION, `File '${file}' is outside allowed scope`, { file, allowed_globs: allowedGlobs });
        }
      }
    }

    // 7. Check forbidden files
    for (const file of allFiles) {
      if (checkFileAgainstGlobs(file, forbiddenGlobs)) {
        return mcfError('multi-claude submit', ERR.FORBIDDEN_FILE_TOUCHED, `File '${file}' matches forbidden pattern`, { file });
      }
    }

    // 8. Contract delta check
    if (packet.contract_delta_policy === 'none' && deltaRef) {
      return mcfError('multi-claude submit', ERR.SCOPE_VIOLATION, 'Packet policy is "none" but a contract delta was declared', { policy: 'none', delta_ref: deltaRef });
    }

    // 9. Get attempt number for submission ID
    const attempt = db.prepare('SELECT attempt_number FROM packet_attempts WHERE attempt_id = ?').get(claim.attempt_id) as { attempt_number: number };

    const now = nowISO();
    const submissionId = `${packetId}--sub-${attempt.attempt_number}`;

    // 10. Atomic submission
    db.transaction(() => {
      db.prepare(`
        INSERT INTO packet_submissions (
          submission_id, packet_id, attempt_id, submitted_by, submitted_at,
          patch_ref, artifact_manifest, contract_delta_ref, writeback,
          seam_changes, amendments_applied, declared_merge_ready, merge_blockers, builder_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        submissionId, packetId, claim.attempt_id, worker, now,
        patchRef ?? null,
        artifactsJson,
        deltaRef ?? null,
        writebackJson,
        seamChangesJson ?? null,
        amendmentsApplied ? JSON.stringify(amendmentsApplied) : null,
        mergeReady ? 1 : 0,
        blockers ? JSON.stringify(blockers) : null,
        summary,
      );

      // Close attempt
      db.prepare(`UPDATE packet_attempts SET ended_at = ?, end_reason = 'submitted' WHERE attempt_id = ?`).run(now, claim.attempt_id);

      // Release claim
      db.prepare(`UPDATE claims SET is_active = 0, released_at = ?, release_reason = 'submitted' WHERE claim_id = ?`).run(now, claim.claim_id);

      // Update packet status
      db.prepare(`UPDATE packets SET status = 'submitted', updated_at = ? WHERE packet_id = ?`).run(now, packetId);

      // Log transition
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'in_progress', 'submitted', 'builder', ?, 'submission complete', ?)
      `).run(generateId('tr'), packetId, worker, now);
    })();

    return {
      ok: true,
      command: 'multi-claude submit',
      result: {
        submission_id: submissionId,
        packet_id: packetId,
        attempt_number: attempt.attempt_number,
        merge_ready: mergeReady,
        contract_delta: deltaRef ?? null,
        artifacts_count: allFiles.length,
        tests_count: manifest.test_files.length,
      },
      transitions: [{ entity_type: 'packet', entity_id: packetId, from_state: 'in_progress', to_state: 'submitted' }],
    };
  } finally {
    db.close();
  }
}

export function submitCommand(): Command {
  const cmd = new Command('submit')
    .description('Submit packet output for verification')
    .requiredOption('--packet <id>', 'Packet ID')
    .requiredOption('--worker <name>', 'Worker identity')
    .requiredOption('--artifacts <path>', 'Path to JSON artifact manifest')
    .requiredOption('--writeback <path>', 'Path to JSON writeback object')
    .requiredOption('--summary <text>', 'Builder summary')
    .option('--patch-ref <ref>', 'Path to diff/patch or branch reference')
    .option('--delta <id>', 'Contract delta ID')
    .option('--seam-changes <path>', 'Path to JSON seam change declarations')
    .option('--amendments <ids...>', 'Amendment IDs applied')
    .option('--merge-ready', 'Declare merge ready', false)
    .option('--no-merge-ready', 'Declare NOT merge ready')
    .option('--blockers <reasons...>', 'Merge blockers')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const artifactsJson = readFileSync(opts.artifacts, 'utf-8');
      const writebackJson = readFileSync(opts.writeback, 'utf-8');
      const seamChangesJson = opts.seamChanges ? readFileSync(opts.seamChanges, 'utf-8') : undefined;
      const result = runSubmit(
        opts.dbPath, opts.packet, opts.worker,
        artifactsJson, writebackJson,
        opts.mergeReady, opts.summary,
        opts.patchRef, opts.delta, seamChangesJson,
        opts.amendments, opts.blockers,
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
