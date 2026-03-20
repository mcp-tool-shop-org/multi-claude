/**
 * Handoff Spine — CLI: handoff next
 *
 * multi-claude handoff next [--role reviewer|approver] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { resolveNextItem } from '../supervisor/supervisor-actions.js';
import type { DecisionRole } from '../decision/types.js';

export function handoffNextCommand(): Command {
  return new Command('next')
    .description('Pull the next lawful queue item for review')
    .option('--role <role>', 'Filter: reviewer | approver')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const queueStore = new QueueStore(db);
      queueStore.migrate();
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const result = resolveNextItem(queueStore, supervisorStore, {
          role: opts.role as DecisionRole | undefined,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error }));
          } else {
            console.log('No eligible items in queue.');
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify({
            ok: true,
            item: result.item,
            claimState: result.claimState,
          }, null, 2));
        } else {
          const { item } = result;
          console.log(`Next: ${item.queueItemId}`);
          console.log(`  Handoff: ${item.handoffId} v${item.packetVersion}`);
          console.log(`  Role: ${item.role}  Priority: ${item.priorityClass}  Status: ${item.status}`);
          console.log(`  Claim: ${result.claimState}`);
          console.log(`  ${item.blockerSummary.slice(0, 80)}`);
          console.log('');
          console.log(`To claim: multi-claude handoff claim --queue-item ${item.queueItemId} --actor <you>`);
        }
      } finally {
        db.close();
      }
    });
}
