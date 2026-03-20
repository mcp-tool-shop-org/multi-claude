/**
 * Handoff Spine — CLI: handoff policy
 *
 * multi-claude handoff policy                          — list all policies
 * multi-claude handoff policy-show --id <id>           — show one policy
 * multi-claude handoff policy-validate --file <path>   — validate content
 * multi-claude handoff policy-diff --id <id> --against <id>  — diff two policies
 * multi-claude handoff policy-simulate --file <path> [--lane <lane>]  — simulate impact
 * multi-claude handoff policy-activate --id <id> --actor <who> --reason <why>
 * multi-claude handoff policy-rollback --to <id> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { openDb } from '../../db/connection.js';
import { PolicyStore } from '../policy/policy-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { policyInspect, policyShow, policyDiff } from '../api/policy-api.js';
import {
  validatePolicy,
  createPolicySet,
  activatePolicy,
  rollbackPolicy,
  simulatePolicy,
} from '../policy/policy-actions.js';
import type { PolicyContent } from '../policy/types.js';
import type { RoutingLane } from '../routing/types.js';

function migrateAll(db: ReturnType<typeof openDb>): {
  policyStore: PolicyStore;
  flowStore: FlowStore;
  routingStore: RoutingStore;
  supervisorStore: SupervisorStore;
  queueStore: QueueStore;
  interventionStore: InterventionStore;
} {
  const policyStore = new PolicyStore(db);
  const flowStore = new FlowStore(db);
  const routingStore = new RoutingStore(db);
  const supervisorStore = new SupervisorStore(db);
  const queueStore = new QueueStore(db);
  const interventionStore = new InterventionStore(db);
  policyStore.migrate();
  flowStore.migrate();
  routingStore.migrate();
  supervisorStore.migrate();
  queueStore.migrate();
  interventionStore.migrate();
  return { policyStore, flowStore, routingStore, supervisorStore, queueStore, interventionStore };
}

function loadContentFile(filePath: string): PolicyContent {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as PolicyContent;
}

// ── List ─────────────────────────────────────────────────────────────

export function handoffPolicyCommand(): Command {
  return new Command('policy')
    .description('List all policy sets')
    .option('--scope <scope>', 'Filter by scope', 'global')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const result = policyInspect(policyStore, opts.scope);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.activePolicy) {
            console.log(`Active: v${result.activePolicy.policyVersion} [${result.activePolicy.contentHash}] — ${result.activePolicy.reason}`);
          } else {
            console.log('No active policy (using defaults)');
          }
          console.log(`\nAll policies (${result.allPolicies.length}):`);
          for (const p of result.allPolicies) {
            const marker = p.status === 'active' ? '●' : p.status === 'superseded' ? '○' : '·';
            console.log(`  ${marker} v${p.policyVersion} [${p.status}] ${p.contentHash} — ${p.reason}`);
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Show ─────────────────────────────────────────────────────────────

export function handoffPolicyShowCommand(): Command {
  return new Command('policy-show')
    .description('Show a specific policy set')
    .requiredOption('--id <policySetId>', 'Policy set ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const result = policyShow(policyStore, opts.id);
        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const p = result.policy;
          console.log(`Policy: ${p.policySetId}`);
          console.log(`  Version: ${p.policyVersion}  Status: ${p.status}  Scope: ${p.scope}`);
          console.log(`  Hash: ${p.contentHash}`);
          console.log(`  Reason: ${p.reason}`);
          console.log(`  Created: ${p.createdAt} by ${p.createdBy}`);
          if (p.activatedAt) console.log(`  Activated: ${p.activatedAt}`);
          if (p.supersededAt) console.log(`  Superseded: ${p.supersededAt}`);
          console.log(`\nContent:`);
          console.log(JSON.stringify(p.content, null, 2));
          if (result.events.length > 0) {
            console.log(`\nEvents (${result.events.length}):`);
            for (const e of result.events) {
              console.log(`  ${e.createdAt} ${e.kind} ${e.fromStatus ?? '-'} → ${e.toStatus} by ${e.actor}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Validate ─────────────────────────────────────────────────────────

export function handoffPolicyValidateCommand(): Command {
  return new Command('policy-validate')
    .description('Validate policy content from a JSON file')
    .requiredOption('--file <path>', 'Path to policy content JSON')
    .option('--json', 'Output JSON')
    .action((opts) => {
      try {
        const content = loadContentFile(opts.file);
        const result = validatePolicy(content);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.valid) {
            console.log('Policy content is valid');
          } else {
            console.error('Policy content is invalid:');
            for (const err of result.errors) {
              console.error(`  - ${err}`);
            }
            process.exit(1);
          }
        }
      } catch (err) {
        console.error(`Failed to load policy file: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

// ── Diff ─────────────────────────────────────────────────────────────

export function handoffPolicyDiffCommand(): Command {
  return new Command('policy-diff')
    .description('Diff two policy sets')
    .requiredOption('--id <policySetId>', 'Base policy set ID')
    .requiredOption('--against <policySetId>', 'Target policy set ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const result = policyDiff(policyStore, opts.id, opts.against);
        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.diffs.length === 0) {
            console.log('No differences');
          } else {
            console.log(`Diff: ${result.fromId} → ${result.toId}`);
            for (const d of result.diffs) {
              const lane = d.lane ? ` [${d.lane}]` : '';
              console.log(`  ${d.field}${lane}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Simulate ─────────────────────────────────────────────────────────

export function handoffPolicySimulateCommand(): Command {
  return new Command('policy-simulate')
    .description('Simulate impact of a candidate policy')
    .requiredOption('--file <path>', 'Path to candidate policy content JSON')
    .option('--lane <lane>', 'Limit simulation to one lane')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const content = loadContentFile(opts.file);
        const validation = validatePolicy(content);
        if (!validation.valid) {
          console.error('Candidate policy is invalid:');
          for (const err of validation.errors) {
            console.error(`  - ${err}`);
          }
          process.exit(1);
        }

        const result = simulatePolicy(
          stores.policyStore, stores.flowStore, stores.routingStore,
          stores.supervisorStore, stores.queueStore, stores.interventionStore,
          content,
          opts.lane ? { lane: opts.lane as RoutingLane } : undefined,
        );

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.diffs.length === 0) {
            console.log('No changes from current policy');
          } else {
            console.log(`Changes (${result.diffs.length}):`);
            for (const d of result.diffs) {
              const lane = d.lane ? ` [${d.lane}]` : '';
              console.log(`  ${d.field}${lane}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
            }
          }
          if (result.impactSummary.length > 0) {
            console.log(`\nImpact:`);
            for (const line of result.impactSummary) {
              console.log(`  ${line}`);
            }
          } else {
            console.log('\nNo projected impact on current state');
          }
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}

// ── Activate ─────────────────────────────────────────────────────────

export function handoffPolicyActivateCommand(): Command {
  return new Command('policy-activate')
    .description('Activate a validated policy set')
    .requiredOption('--id <policySetId>', 'Policy set ID to activate')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for activation')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const result = activatePolicy(policyStore, {
          policySetId: opts.id,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Activation failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Activated: v${result.activated.policyVersion} [${result.activated.contentHash}]`);
          if (result.superseded) {
            console.log(`  Superseded: v${result.superseded.policyVersion} [${result.superseded.contentHash}]`);
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Rollback ─────────────────────────────────────────────────────────

export function handoffPolicyRollbackCommand(): Command {
  return new Command('policy-rollback')
    .description('Rollback to a prior policy version')
    .requiredOption('--to <policySetId>', 'Target policy set ID to restore')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for rollback')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const result = rollbackPolicy(policyStore, {
          targetPolicySetId: opts.to,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Rollback failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Rolled back: v${result.rolledBack.policyVersion} → v${result.restored.policyVersion}`);
          console.log(`  Restored: ${result.restored.policySetId} [${result.restored.contentHash}]`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Create (bonus — create + validate in one step) ───────────────────

export function handoffPolicyCreateCommand(): Command {
  return new Command('policy-create')
    .description('Create a new policy set from a JSON file')
    .requiredOption('--file <path>', 'Path to policy content JSON')
    .requiredOption('--actor <who>', 'Operator identity')
    .requiredOption('--reason <why>', 'Reason for creating')
    .option('--scope <scope>', 'Policy scope', 'global')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const { policyStore } = migrateAll(db);

      try {
        const content = loadContentFile(opts.file);
        const result = createPolicySet(policyStore, {
          content,
          scope: opts.scope,
          reason: opts.reason,
          actor: opts.actor,
        });

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code, errors: result.errors }));
          } else {
            console.error(`Creation failed: ${result.error}`);
            if (result.errors) {
              for (const err of result.errors) console.error(`  - ${err}`);
            }
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Created: ${result.policySet.policySetId} v${result.policySet.policyVersion} [${result.policySet.contentHash}]`);
          console.log(`  Status: ${result.policySet.status}  Scope: ${result.policySet.scope}`);
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      } finally {
        db.close();
      }
    });
}
