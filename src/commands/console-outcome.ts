/**
 * console-outcome.ts — CLI sub-command for run closure / outcome.
 *
 * Exports a sub-command builder registered on the parent `console` command:
 *   - `console outcome` — show derived run outcome
 *   - `console outcome --json` — structured output
 *   - `console outcome --run <id>` — specific run
 */

import { Command } from 'commander';
import { deriveRunOutcome } from '../console/run-outcome.js';
import { renderOutcome } from '../console/outcome-render.js';

export function outcomeSubcommand(): Command {
  return new Command('outcome')
    .description('Show derived run outcome — what completed, failed, and what to do next')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: {
      run?: string;
      dbPath: string;
      json?: boolean;
    }) => {
      const outcome = deriveRunOutcome(opts.dbPath, opts.run);

      if (!outcome) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found' }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(outcome, null, 2));
      } else {
        console.log(renderOutcome(outcome));
      }
    });
}
