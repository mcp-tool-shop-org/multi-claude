/**
 * Handoff Spine — CLI: handoff inspect
 *
 * multi-claude handoff inspect --queue-item <id>
 * multi-claude handoff inspect --id <handoffId>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { inspectQueueItem, inspectByHandoff } from '../api/queue-api.js';

export function handoffInspectCommand(): Command {
  return new Command('inspect')
    .description('Inspect a queue item or handoff with full brief, delta, and evidence')
    .option('--queue-item <id>', 'Queue item ID')
    .option('--id <handoffId>', 'Handoff ID (finds active queue items)')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      if (!opts.queueItem && !opts.id) {
        console.error('Error: provide --queue-item <id> or --id <handoffId>');
        process.exit(1);
      }

      const db = openDb(opts.dbPath);
      const handoffStore = new HandoffStore(db);
      handoffStore.migrate();
      const queueStore = new QueueStore(db);
      queueStore.migrate();

      try {
        const result = opts.queueItem
          ? inspectQueueItem(queueStore, opts.queueItem)
          : inspectByHandoff(queueStore, opts.id);

        if (!result.ok) {
          console.error(`Inspect failed: ${result.error}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({
            item: result.item,
            brief: result.brief,
            events: result.events,
          }, null, 2));
        } else {
          // Header
          console.log(`Queue Item: ${result.item.queueItemId}`);
          console.log(`Status: ${result.item.status}  Priority: ${result.item.priorityClass}`);
          console.log(`Handoff: ${result.item.handoffId} v${result.item.packetVersion}`);
          console.log(`Role: ${result.item.role}`);
          console.log('');

          // Rendered brief
          console.log(result.renderedText);
          console.log('');

          // Event history
          if (result.events.length > 0) {
            console.log('--- Event History ---');
            for (const event of result.events) {
              const transition = event.fromStatus
                ? `${event.fromStatus} → ${event.toStatus}`
                : event.toStatus ?? '';
              console.log(`  ${event.createdAt}  ${event.kind}  ${transition}  ${event.reason}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}
