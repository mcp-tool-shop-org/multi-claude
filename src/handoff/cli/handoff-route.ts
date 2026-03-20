/**
 * Handoff Spine — CLI: handoff route
 *
 * multi-claude handoff route --queue-item <id> [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { routedInspect } from '../api/routing-api.js';

export function handoffRouteCommand(): Command {
  return new Command('route')
    .description('Show routing state for a queue item')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const queueStore = new QueueStore(db);
      queueStore.migrate();
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();
      const routingStore = new RoutingStore(db);
      routingStore.migrate();

      try {
        const result = routedInspect(queueStore, supervisorStore, routingStore, opts.queueItem);

        if (!result.ok) {
          console.error(`Route inspect failed: ${result.error}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({
            item: result.item,
            route: result.route,
            routeHistory: result.routeHistory,
            routingEvents: result.routingEvents,
            currentLane: result.currentLane,
            assignedTarget: result.assignedTarget,
            canReroute: result.canReroute,
          }, null, 2));
        } else {
          console.log(`Queue Item: ${result.item.queueItemId}`);
          console.log(`Status: ${result.item.status}  Priority: ${result.item.priorityClass}`);
          console.log('');
          if (result.route) {
            console.log(`Lane: ${result.route.lane}`);
            console.log(`Target: ${result.route.assignedTarget ?? '(unassigned)'}`);
            console.log(`Reason: ${result.route.reason}`);
            console.log(`Routed by: ${result.route.routedBy} at ${result.route.routedAt}`);
          } else {
            console.log('Lane: (no active route)');
          }
          console.log(`Can reroute: ${result.canReroute}`);
          console.log('');

          if (result.routeHistory.length > 1) {
            console.log('--- Route History ---');
            for (const r of result.routeHistory) {
              console.log(`  ${r.routedAt}  ${r.lane}  ${r.status}  ${r.reasonCode}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
