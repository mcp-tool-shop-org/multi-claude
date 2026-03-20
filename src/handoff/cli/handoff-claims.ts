/**
 * Handoff Spine — CLI: handoff claims
 *
 * multi-claude handoff claims [--all] [--actor <who>] [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import type { SupervisorClaim } from '../supervisor/types.js';

function formatClaim(claim: SupervisorClaim): string {
  const statusIcon = {
    active: '●',
    released: '○',
    expired: '⏱',
    completed: '✓',
    interrupted: '⚡',
    deferred: '⏸',
    escalated: '↑',
  }[claim.status] ?? '?';

  const extra = claim.status === 'deferred' && claim.deferredUntil
    ? ` until ${claim.deferredUntil}`
    : claim.status === 'escalated' && claim.escalationTarget
      ? ` → ${claim.escalationTarget}`
      : '';

  return `${statusIcon} ${claim.claimId}  ${claim.queueItemId}  by ${claim.claimedBy}  ${claim.status}${extra}  (${claim.leaseExpiresAt})`;
}

export function handoffClaimsCommand(): Command {
  return new Command('claims')
    .description('List active supervisor claims')
    .option('--all', 'Include terminal claims')
    .option('--actor <who>', 'Filter by actor')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const supervisorStore = new SupervisorStore(db);
      supervisorStore.migrate();

      try {
        const claims = supervisorStore.listClaims({
          activeOnly: !opts.all,
          actor: opts.actor,
        });

        if (opts.json) {
          console.log(JSON.stringify(claims, null, 2));
        } else if (claims.length === 0) {
          console.log('No active claims.');
        } else {
          console.log(`Claims (${claims.length}):\n`);
          for (const claim of claims) {
            console.log(formatClaim(claim));
          }
        }
      } finally {
        db.close();
      }
    });
}
