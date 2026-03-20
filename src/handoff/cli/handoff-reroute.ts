/**
 * Handoff Spine — CLI: handoff reroute
 *
 * multi-claude handoff reroute --queue-item <id> --lane <lane> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { rerouteItem } from '../routing/routing-actions.js';
import type { RoutingLane } from '../routing/types.js';

export function handoffRerouteCommand(): Command {
  return new Command('reroute')
    .description('Reroute a queue item to a different lane')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--lane <lane>', 'Target lane: reviewer | approver | recovery | escalated_review')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for reroute')
    .option('--target <target>', 'Assignment target')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const queueStore = new QueueStore(db);
      queueStore.migrate();
      const routingStore = new RoutingStore(db);
      routingStore.migrate();

      try {
        const result = rerouteItem(queueStore, routingStore, {
          queueItemId: opts.queueItem,
          toLane: opts.lane as RoutingLane,
          reasonCode: 'manual_reroute',
          reason: opts.reason,
          actor: opts.actor,
          target: opts.target,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Reroute failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, route: result.route }, null, 2));
        } else {
          console.log(`Rerouted: ${opts.queueItem}`);
          console.log(`  Lane: ${result.route.lane}`);
          console.log(`  Target: ${result.route.assignedTarget ?? '(unassigned)'}`);
        }
      } finally {
        db.close();
      }
    });
}
