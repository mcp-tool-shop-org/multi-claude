/**
 * Handoff Spine — CLI: handoff queue
 *
 * multi-claude handoff queue [--role reviewer|approver] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { listQueue, propagateStaleness } from '../api/queue-api.js';
import type { DecisionRole } from '../decision/types.js';
import type { QueueItem } from '../queue/types.js';

function formatQueueItem(item: QueueItem): string {
  const statusIcon = {
    pending: '○',
    in_review: '◐',
    approved: '●',
    rejected: '✗',
    recovery_requested: '↻',
    cleared: '—',
    stale: '⚠',
  }[item.status] ?? '?';

  const priorityLabel = {
    recovery_needed: 'RECOVERY',
    blocked_high: 'BLOCKED',
    blocked_medium: 'REVIEW',
    approvable: 'READY',
    informational: 'INFO',
  }[item.priorityClass] ?? '?';

  return `${statusIcon} [${priorityLabel}] ${item.queueItemId}  ${item.handoffId} v${item.packetVersion}  (${item.role})  ${item.blockerSummary.slice(0, 60)}`;
}

export function handoffQueueCommand(): Command {
  return new Command('queue')
    .description('List the decision queue in priority order')
    .option('--role <role>', 'Filter: reviewer | approver')
    .option('--all', 'Include terminal items')
    .option('--json', 'Output JSON')
    .option('--refresh', 'Propagate staleness before listing')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const handoffStore = new HandoffStore(db);
      handoffStore.migrate();
      const queueStore = new QueueStore(db);
      queueStore.migrate();

      try {
        if (opts.refresh) {
          const staleCount = propagateStaleness(handoffStore, queueStore);
          if (staleCount > 0) {
            console.error(`[queue] ${staleCount} item(s) marked stale`);
          }
        }

        const items = listQueue(queueStore, {
          role: opts.role as DecisionRole | undefined,
          activeOnly: !opts.all,
        });

        if (opts.json) {
          console.log(JSON.stringify(items, null, 2));
        } else if (items.length === 0) {
          console.log('Queue is empty.');
        } else {
          console.log(`Decision Queue (${items.length} item${items.length === 1 ? '' : 's'}):\n`);
          for (const item of items) {
            console.log(formatQueueItem(item));
          }
        }
      } finally {
        db.close();
      }
    });
}
