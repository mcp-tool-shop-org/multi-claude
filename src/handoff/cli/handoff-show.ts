/**
 * Handoff Spine — CLI: handoff show
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { readHandoff } from '../api/read-handoff.js';

export function handoffShowCommand(): Command {
  return new Command('show')
    .description('Show a handoff packet by exact ID')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .option('--version <n>', 'Specific version (default: current)', parseInt)
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = readHandoff(store, opts.id, opts.version);
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(1);
      } finally {
        db.close();
      }
    });
}
