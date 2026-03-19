import { Command } from 'commander';
import { scoreRun } from '../fitness/engine.js';
import { METRIC_REGISTRY, validateRegistryWeights } from '../fitness/metrics.js';
import { openDb } from '../db/connection.js';

export function fitnessCommand(): Command {
  const cmd = new Command('fitness').description('Factory fitness scoring');

  cmd.command('score')
    .description('Compute fitness score for a run')
    .requiredOption('--run <id>', 'Run ID (from auto run)')
    .requiredOption('--feature <id>', 'Feature ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = scoreRun(opts.dbPath, opts.run, opts.feature);
      console.log(JSON.stringify({
        ok: true,
        command: 'multi-claude fitness score',
        result: {
          grade: result.grade,
          overall: result.overall,
          quality: `${result.quality}/40`,
          lawfulness: `${result.lawfulness}/25`,
          collaboration: `${result.collaboration}/20`,
          velocity: `${result.velocity}/15`,
          penalties: result.penalties,
          packets: result.packets.map(p => ({
            id: p.packetId,
            stage: p.maturationStage,
            points: p.maturedPoints,
            withinBudget: p.withinBudget,
          })),
        },
      }, null, 2));
    });

  cmd.command('explain')
    .description('Explain score breakdown for a run')
    .requiredOption('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      try {
        const score = db.prepare('SELECT * FROM run_scores WHERE run_id = ?').get(opts.run) as Record<string, unknown> | undefined;
        if (!score) {
          console.log(JSON.stringify({ ok: false, error: `No score found for run ${opts.run}. Run 'fitness score' first.` }));
          process.exit(1);
        }

        const packetScores = db.prepare('SELECT * FROM packet_scores WHERE run_id = ? ORDER BY packet_id').all(opts.run) as Array<Record<string, unknown>>;

        console.log(JSON.stringify({
          ok: true,
          command: 'multi-claude fitness explain',
          result: {
            run: {
              runId: score.run_id,
              grade: score.grade,
              total: score.total_score,
              quality: score.quality_score,
              lawfulness: score.lawfulness_score,
              collaboration: score.collaboration_score,
              velocity: score.velocity_score,
              penalties: JSON.parse(score.penalties_json as string),
              scoringVersion: score.scoring_version,
              computedAt: score.computed_at,
            },
            packets: packetScores.map(p => ({
              packetId: p.packet_id,
              class: p.packet_class,
              stage: p.maturation_stage,
              submit: p.submit_score,
              verify: p.verify_score,
              integrate: p.integrate_score,
              penalties: p.penalties,
              final: p.final_score,
              durationSec: p.duration_seconds,
            })),
            metricWeights: {
              quality: '40 (verified completion, integration success, build/test pass, reopen rate, reconciliation)',
              lawfulness: '25 (transition compliance, envelope completeness, stop correctness, hook coverage, artifact validity)',
              collaboration: '20 (rescue rate, merge friction, downstream success, verifier finds, knowledge reuse)',
              velocity: '15 (duration vs budget, time to verified, time to integrated, queue latency)',
            },
          },
        }, null, 2));
      } finally {
        db.close();
      }
    });

  cmd.command('metrics')
    .description('Show all registered fitness metrics')
    .action(() => {
      const validation = validateRegistryWeights();
      console.log(JSON.stringify({
        ok: true,
        command: 'multi-claude fitness metrics',
        result: {
          totalMetrics: METRIC_REGISTRY.length,
          weightsValid: validation.valid,
          weightErrors: validation.errors,
          metrics: METRIC_REGISTRY.map(m => ({
            key: m.key,
            bucket: m.bucket,
            weight: m.weight,
            direction: m.direction,
            description: m.description,
          })),
        },
      }, null, 2));
    });

  cmd.command('validate')
    .description('Validate metric registry integrity')
    .action(() => {
      const validation = validateRegistryWeights();
      if (validation.valid) {
        console.log(JSON.stringify({ ok: true, message: 'Metric registry weights are valid. Quality=40, Lawfulness=25, Collaboration=20, Velocity=15.' }));
      } else {
        console.log(JSON.stringify({ ok: false, errors: validation.errors }));
        process.exit(1);
      }
    });

  return cmd;
}
