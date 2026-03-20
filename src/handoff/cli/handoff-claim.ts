/**
 * Handoff Spine — CLI: handoff claim
 *
 * multi-claude handoff claim --queue-item <id> --actor <who> [--lease <minutes>]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { claimQueueItem } from '../supervisor/supervisor-actions.js';

export function handoffClaimCommand(): Command {
  return new Command('claim')
    .description('Claim a queue item for active review')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--actor <who>', 'Operator identity')
    .option('--lease <minutes>', 'Lease duration in minutes', '15')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const queueStore = new QueueStore(db);
      queueStore.migrate();
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const leaseDurationMs = parseInt(opts.lease, 10) * 60 * 1000;
        const result = claimQueueItem(queueStore, supervisorStore, {
          queueItemId: opts.queueItem,
          actor: opts.actor,
          leaseDurationMs,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Claim failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, claim: result.claim }, null, 2));
        } else {
          console.log(`Claimed: ${result.claim.claimId}`);
          console.log(`  Item: ${result.claim.queueItemId}`);
          console.log(`  By: ${result.claim.claimedBy}`);
          console.log(`  Expires: ${result.claim.leaseExpiresAt}`);
        }
      } finally {
        db.close();
      }
    });
}
