/**
 * Handoff Spine — CLI: handoff invalidate
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { invalidateHandoff } from '../api/invalidate-handoff.js';
import type { InvalidationReasonCode } from '../schema/version.js';

export function handoffInvalidateCommand(): Command {
  return new Command('invalidate')
    .description('Invalidate a handoff packet version')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .requiredOption('--version <n>', 'Packet version to invalidate', parseInt)
    .requiredOption('--reason-code <code>', 'Reason code: schema_drift | execution_diverged | approval_revoked | superseded | manual | integrity_failure')
    .requiredOption('--reason <text>', 'Human-readable reason')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = invalidateHandoff(store, {
          handoffId: opts.id,
          packetVersion: opts.version,
          reasonCode: opts.reasonCode as InvalidationReasonCode,
          reason: opts.reason,
        });

        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(1);
      } finally {
        db.close();
      }
    });
}
