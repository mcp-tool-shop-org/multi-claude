/**
 * Handoff Spine — CLI: handoff overflow
 *
 * multi-claude handoff overflow [--lane <lane>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { FlowStore } from '../flow/flow-store.js';
import type { RoutingLane } from '../routing/types.js';

export function handoffOverflowCommand(): Command {
  return new Command('overflow')
    .description('Show overflowed items waiting for capacity')
    .option('--lane <lane>', 'Filter by lane')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const flowStore = new FlowStore(db);
      flowStore.migrate();

      try {
        const items = flowStore.listOverflow(opts.lane as RoutingLane | undefined);

        if (opts.json) {
          console.log(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          console.log('No overflow items.');
        } else {
          for (const item of items) {
            console.log(`${item.queueItemId}  lane=${item.lane}  since=${item.enteredAt}  ${item.reason}`);
          }
        }
      } finally {
        db.close();
      }
    });
}
