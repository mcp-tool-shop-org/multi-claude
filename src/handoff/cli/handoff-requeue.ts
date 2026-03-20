/**
 * Handoff Spine — CLI: handoff requeue
 *
 * multi-claude handoff requeue --queue-item <id> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { requeueClaim } from '../supervisor/supervisor-actions.js';

export function handoffRequeueCommand(): Command {
  return new Command('requeue')
    .description('Requeue a deferred or escalated item back to pending')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for requeue')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const queueStore = new QueueStore(db);
      queueStore.migrate();
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const result = requeueClaim(queueStore, supervisorStore, {
          queueItemId: opts.queueItem,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Requeue failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true }));
        } else {
          console.log(`Requeued: ${opts.queueItem}`);
        }
      } finally {
        db.close();
      }
    });
}
