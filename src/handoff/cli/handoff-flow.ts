/**
 * Handoff Spine — CLI: handoff flow
 *
 * multi-claude handoff flow [--lane <lane>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { flowInspect, laneInspect } from '../api/flow-api.js';
import type { RoutingLane } from '../routing/types.js';

export function handoffFlowCommand(): Command {
  return new Command('flow')
    .description('Show flow control state for all or a specific lane')
    .option('--lane <lane>', 'Filter by lane (reviewer|approver|recovery|escalated_review)')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      const supervisorStore = new SupervisorStore(db);
      const queueStore = new QueueStore(db);
      const flowStore = new FlowStore(db);
      routingStore.migrate();
      supervisorStore.migrate();
      queueStore.migrate();
      flowStore.migrate();

      try {
        if (opts.lane) {
          const result = laneInspect(
            flowStore, routingStore, supervisorStore, queueStore,
            opts.lane as RoutingLane,
          );

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const s = result.state;
            console.log(`Lane: ${s.lane}  Status: ${s.flowStatus}`);
            console.log(`  WIP: ${s.activeCount}/${s.wipCap}  Pending: ${s.pendingCount}  Overflow: ${s.overflowCount}`);
            console.log(`  Admission: ${result.admission.ok ? 'open' : result.admission.reason}`);
            if (result.starved.length > 0) {
              console.log(`  Starved: ${result.starved.length} items`);
            }
          }
        } else {
          const result = flowInspect(flowStore, routingStore, supervisorStore, queueStore);

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            for (const s of result.lanes) {
              const bar = s.activeCount >= s.wipCap ? '■' : '□';
              console.log(`${bar} ${s.lane}: ${s.activeCount}/${s.wipCap} active, ${s.pendingCount} pending, ${s.overflowCount} overflow  [${s.flowStatus}]`);
            }
            if (result.overflow.length > 0) {
              console.log(`\nOverflow: ${result.overflow.length} items`);
            }
            if (result.starved.length > 0) {
              console.log(`Starved: ${result.starved.length} items`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
