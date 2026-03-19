import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import type { PlannerInput, WorkClass, CouplingLevel, OwnershipClarity, RepoStability, ObjectivePriority } from '../planner/types.js';

export function planCommand(): Command {
  const cmd = new Command('plan').description('Run planner — assess fitness and generate recommendations');

  cmd.command('evaluate')
    .description('Evaluate a proposed run for multi-claude fitness')
    .requiredOption('--work-class <class>', 'Work class: backend_state | ui_interaction | control_plane')
    .requiredOption('--packets <count>', 'Number of packets', parseInt)
    .option('--coupling <level>', 'Coupling level: low | moderate | high', 'moderate')
    .option('--ownership <clarity>', 'Ownership clarity: clear | mixed | unclear', 'clear')
    .option('--stability <level>', 'Repo stability: stable | settling | unstable', 'stable')
    .option('--objective <priority>', 'Objective: speed | quality | balanced', 'balanced')
    .option('--seam-density <density>', 'Seam density: low | moderate | high')
    .action(async (opts) => {
      try {
        const { evaluateRun } = await import('../planner/service.js');

        const input: PlannerInput = {
          workClass: opts.workClass as WorkClass,
          packetCount: opts.packets as number,
          couplingLevel: opts.coupling as CouplingLevel,
          ownershipClarity: opts.ownership as OwnershipClarity,
          repoStability: opts.stability as RepoStability,
          objectivePriority: opts.objective as ObjectivePriority,
          seamDensity: opts.seamDensity as 'low' | 'moderate' | 'high' | undefined,
        };

        const result = evaluateRun(input);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude plan evaluate', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude plan evaluate', error: message }));
        process.exit(1);
      }
    });

  cmd.command('show')
    .description('Show a saved plan from JSON file')
    .requiredOption('--file <path>', 'Plan JSON file path')
    .action((opts) => {
      try {
        const raw = readFileSync(opts.file, 'utf-8');
        const plan = JSON.parse(raw);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude plan show', result: plan }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude plan show', error: message }));
        process.exit(1);
      }
    });

  cmd.command('override')
    .description('Override a plan assessment with human rationale')
    .requiredOption('--file <path>', 'Plan JSON file path')
    .requiredOption('--rationale <text>', 'Human rationale for override')
    .action(async (opts) => {
      try {
        const { overridePlan } = await import('../planner/service.js');

        const raw = readFileSync(opts.file, 'utf-8');
        const plan = JSON.parse(raw);
        const result = overridePlan(plan, opts.rationale);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude plan override', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude plan override', error: message }));
        process.exit(1);
      }
    });

  cmd.command('freeze')
    .description('Freeze a plan (make immutable)')
    .requiredOption('--file <path>', 'Plan JSON file path')
    .action(async (opts) => {
      try {
        const { freezePlan } = await import('../planner/service.js');

        const raw = readFileSync(opts.file, 'utf-8');
        const plan = JSON.parse(raw);
        const result = freezePlan(plan);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude plan freeze', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude plan freeze', error: message }));
        process.exit(1);
      }
    });

  return cmd;
}
