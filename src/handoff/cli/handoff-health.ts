/**
 * Handoff Spine — CLI: handoff health
 *
 * multi-claude handoff health [--lane <lane>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { healthInspect, laneHealthInspect } from '../api/intervention-api.js';
import type { RoutingLane } from '../routing/types.js';

export function handoffHealthCommand(): Command {
  return new Command('health')
    .description('Show lane health and intervention state')
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
        if (opts.lane) {
          const result = laneHealthInspect(
            flowStore, routingStore, supervisorStore, queueStore, interventionStore,
            opts.lane as RoutingLane,
          );
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            const s = result.snapshot;
            const icon = s.healthState === 'healthy' ? '●' : s.healthState === 'frozen' ? '■' : '▲';
            console.log(`${icon} ${s.lane}: ${s.healthState.toUpperCase()}`);
            console.log(`  WIP: ${s.activeCount}/${s.wipCap}  Pending: ${s.pendingCount}  Overflow: ${s.overflowCount}  Starved: ${s.starvedCount}`);
            if (s.breachCodes.length > 0) console.log(`  Breaches: ${s.breachCodes.join(', ')}`);
            if (result.intervention) console.log(`  Intervention: ${result.intervention.action} — ${result.intervention.reason}`);
          }
        } else {
          const result = healthInspect(flowStore, routingStore, supervisorStore, queueStore, interventionStore);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            for (const s of result.snapshots) {
              const icon = s.healthState === 'healthy' ? '●' : s.healthState === 'frozen' ? '■' : '▲';
              console.log(`${icon} ${s.lane}: ${s.healthState}  ${s.activeCount}/${s.wipCap} active  ${s.breachCodes.length > 0 ? `[${s.breachCodes.join(', ')}]` : ''}`);
            }
            if (result.activeInterventions.length > 0) {
              console.log(`\nActive interventions: ${result.activeInterventions.length}`);
              for (const i of result.activeInterventions) {
                console.log(`  ${i.lane}: ${i.action} — ${i.reason}`);
              }
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
