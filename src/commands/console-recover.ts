/**
 * console-recover.ts — CLI sub-command for guided recovery.
 *
 * Exports a sub-command builder registered on the parent `console` command:
 *   - `console recover` — show recovery plan for current run
 *   - `console recover --target <id>` — recovery for a specific packet
 *   - `console recover --json` — structured output
 */

import { Command } from 'commander';
import { queryRunModel } from '../console/run-model.js';
import { queryHookFeed } from '../console/hook-feed.js';
import { deriveRecoveryPlan } from '../console/recovery-plan.js';
import { renderRecovery } from '../console/recovery-render.js';

export function recoverSubcommand(): Command {
  return new Command('recover')
    .description('Show guided recovery plan for the current run')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--target <id>', 'Target entity (packet ID) for targeted recovery')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: {
      run?: string;
      target?: string;
      dbPath: string;
      json?: boolean;
    }) => {
      const runModel = queryRunModel(opts.dbPath, opts.run);
      if (!runModel) {
        if (opts.json) {
          console.log(JSON.stringify({
            scenario: 'no_recovery_needed',
            targetId: opts.target ?? 'unknown',
            reason: 'No active run found',
          }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      const hookFeed = queryHookFeed(opts.dbPath, runModel.overview.featureId);
      const result = deriveRecoveryPlan(runModel, hookFeed, opts.target);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderRecovery(result));
      }
    });
}
