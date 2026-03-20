/**
 * Handoff Spine — CLI: promotion commands.
 *
 * multi-claude handoff promote --proposal <id> --from-report <id>
 * multi-claude handoff promotion-show --id <promotionId>
 * multi-claude handoff promotions [--status <status>] [--json]
 * multi-claude handoff promotion-validate --id <promotionId> --actor <who>
 * multi-claude handoff promotion-trial-start --id <promotionId> --scope-kind <kind> [--lane <lane>] [--max-duration <ms>] [--max-admissions <n>] --actor <who> --reason <why>
 * multi-claude handoff promotion-trial-stop --id <promotionId> --actor <who> --reason <why>
 * multi-claude handoff promotion-compare --id <promotionId>
 * multi-claude handoff promotion-apply --id <promotionId> --actor <who> --reason <why>
 * multi-claude handoff promotion-rollback --id <promotionId> --actor <who> --reason <why>
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { OutcomeStore } from '../outcome/outcome-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { PolicyStore } from '../policy/policy-store.js';
import { CalibrationStore } from '../calibration/calibration-store.js';
import { PromotionStore } from '../promotion/promotion-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import {
  createCandidate,
  validateCandidate,
  startTrial,
  stopTrial,
  compareTrialOutcomes,
  promoteCandidate,
  rollbackCandidate,
} from '../promotion/promotion-actions.js';
import { promotionShow, promotionList } from '../api/promotion-api.js';
import type { TrialScope, TrialScopeKind } from '../promotion/types.js';
import type { RoutingLane } from '../routing/types.js';

function migrateAll(db: ReturnType<typeof openDb>) {
  const queueStore = new QueueStore(db);
  const supervisorStore = new SupervisorStore(db);
  const routingStore = new RoutingStore(db);
  const flowStore = new FlowStore(db);
  const interventionStore = new InterventionStore(db);
  const policyStore = new PolicyStore(db);
  const outcomeStore = new OutcomeStore(db);
  const calibrationStore = new CalibrationStore(db);
  const promotionStore = new PromotionStore(db);
  queueStore.migrate(); supervisorStore.migrate();
  routingStore.migrate(); flowStore.migrate();
  interventionStore.migrate(); policyStore.migrate();
  outcomeStore.migrate(); calibrationStore.migrate();
  promotionStore.migrate();
  return { queueStore, supervisorStore, routingStore, flowStore, interventionStore, policyStore, outcomeStore, calibrationStore, promotionStore };
}

// ── Create candidate ────────────────────────────────────────────────

export function handoffPromoteCommand(): Command {
  return new Command('promote')
    .description('Create candidate policy from calibration proposal')
    .requiredOption('--from-report <reportId>', 'Source calibration report ID')
    .requiredOption('--proposals <ids>', 'Comma-separated adjustment IDs')
    .requiredOption('--actor <who>', 'Actor')
    .requiredOption('--reason <why>', 'Reason')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = createCandidate(
          stores.promotionStore, stores.calibrationStore, stores.policyStore,
          {
            calibrationReportId: opts.fromReport,
            adjustmentIds: opts.proposals.split(','),
            actor: opts.actor,
            reason: opts.reason,
          },
        );

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Create candidate failed: ${result.error}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Promotion created: ${result.promotion.promotionId}`);
          console.log(`  Candidate policy: ${result.candidatePolicySetId}`);
          console.log(`  Baseline policy: ${result.promotion.baselinePolicySetId}`);
          console.log(`  Status: ${result.promotion.status}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Show promotion ──────────────────────────────────────────────────

export function handoffPromotionShowCommand(): Command {
  return new Command('promotion-show')
    .description('Show a specific promotion')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = promotionShow(stores.promotionStore, opts.id);
        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const p = result.promotion;
          console.log(`Promotion: ${p.promotionId}`);
          console.log(`  Status: ${p.status}`);
          console.log(`  Candidate: ${p.candidatePolicySetId}`);
          console.log(`  Baseline: ${p.baselinePolicySetId}`);
          console.log(`  Source: ${p.sourceCalibrationReportId}`);
          console.log(`  Created: ${p.createdAt}`);
          if (p.trialStartedAt) console.log(`  Trial started: ${p.trialStartedAt}`);
          if (p.trialEndedAt) console.log(`  Trial ended: ${p.trialEndedAt}`);
          if (p.decisionAt) console.log(`  Decision: ${p.decisionAt}`);
          console.log(`  Events: ${result.events.length}`);
          console.log(`  Comparisons: ${result.comparisons.length}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── List promotions ─────────────────────────────────────────────────

export function handoffPromotionsCommand(): Command {
  return new Command('promotions')
    .description('List promotions')
    .option('--status <status>', 'Filter by status')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const promotions = promotionList(stores.promotionStore, { status: opts.status });

        if (opts.json) {
          console.log(JSON.stringify(promotions, null, 2));
        } else {
          if (promotions.length === 0) {
            console.log('No promotions');
            return;
          }
          for (const p of promotions) {
            console.log(`${p.promotionId} [${p.status}] candidate=${p.candidatePolicySetId} baseline=${p.baselinePolicySetId}`);
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Validate candidate ──────────────────────────────────────────────

export function handoffPromotionValidateCommand(): Command {
  return new Command('promotion-validate')
    .description('Validate candidate policy before trial')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .requiredOption('--actor <who>', 'Actor')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = validateCandidate(stores.promotionStore, stores.policyStore, opts.id, opts.actor);
        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Validation failed: ${result.error}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Promotion ${opts.id} validated — status: ready_for_trial`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Start trial ─────────────────────────────────────────────────────

export function handoffPromotionTrialStartCommand(): Command {
  return new Command('promotion-trial-start')
    .description('Start a scoped trial of the candidate policy')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .requiredOption('--scope-kind <kind>', 'Trial scope kind: lane|time_window|admission_cap')
    .option('--lane <lane>', 'Lane (for lane scope)')
    .option('--max-duration <ms>', 'Max duration in ms (for time_window scope)')
    .option('--max-admissions <n>', 'Max admissions (for admission_cap scope)')
    .requiredOption('--actor <who>', 'Actor')
    .requiredOption('--reason <why>', 'Reason')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const trialScope: TrialScope = {
          kind: opts.scopeKind as TrialScopeKind,
          lane: (opts.lane as RoutingLane) ?? null,
          maxDurationMs: opts.maxDuration ? parseInt(opts.maxDuration, 10) : null,
          maxAdmissions: opts.maxAdmissions ? parseInt(opts.maxAdmissions, 10) : null,
        };

        const result = startTrial(stores.promotionStore, stores.policyStore, {
          promotionId: opts.id,
          trialScope,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Trial start failed: ${result.error}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Trial started for promotion ${opts.id}`);
          console.log(`  Scope: ${opts.scopeKind}${opts.lane ? ` (lane=${opts.lane})` : ''}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Stop trial ──────────────────────────────────────────────────────

export function handoffPromotionTrialStopCommand(): Command {
  return new Command('promotion-trial-stop')
    .description('Stop a running trial')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .requiredOption('--actor <who>', 'Actor')
    .requiredOption('--reason <why>', 'Reason')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = stopTrial(stores.promotionStore, {
          promotionId: opts.id,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Trial stop failed: ${result.error}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Trial stopped for promotion ${opts.id}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Compare ─────────────────────────────────────────────────────────

export function handoffPromotionCompareCommand(): Command {
  return new Command('promotion-compare')
    .description('Compare candidate vs baseline outcomes')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = compareTrialOutcomes(stores.promotionStore, stores.outcomeStore, {
          promotionId: opts.id,
        });

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Comparison failed: ${result.error}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.comparison, null, 2));
        } else {
          const c = result.comparison;
          console.log(`Comparison: ${c.comparisonId}`);
          console.log(`  Verdict: ${c.verdict}`);
          console.log(`  Reason: ${c.verdictReason}`);
          console.log(`  Candidate: ${c.candidateMetrics.closedOutcomes} closed, clean ${pct(c.candidateMetrics.cleanRate)}`);
          console.log(`  Baseline: ${c.baselineMetrics.closedOutcomes} closed, clean ${pct(c.baselineMetrics.cleanRate)}`);
          if (c.diffs.length > 0) {
            console.log('  Diffs:');
            for (const d of c.diffs) {
              const arrow = d.direction === 'improved' ? '↑' : d.direction === 'regressed' ? '↓' : '=';
              console.log(`    ${arrow} ${d.metric}: ${fmt(d.baselineValue)} → ${fmt(d.candidateValue)}`);
            }
          }
        }
      } finally {
        db.close();
      }
    });
}

// ── Apply (promote) ─────────────────────────────────────────────────

export function handoffPromotionApplyCommand(): Command {
  return new Command('promotion-apply')
    .description('Promote candidate policy to active')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .requiredOption('--actor <who>', 'Actor')
    .requiredOption('--reason <why>', 'Reason')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = promoteCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: opts.id,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Promotion failed: ${result.error}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Promotion ${opts.id} applied — candidate is now active policy`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Rollback ────────────────────────────────────────────────────────

export function handoffPromotionRollbackCommand(): Command {
  return new Command('promotion-rollback')
    .description('Rollback candidate trial, restore baseline')
    .requiredOption('--id <promotionId>', 'Promotion ID')
    .requiredOption('--actor <who>', 'Actor')
    .requiredOption('--reason <why>', 'Reason')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = rollbackCandidate(stores.promotionStore, stores.policyStore, {
          promotionId: opts.id,
          actor: opts.actor,
          reason: opts.reason,
        });

        if (!result.ok) {
          if (opts.json) console.log(JSON.stringify(result));
          else console.error(`Rollback failed: ${result.error}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(result.promotion, null, 2));
        } else {
          console.log(`Promotion ${opts.id} rolled back — baseline restored`);
        }
      } finally {
        db.close();
      }
    });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function fmt(v: number | null): string {
  if (v === null) return 'n/a';
  return typeof v === 'number' && v < 1 ? pct(v) : String(v);
}
