/**
 * Handoff Spine — CLI: handoff starved
 *
 * multi-claude handoff starved [--threshold <minutes>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { detectStarvation } from '../flow/flow-actions.js';
import { DEFAULT_STARVATION_THRESHOLD_MS } from '../flow/types.js';

export function handoffStarvedCommand(): Command {
  return new Command('starved')
    .description('Show items exceeding starvation threshold')
    .option('--threshold <minutes>', 'Starvation threshold in minutes')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      const supervisorStore = new SupervisorStore(db);
      const queueStore = new QueueStore(db);
      routingStore.migrate();
      supervisorStore.migrate();
      queueStore.migrate();

      try {
        const thresholdMs = opts.threshold
          ? parseInt(opts.threshold, 10) * 60 * 1000
          : DEFAULT_STARVATION_THRESHOLD_MS;

        const starved = detectStarvation(
          queueStore, routingStore, supervisorStore, thresholdMs,
        );

        if (opts.json) {
          console.log(JSON.stringify(starved, null, 2));
        } else if (starved.length === 0) {
          console.log('No starved items.');
        } else {
          for (const item of starved) {
            const ageMin = Math.round(item.ageMs / 60000);
            console.log(`${item.queueItemId}  lane=${item.lane}  age=${ageMin}m  created=${item.createdAt}`);
          }
        }
      } finally {
        db.close();
      }
    });
}
