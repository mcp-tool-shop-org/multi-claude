/**
 * console-export.ts — CLI sub-commands for export.
 *
 * Commands:
 *   - console export handoff --format markdown|json [--run <id>]
 *   - console export approval --format json [--run <id>]
 *   - console export gate --format json [--run <id>]
 */

import { Command } from 'commander';
import { deriveRunHandoff } from '../console/run-handoff.js';
import { checkPromotion } from '../console/promotion-check.js';
import { getLatestApproval } from '../console/approval-store.js';
import { checkApprovalValidity } from '../console/approval-invalidation.js';
import { deriveExportModel } from '../console/export-model.js';
import { renderMarkdownHandoff, renderMarkdownApproval } from '../console/export-markdown.js';
import { renderGateVerdict, renderApprovalSnapshot, renderHandoffJson } from '../console/export-json.js';

function resolveExportModel(dbPath: string, runId?: string) {
  const handoff = deriveRunHandoff(dbPath, runId);
  if (!handoff) return null;

  const promotionCheck = checkPromotion(handoff);

  let approval = null;
  let invalidation = null;
  try {
    approval = getLatestApproval(dbPath, handoff.runId);
    if (approval && approval.status === 'approved') {
      invalidation = checkApprovalValidity(approval, handoff);
    }
  } catch {
    // No approval table yet — that's fine
  }

  return deriveExportModel(handoff, promotionCheck, approval, invalidation);
}

export function exportSubcommand(): Command {
  const cmd = new Command('export')
    .description('Export run artifacts for downstream consumption');

  // ── export handoff ────────────────────────────────────────────

  cmd.addCommand(
    new Command('handoff')
      .description('Export handoff artifact')
      .option('--run <id>', 'Run ID (default: most recent)')
      .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
      .option('--format <fmt>', 'Output format: markdown | json', 'markdown')
      .action((opts: { run?: string; dbPath: string; format: string }) => {
        const model = resolveExportModel(opts.dbPath, opts.run);

        if (!model) {
          console.error('No active run found.');
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify(renderHandoffJson(model), null, 2));
        } else {
          console.log(renderMarkdownHandoff(model));
        }
      }),
  );

  // ── export approval ───────────────────────────────────────────

  cmd.addCommand(
    new Command('approval')
      .description('Export approval state')
      .option('--run <id>', 'Run ID (default: most recent)')
      .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
      .option('--format <fmt>', 'Output format: markdown | json', 'json')
      .action((opts: { run?: string; dbPath: string; format: string }) => {
        const model = resolveExportModel(opts.dbPath, opts.run);

        if (!model) {
          console.error('No active run found.');
          process.exitCode = 1;
          return;
        }

        if (opts.format === 'markdown') {
          console.log(renderMarkdownApproval(model));
        } else {
          console.log(JSON.stringify(renderApprovalSnapshot(model), null, 2));
        }
      }),
  );

  // ── export gate ───────────────────────────────────────────────

  cmd.addCommand(
    new Command('gate')
      .description('Export CI gate verdict')
      .option('--run <id>', 'Run ID (default: most recent)')
      .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
      .action((opts: { run?: string; dbPath: string }) => {
        const model = resolveExportModel(opts.dbPath, opts.run);

        if (!model) {
          console.error('No active run found.');
          process.exitCode = 1;
          return;
        }

        console.log(JSON.stringify(renderGateVerdict(model), null, 2));
      }),
  );

  return cmd;
}
