/**
 * Handoff Spine — CLI: handoff breaches
 *
 * multi-claude handoff breaches [--lane <lane>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { deriveAllHealthSnapshots } from '../intervention/intervention-actions.js';
import type { RoutingLane } from '../routing/types.js';

export function handoffBreachesCommand(): Command {
  return new Command('breaches')
    .description('Show active breach conditions across lanes')
    .option('--lane <lane>', 'Filter by lane')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      const supervisorStore = new SupervisorStore(db);
      const queueStore = new QueueStore(db);
      const flowStore = new FlowStore(db);
      const interventionStore = new InterventionStore(db);
      routingStore.migrate(); supervisorStore.migrate();
      queueStore.migrate(); flowStore.migrate(); interventionStore.migrate();

      try {
        const snapshots = deriveAllHealthSnapshots(
          flowStore, routingStore, supervisorStore, queueStore, interventionStore,
        );

        const breached = opts.lane
          ? snapshots.filter(s => s.lane === (opts.lane as RoutingLane) && s.breachCodes.length > 0)
          : snapshots.filter(s => s.breachCodes.length > 0);

        if (opts.json) {
          console.log(JSON.stringify(breached, null, 2));
        } else if (breached.length === 0) {
          console.log('No active breaches.');
        } else {
          for (const s of breached) {
            console.log(`${s.lane}: ${s.breachCodes.join(', ')}  [${s.healthState}]`);
          }
        }
      } finally {
        db.close();
      }
    });
}
