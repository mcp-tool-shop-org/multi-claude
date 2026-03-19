import { Command } from 'commander';
import { readFileSync } from 'node:fs';

export function blueprintCommand(): Command {
  const cmd = new Command('blueprint').description('Packet graph freeze — generate and freeze lawful blueprints');

  cmd.command('init')
    .description('Generate a RunBlueprint from a plan')
    .requiredOption('--template <id>', 'Template ID: backend_law | ui_seam | control_plane')
    .requiredOption('--repo <path>', 'Repository root path')
    .option('--plan-file <path>', 'Plan JSON file to use as source')
    .action(async (opts) => {
      try {
        const { initBlueprint } = await import('../planner/freeze.js');

        let plan;
        if (opts.planFile) {
          const raw = readFileSync(opts.planFile, 'utf-8');
          plan = JSON.parse(raw);
        } else {
          // Minimal stub plan — caller is expected to provide --plan-file in production
          plan = {
            id: `plan-${Date.now()}`,
            createdAt: new Date().toISOString(),
            version: 1,
            input: { workClass: 'backend_state', packetCount: 1 },
            assessment: { mode: 'multi_claude', fitLevel: 'moderate', reasons: [] },
            frozen: false,
          };
        }

        const result = initBlueprint(plan, opts.template, opts.repo);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude blueprint init', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude blueprint init', error: message }));
        process.exit(1);
      }
    });

  cmd.command('validate')
    .description('Validate a blueprint for readiness')
    .requiredOption('--file <path>', 'Blueprint JSON file path')
    .action(async (opts) => {
      try {
        const { validateBlueprint } = await import('../planner/freeze.js');

        const raw = readFileSync(opts.file, 'utf-8');
        const blueprint = JSON.parse(raw);
        const result = validateBlueprint(blueprint);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude blueprint validate', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude blueprint validate', error: message }));
        process.exit(1);
      }
    });

  cmd.command('freeze')
    .description('Freeze a validated blueprint')
    .requiredOption('--file <path>', 'Blueprint JSON file path')
    .action(async (opts) => {
      try {
        const { freezeBlueprint } = await import('../planner/freeze.js');

        const raw = readFileSync(opts.file, 'utf-8');
        const blueprint = JSON.parse(raw);
        const result = freezeBlueprint(blueprint);
        console.log(JSON.stringify({ ok: true, command: 'multi-claude blueprint freeze', result }, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude blueprint freeze', error: message }));
        process.exit(1);
      }
    });

  cmd.command('render')
    .description('Render a frozen blueprint as markdown contract freeze doc')
    .requiredOption('--file <path>', 'Blueprint JSON file path')
    .action(async (opts) => {
      try {
        const { renderContractFreeze } = await import('../planner/freeze.js');

        const raw = readFileSync(opts.file, 'utf-8');
        const blueprint = JSON.parse(raw);
        const result = renderContractFreeze(blueprint);
        console.log(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(JSON.stringify({ ok: false, command: 'multi-claude blueprint render', error: message }));
        process.exit(1);
      }
    });

  return cmd;
}
