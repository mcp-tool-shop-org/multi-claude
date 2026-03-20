/**
 * Handoff Spine — CLI: handoff routes
 *
 * multi-claude handoff routes [--lane reviewer|approver|recovery|escalated_review] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import type { Route, RoutingLane } from '../routing/types.js';

function formatRoute(route: Route): string {
  const laneIcon = {
    reviewer: '👁',
    approver: '✓',
    recovery: '↻',
    escalated_review: '↑',
  }[route.lane] ?? '?';

  const target = route.assignedTarget ? ` → ${route.assignedTarget}` : '';
  return `${laneIcon} [${route.lane}] ${route.routeId}  ${route.queueItemId}${target}  (${route.reasonCode})`;
}

export function handoffRoutesCommand(): Command {
  return new Command('routes')
    .description('List active routes by lane')
    .option('--lane <lane>', 'Filter: reviewer | approver | recovery | escalated_review')
    .option('--all', 'Include non-active routes')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      routingStore.migrate();

      try {
        const routes = routingStore.listRoutes({
          lane: opts.lane as RoutingLane | undefined,
          activeOnly: !opts.all,
        });

        if (opts.json) {
          console.log(JSON.stringify(routes, null, 2));
        } else if (routes.length === 0) {
          console.log('No active routes.');
        } else {
          console.log(`Routes (${routes.length}):\n`);
          for (const route of routes) {
            console.log(formatRoute(route));
          }
        }
      } finally {
        db.close();
      }
    });
}
