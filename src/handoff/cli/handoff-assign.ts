/**
 * Handoff Spine — CLI: handoff assign / unassign
 *
 * multi-claude handoff assign --queue-item <id> --target <target> --actor <who>
 * multi-claude handoff unassign --queue-item <id> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { assignTarget, unassignTarget } from '../routing/routing-actions.js';

export function handoffAssignCommand(): Command {
  return new Command('assign')
    .description('Assign a target to a routed queue item')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--target <target>', 'Assignment target')
    .requiredOption('--actor <who>', 'Operator identity')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      routingStore.migrate();

      try {
        const result = assignTarget(routingStore, {
          queueItemId: opts.queueItem,
          target: opts.target,
          actor: opts.actor,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Assign failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, route: result.route }, null, 2));
        } else {
          console.log(`Assigned: ${opts.queueItem} → ${result.route.assignedTarget}`);
        }
      } finally {
        db.close();
      }
    });
}

export function handoffUnassignCommand(): Command {
  return new Command('unassign')
    .description('Remove assignment from a routed queue item')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for unassignment')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      routingStore.migrate();

      try {
        const result = unassignTarget(routingStore, {
          queueItemId: opts.queueItem,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Unassign failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, route: result.route }, null, 2));
        } else {
          console.log(`Unassigned: ${opts.queueItem}`);
        }
      } finally {
        db.close();
      }
    });
}
