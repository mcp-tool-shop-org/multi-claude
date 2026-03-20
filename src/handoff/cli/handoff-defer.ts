/**
 * Handoff Spine — CLI: handoff defer
 *
 * multi-claude handoff defer --queue-item <id> --actor <who> --until <ISO> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { deferClaim } from '../supervisor/supervisor-actions.js';

export function handoffDeferCommand(): Command {
  return new Command('defer')
    .description('Defer a claimed queue item until a specific time')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--until <time>', 'Defer until (ISO timestamp or +NNm/+NNh)')
    .requiredOption('--reason <why>', 'Reason for deferral')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const deferredUntil = resolveTime(opts.until);

        const result = deferClaim(supervisorStore, {
          queueItemId: opts.queueItem,
          actor: opts.actor,
          deferredUntil,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Defer failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, claim: result.claim }, null, 2));
        } else {
          console.log(`Deferred: ${opts.queueItem}`);
          console.log(`  Until: ${result.claim.deferredUntil}`);
          console.log(`  Reason: ${opts.reason}`);
        }
      } finally {
        db.close();
      }
    });
}

/**
 * Parse a time string: ISO timestamp, +NNm (minutes), or +NNh (hours).
 */
function resolveTime(input: string): string {
  if (input.startsWith('+')) {
    const unit = input.slice(-1);
    const value = parseInt(input.slice(1, -1), 10);
    if (isNaN(value)) throw new Error(`Invalid time offset: ${input}`);

    let ms: number;
    if (unit === 'm') ms = value * 60 * 1000;
    else if (unit === 'h') ms = value * 60 * 60 * 1000;
    else throw new Error(`Unknown time unit '${unit}' — use m or h`);

    return new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // Assume ISO timestamp
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error(`Invalid time: ${input}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
