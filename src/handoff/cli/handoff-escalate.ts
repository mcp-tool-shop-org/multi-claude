/**
 * Handoff Spine — CLI: handoff escalate
 *
 * multi-claude handoff escalate --queue-item <id> --actor <who> --target <target> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { escalateClaim } from '../supervisor/supervisor-actions.js';

export function handoffEscalateCommand(): Command {
  return new Command('escalate')
    .description('Escalate a claimed queue item to higher review')
    .requiredOption('--queue-item <id>', 'Queue item ID')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--target <target>', 'Escalation target (role, person, or team)')
    .requiredOption('--reason <why>', 'Reason for escalation')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const result = escalateClaim(supervisorStore, {
          queueItemId: opts.queueItem,
          actor: opts.actor,
          target: opts.target,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Escalate failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify({ ok: true, claim: result.claim }, null, 2));
        } else {
          console.log(`Escalated: ${opts.queueItem}`);
          console.log(`  Target: ${result.claim.escalationTarget}`);
          console.log(`  Reason: ${opts.reason}`);
        }
      } finally {
        db.close();
      }
    });
}
