/**
 * Handoff Spine — CLI: handoff intervene / resolve-intervention
 *
 * multi-claude handoff intervene --lane <lane> --action <action> --actor <who> --reason <why>
 * multi-claude handoff resolve-intervention --lane <lane> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { startIntervention, resolveIntervention } from '../intervention/intervention-actions.js';
import type { RoutingLane } from '../routing/types.js';
import type { InterventionAction } from '../intervention/types.js';

export function handoffInterveneCommand(): Command {
  return new Command('intervene')
    .description('Start an intervention on a lane')
    .requiredOption('--lane <lane>', 'Lane to intervene on')
    .requiredOption('--action <action>', 'Action: freeze|restrict|escalate_priority|force_recovery|require_attention')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for intervention')
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
        const result = startIntervention(
          flowStore, routingStore, supervisorStore, queueStore, interventionStore,
          {
            lane: opts.lane as RoutingLane,
            action: opts.action as InterventionAction,
            reason: opts.reason,
            actor: opts.actor,
          },
        );

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Intervention failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Intervention started: ${result.intervention.action} on ${result.intervention.lane}`);
          console.log(`  Health: ${result.snapshot.healthState}`);
        }
      } finally {
        db.close();
      }
    });
}

export function handoffResolveInterventionCommand(): Command {
  return new Command('resolve-intervention')
    .description('Resolve an active intervention on a lane')
    .requiredOption('--lane <lane>', 'Lane to resolve')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for resolution')
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
        const result = resolveIntervention(
          flowStore, routingStore, supervisorStore, queueStore, interventionStore,
          { lane: opts.lane as RoutingLane, actor: opts.actor, reason: opts.reason },
        );

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Resolve failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Intervention resolved: ${result.intervention.lane}`);
          console.log(`  Health: ${result.snapshot.healthState}`);
        }
      } finally {
        db.close();
      }
    });
}
