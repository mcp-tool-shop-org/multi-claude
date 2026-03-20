/**
 * console-handoff.ts — CLI sub-command for run handoff / delivery evidence.
 *
 * Exports a sub-command builder registered on the parent `console` command:
 *   - `console handoff` — show derived handoff artifact
 *   - `console handoff --json` — structured output
 *   - `console handoff --run <id>` — specific run
 */

import { Command } from 'commander';
import { deriveRunHandoff } from '../console/run-handoff.js';
import { renderHandoff } from '../console/handoff-render.js';

export function handoffSubcommand(): Command {
  return new Command('handoff')
    .description('Show derived handoff artifact — review-readiness, contributions, and evidence')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: {
      run?: string;
      dbPath: string;
      json?: boolean;
    }) => {
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

      if (opts.json) {
        console.log(JSON.stringify(handoff, null, 2));
      } else {
        console.log(renderHandoff(handoff));
      }
    });
}
