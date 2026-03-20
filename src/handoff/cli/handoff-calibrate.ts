/**
 * Handoff Spine — CLI: handoff calibrate / calibration-show
 *
 * multi-claude handoff calibrate [--policy <id>] [--lane <lane>] [--json]
 * multi-claude handoff calibration-show --id <reportId> [--json]
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { OutcomeStore } from '../outcome/outcome-store.js';
import { RoutingStore } from '../routing/routing-store.js';
import { PolicyStore } from '../policy/policy-store.js';
import { CalibrationStore } from '../calibration/calibration-store.js';
import { QueueStore } from '../queue/queue-store.js';
import { SupervisorStore } from '../supervisor/supervisor-store.js';
import { FlowStore } from '../flow/flow-store.js';
import { InterventionStore } from '../intervention/intervention-store.js';
import { buildCalibrationReport } from '../calibration/build-calibration-report.js';
import { calibrationShow, calibrationList } from '../api/calibration-api.js';
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
  queueStore.migrate(); supervisorStore.migrate();
  routingStore.migrate(); flowStore.migrate();
  interventionStore.migrate(); policyStore.migrate();
  outcomeStore.migrate(); calibrationStore.migrate();
  return { queueStore, supervisorStore, routingStore, flowStore, interventionStore, policyStore, outcomeStore, calibrationStore };
}

// ── Calibrate ────────────────────────────────────────────────────────

export function handoffCalibrateCommand(): Command {
  return new Command('calibrate')
    .description('Run calibration analysis on policy effectiveness')
    .option('--policy <policySetId>', 'Analyze specific policy version')
    .option('--lane <lane>', 'Focus on a specific lane')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = buildCalibrationReport(
          stores.outcomeStore, stores.routingStore, stores.policyStore, stores.calibrationStore,
          {
            policySetId: opts.policy,
            lane: opts.lane as RoutingLane | undefined,
          },
        );

        if (!result.ok) {
          if (opts.json) {
            console.log(JSON.stringify({ ok: false, error: result.error, code: result.code }));
          } else {
            console.error(`Calibration failed: ${result.error}`);
          }
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.report, null, 2));
        } else {
          const r = result.report;
          console.log(`Calibration Report: ${r.reportId}`);
          console.log(`  Policy: ${r.policySetId ?? 'defaults'} v${r.policyVersion ?? '-'}`);
          console.log(`  Outcomes: ${r.outcomeWindow.closedOutcomes} closed / ${r.outcomeWindow.totalOutcomes} total`);

          if (r.policyFitness) {
            const pf = r.policyFitness;
            console.log(`\nPolicy Fitness:`);
            console.log(`  Clean: ${pct(pf.cleanRate)}  Churn: ${pct(pf.churnRate)}  Recovery: ${pct(pf.recoveryRate)}  Intervention: ${pct(pf.interventionRate)}`);
            if (pf.meanLeadTimeMs !== null) console.log(`  Mean lead time: ${Math.round(pf.meanLeadTimeMs / 60000)}m`);
          }

          if (r.laneFitness.length > 0) {
            console.log(`\nLane Fitness:`);
            for (const lf of r.laneFitness) {
              if (lf.closedOutcomes === 0) continue;
              console.log(`  ${lf.lane}: ${lf.closedOutcomes} closed, clean ${pct(lf.cleanRate)}, churn ${pct(lf.churnRate)}`);
            }
          }

          if (r.painSignals.length > 0) {
            console.log(`\nPain Signals (${r.painSignals.length}):`);
            for (const s of r.painSignals) {
              const lane = s.lane ? ` [${s.lane}]` : '';
              console.log(`  [${s.severity.toUpperCase()}] ${s.code}${lane}: ${s.description}`);
            }
          }

          if (r.adjustments.length > 0) {
            console.log(`\nProposed Adjustments (${r.adjustments.length}):`);
            for (const a of r.adjustments) {
              const lane = a.lane ? ` [${a.lane}]` : '';
              console.log(`  ${a.kind}${lane}: ${a.field} ${JSON.stringify(a.currentValue)} → ${JSON.stringify(a.proposedValue)} (${a.confidence})`);
              console.log(`    ${a.rationale}`);
            }
          }

          console.log(`\nSummary: ${r.summary}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── Show ─────────────────────────────────────────────────────────────

export function handoffCalibrationShowCommand(): Command {
  return new Command('calibration-show')
    .description('Show a specific calibration report')
    .requiredOption('--id <reportId>', 'Report ID')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const result = calibrationShow(stores.calibrationStore, opts.id);
        if (!result.ok) {
          console.error(result.error);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.report, null, 2));
        } else {
          const r = result.report;
          console.log(`Report: ${r.reportId}`);
          console.log(`  Created: ${r.createdAt}`);
          console.log(`  Policy: ${r.policySetId ?? 'defaults'} v${r.policyVersion ?? '-'}`);
          console.log(`  Outcomes: ${r.outcomeWindow.closedOutcomes} closed`);
          console.log(`  Pain signals: ${r.painSignals.length}`);
          console.log(`  Adjustments: ${r.adjustments.length}`);
          console.log(`\nSummary: ${r.summary}`);
        }
      } finally {
        db.close();
      }
    });
}

// ── List ─────────────────────────────────────────────────────────────

export function handoffCalibrationsCommand(): Command {
  return new Command('calibrations')
    .description('List calibration reports')
    .option('--policy <policySetId>', 'Filter by policy')
    .option('--json', 'Output JSON')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const stores = migrateAll(db);

      try {
        const reports = calibrationList(stores.calibrationStore, { policySetId: opts.policy });

        if (opts.json) {
          console.log(JSON.stringify(reports, null, 2));
        } else {
          if (reports.length === 0) {
            console.log('No calibration reports');
            return;
          }
          for (const r of reports) {
            const pain = r.painSignals.length;
            const adj = r.adjustments.length;
            console.log(`${r.reportId} [${r.createdAt}] policy=${r.policySetId ?? 'defaults'} pain=${pain} adj=${adj}`);
          }
        }
      } finally {
        db.close();
      }
    });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}
