import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { McfResult } from '../types/common.js';

interface ExpiredClaim {
  claim_id: string;
  packet_id: string;
  attempt_id: string;
  actual_state: string;
  claimed_by: string;
}

export interface ExpireResult {
  expired_count: number;
  expired_claims: Array<{
    claim_id: string;
    packet_id: string;
    from_state: string;
    claimed_by: string;
  }>;
}

export function runExpire(dbPath: string, dryRun = false): McfResult<ExpireResult> {
  const db = openDb(dbPath);
  try {
    const now = nowISO();

    // Find all expired active claims WITH actual packet state
    const expired = db.prepare(`
      SELECT c.claim_id, c.packet_id, c.attempt_id, p.status AS actual_state, c.claimed_by
      FROM claims c
      JOIN packets p ON p.packet_id = c.packet_id
      WHERE c.is_active = 1 AND c.lease_expires_at < ?
    `).all(now) as ExpiredClaim[];

    if (dryRun || expired.length === 0) {
      return {
        ok: true,
        command: 'mcf expire',
        result: {
          expired_count: expired.length,
          expired_claims: expired.map(e => ({
            claim_id: e.claim_id,
            packet_id: e.packet_id,
            from_state: e.actual_state,
            claimed_by: e.claimed_by,
          })),
        },
        transitions: [],
      };
    }

    const results: ExpireResult['expired_claims'] = [];

    // Process each expired claim in its own transaction for atomicity
    for (const claim of expired) {
      db.transaction(() => {
        // Release claim
        db.prepare(`
          UPDATE claims SET is_active = 0, released_at = ?, release_reason = 'expired'
          WHERE claim_id = ?
        `).run(now, claim.claim_id);

        // End attempt
        db.prepare(`
          UPDATE packet_attempts SET ended_at = ?, end_reason = 'expired'
          WHERE attempt_id = ?
        `).run(now, claim.attempt_id);

        // Return packet to ready (only if currently claimed or in_progress)
        if (claim.actual_state === 'claimed' || claim.actual_state === 'in_progress') {
          db.prepare(`UPDATE packets SET status = 'ready', updated_at = ? WHERE packet_id = ?`).run(now, claim.packet_id);

          // Log with ACTUAL prior state
          db.prepare(`
            INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
            VALUES (?, 'packet', ?, ?, 'ready', 'system', 'lease_expiry', 'lease expired without renewal', ?)
          `).run(generateId('tr'), claim.packet_id, claim.actual_state, now);
        }

        results.push({
          claim_id: claim.claim_id,
          packet_id: claim.packet_id,
          from_state: claim.actual_state,
          claimed_by: claim.claimed_by,
        });
      })();
    }

    return {
      ok: true,
      command: 'mcf expire',
      result: {
        expired_count: results.length,
        expired_claims: results,
      },
      transitions: results.map(r => ({
        entity_type: 'packet' as const,
        entity_id: r.packet_id,
        from_state: r.from_state,
        to_state: 'ready',
      })),
    };
  } finally {
    db.close();
  }
}

export function expireCommand(): Command {
  const cmd = new Command('expire')
    .description('Expire stale claim leases')
    .option('--dry-run', 'Report without acting', false)
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runExpire(opts.dbPath, opts.dryRun);
      console.log(JSON.stringify(result, null, 2));
    });

  return cmd;
}
