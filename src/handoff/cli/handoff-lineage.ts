/**
 * Handoff Spine — CLI: handoff lineage
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { listHandoffLineage } from '../api/list-handoff-lineage.js';

export function handoffLineageCommand(): Command {
  return new Command('lineage')
    .description('Show lineage (ancestors + descendants) for a handoff packet')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = listHandoffLineage(store, opts.id);
        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(1);
      } finally {
        db.close();
      }
    });
}
