/**
 * console-approval.ts — CLI sub-commands for promotion and approval.
 *
 * Sub-commands:
 *   - `console promote-check` — check promotion eligibility
 *   - `console approve` — approve a run for promotion
 *   - `console reject` — explicitly reject a run
 *   - `console approval` — show current approval status
 */

import { Command } from 'commander';
import { deriveRunHandoff } from '../console/run-handoff.js';
import { checkPromotion } from '../console/promotion-check.js';
import { executeApprove, executeReject, checkApprovalStatus } from '../console/approval-executor.js';
import {
  renderPromotionCheck,
  renderApprovalStatus,
  renderApproveResult,
} from '../console/approval-render.js';

export function promoteCheckSubcommand(): Command {
  return new Command('promote-check')
    .description('Check if a run is eligible for promotion')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: { run?: string; dbPath: string; json?: boolean }) => {
      const handoff = deriveRunHandoff(opts.dbPath, opts.run);

      if (!handoff) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found' }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      const check = checkPromotion(handoff);

      if (opts.json) {
        console.log(JSON.stringify(check, null, 2));
      } else {
        console.log(renderPromotionCheck(check));
      }
    });
}

export function approveSubcommand(): Command {
  return new Command('approve')
    .description('Approve a run for promotion')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--reason <text>', 'Reason for approval', 'Approved after review')
    .option('--approver <name>', 'Approver identity', 'operator')
    .option('--json', 'Output as JSON')
    .action((opts: {
      run?: string;
      dbPath: string;
      reason: string;
      approver: string;
      json?: boolean;
    }) => {
      const result = executeApprove({
        dbPath: opts.dbPath,
        runId: opts.run,
        approver: opts.approver,
        reason: opts.reason,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderApproveResult(result));
      }

      if (result.decision === 'refused') {
        process.exitCode = 1;
      }
    });
}

export function rejectSubcommand(): Command {
  return new Command('reject')
    .description('Explicitly reject a run for promotion')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .requiredOption('--reason <text>', 'Reason for rejection')
    .option('--approver <name>', 'Rejector identity', 'operator')
    .option('--json', 'Output as JSON')
    .action((opts: {
      run?: string;
      dbPath: string;
      reason: string;
      approver: string;
      json?: boolean;
    }) => {
      const result = executeReject({
        dbPath: opts.dbPath,
        runId: opts.run,
        approver: opts.approver,
        reason: opts.reason,
      });

      if (!result) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found' }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderApproveResult(result));
      }
    });
}

export function approvalSubcommand(): Command {
  return new Command('approval')
    .description('Show current approval status for a run')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: { run?: string; dbPath: string; json?: boolean }) => {
      const status = checkApprovalStatus(opts.dbPath, opts.run);

      if (!status) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found' }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(renderApprovalStatus(status));
      }
    });
}
