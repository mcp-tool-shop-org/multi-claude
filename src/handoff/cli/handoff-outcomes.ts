/**
 * Handoff Spine — CLI: handoff outcomes / outcome-show / replay
 *
 * multi-claude handoff outcomes [--status <status>] [--policy <id>] [--json]
 * multi-claude handoff outcome-show --id <outcomeId> [--json]
 * multi-claude handoff replay --queue-item <id> [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { PolicyStore } from '../policy/policy-store.js';
import { OutcomeStore } from '../outcome/outcome-store.js';
import { outcomeInspect, outcomeReplay } from '../api/outcome-api.js';
import type { OutcomeStatus } from '../outcome/types.js';

function migrateAll(db: ReturnType<typeof openDb>) {
  const queueStore = new QueueStore(db);
  const supervisorStore = new SupervisorStore(db);
  const routingStore = new RoutingStore(db);
  const flowStore = new FlowStore(db);
  const interventionStore = new InterventionStore(db);
  const policyStore = new PolicyStore(db);
  const outcomeStore = new OutcomeStore(db);
  queueStore.migrate(); supervisorStore.migrate();
  routingStore.migrate(); flowStore.migrate();
  interventionStore.migrate(); policyStore.migrate();
  outcomeStore.migrate();
  return { queueStore, supervisorStore, routingStore, flowStore, interventionStore, policyStore, outcomeStore };
}

// ── List ─────────────────────────────────────────────────────────────

export function handoffOutcomesCommand(): Command {
  return new Command('outcomes')
    .description('List outcome records')
    .option('--status <status>', 'Filter by status (open|closed)')
    .option('--policy <policySetId>', 'Filter by policy set ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { outcomeStore } = migrateAll(db);

      try {
        const outcomes = outcomeStore.listOutcomes({
          status: opts.status as OutcomeStatus | undefined,
          policySetId: opts.policy,
        });

        if (opts.json) {
          console.log(JSON.stringify(outcomes, null, 2));
        } else {
          if (outcomes.length === 0) {
            console.log('No outcomes found');
            return;
          }
          for (const o of outcomes) {
            const marker = o.status === 'closed' ? '●' : '○';
            const resolution = o.resolutionTerminal ? `${o.resolutionTerminal} (${o.resolutionQuality})` : 'open';
            const duration = o.durationMs !== null ? `${Math.round(o.durationMs / 60000)}m` : '-';
            console.log(`${marker} ${o.outcomeId} [${resolution}] ${duration} — ${o.handoffId}`);
          }
          console.log(`\n${outcomes.length} outcome(s)`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Show ─────────────────────────────────────────────────────────────

export function handoffOutcomeShowCommand(): Command {
  return new Command('outcome-show')
    .description('Show a specific outcome')
    .requiredOption('--id <outcomeId>', 'Outcome ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { outcomeStore } = migrateAll(db);

      try {
        const result = outcomeInspect(outcomeStore, opts.id);
        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const o = result.outcome;
          console.log(`Outcome: ${o.outcomeId}`);
          console.log(`  Status: ${o.status}`);
          console.log(`  Queue Item: ${o.queueItemId}`);
          console.log(`  Handoff: ${o.handoffId} v${o.packetVersion}`);
          console.log(`  Brief: ${o.briefId}`);
          if (o.status === 'closed') {
            console.log(`  Resolution: ${o.resolutionTerminal} (${o.resolutionQuality})`);
            console.log(`  Final Action: ${o.finalAction}`);
            console.log(`  Closed By: ${o.closedBy}`);
            console.log(`  Duration: ${o.durationMs !== null ? Math.round(o.durationMs / 60000) + 'm' : '-'}`);
            if (o.policySetId) {
              console.log(`  Policy: ${o.policySetId} v${o.policyVersion}`);
            }
            console.log(`  Claims: ${o.claimCount}  Defers: ${o.deferCount}  Reroutes: ${o.rerouteCount}`);
            console.log(`  Escalations: ${o.escalationCount}  Overflow: ${o.overflowCount}  Interventions: ${o.interventionCount}`);
            console.log(`  Recovery Cycles: ${o.recoveryCycleCount}  Claim Churn: ${o.claimChurnCount}`);
            if (o.policyChangedDuringLifecycle) console.log(`  Policy changed during lifecycle`);
          }
          console.log(`  Opened: ${o.openedAt}`);
          if (o.closedAt) console.log(`  Closed: ${o.closedAt}`);

          if (result.events.length > 0) {
            console.log(`\nEvents (${result.events.length}):`);
            for (const e of result.events) {
              console.log(`  ${e.createdAt} ${e.kind} — ${e.detail}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Replay ───────────────────────────────────────────────────────────

export function handoffReplayCommand(): Command {
  return new Command('replay')
    .description('Replay the lifecycle timeline of a queue item')
    .option('--queue-item <id>', 'Queue item ID')
    .option('--handoff-id <id>', 'Handoff ID (finds latest queue item)')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        let queueItemId = opts.queueItem;

        // Resolve from handoff ID if needed
        if (!queueItemId && opts.handoffId) {
          const outcome = stores.outcomeStore.getOutcomeByHandoff(opts.handoffId);
          if (outcome) {
            queueItemId = outcome.queueItemId;
          } else {
            console.error(`No outcome found for handoff '${opts.handoffId}'`);
            process.exit(1);
          }
        }

        if (!queueItemId) {
          console.error('Provide --queue-item or --handoff-id');
          process.exit(1);
        }

        const result = outcomeReplay(
          stores.outcomeStore, stores.queueStore, stores.supervisorStore,
          stores.routingStore, stores.flowStore, stores.interventionStore,
          stores.policyStore, queueItemId,
        );

        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.timeline, null, 2));
        } else {
          const t = result.timeline;
          console.log(`Replay: ${t.queueItemId}`);
          console.log(`  Handoff: ${t.handoffId}`);
          if (t.outcomeId) console.log(`  Outcome: ${t.outcomeId}`);
          console.log(`\nTimeline (${t.entries.length} events):`);
          for (const e of t.entries) {
            const actor = e.actor ? ` [${e.actor}]` : '';
            console.log(`  ${e.timestamp} ${e.kind}${actor}`);
            console.log(`    ${e.detail}`);
          }
          console.log(`\nSummary: ${t.summary}`);
        }
      } finally {
        db.close();
      }
    });
}
