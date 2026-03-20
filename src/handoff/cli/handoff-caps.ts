/**
 * Handoff Spine — CLI: handoff caps / set-cap
 *
 * multi-claude handoff caps [--json]
 * multi-claude handoff set-cap --lane <lane> --count <n> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { setLaneCap } from '../flow/flow-actions.js';
import { ALL_LANES, type RoutingLane } from '../routing/types.js';
import { DEFAULT_WIP_CAP } from '../flow/types.js';

export function handoffCapsCommand(): Command {
  return new Command('caps')
    .description('Show WIP caps for all lanes')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const flowStore = new FlowStore(db);
      flowStore.migrate();

      try {
        const stored = flowStore.getAllCaps();
        const caps = ALL_LANES.map(lane => {
          const row = stored.find(r => r.lane === lane);
          return {
            lane,
            wipCap: row?.wipCap ?? DEFAULT_WIP_CAP,
            updatedBy: row?.updatedBy ?? 'default',
            reason: row?.reason ?? 'default',
          };
        });

        if (opts.json) {
          console.log(JSON.stringify(caps, null, 2));
        } else {
          for (const c of caps) {
            console.log(`${c.lane}: ${c.wipCap} (${c.reason}, by ${c.updatedBy})`);
          }
        }
      } finally {
        db.close();
      }
    });
}

export function handoffSetCapCommand(): Command {
  return new Command('set-cap')
    .description('Set WIP cap for a lane')
    .requiredOption('--lane <lane>', 'Lane (reviewer|approver|recovery|escalated_review)')
    .requiredOption('--count <n>', 'WIP cap')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for change')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const routingStore = new RoutingStore(db);
      const supervisorStore = new SupervisorStore(db);
      const flowStore = new FlowStore(db);
      routingStore.migrate();
      supervisorStore.migrate();
      flowStore.migrate();

      try {
        const result = setLaneCap(flowStore, routingStore, supervisorStore, {
          lane: opts.lane as RoutingLane,
          cap: parseInt(opts.count, 10),
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Set-cap failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Cap set: ${result.lane} ${result.oldCap} → ${result.newCap}`);
        }
      } finally {
        db.close();
      }
    });
}
