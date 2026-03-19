/**
 * console.ts — CLI surface for `multi-claude console`.
 *
 * Wires the read models (run-model, hook-feed, fitness-view),
 * the renderer, and the next-action engine into a single command.
 */

import { Command } from 'commander';
import { queryRunModel } from '../console/run-model.js';
import { queryHookFeed } from '../console/hook-feed.js';
import { queryFitnessView } from '../console/fitness-view.js';
import {
  renderConsole,
  renderRunOverview,
  renderPacketGraph,
  renderWorkerSessions,
  renderHooksAndGates,
  renderFitnessAndEvidence,
} from '../console/render.js';
import { computeNextAction } from '../console/next-action.js';
import { actionsSubcommand, actSubcommand, auditSubcommand } from './console-actions.js';
import { recoverSubcommand } from './console-recover.js';
import { outcomeSubcommand } from './console-outcome.js';
import { handoffSubcommand } from './console-handoff.js';
import {
  promoteCheckSubcommand,
  approveSubcommand,
  rejectSubcommand,
  approvalSubcommand,
} from './console-approval.js';
import { exportSubcommand } from './console-export.js';
import type { RunModel } from '../console/run-model.js';
import type { HookFeedResult } from '../console/hook-feed.js';
import type { FitnessViewResult } from '../console/fitness-view.js';
import type { NextAction } from '../console/next-action.js';

// ── Shared helpers ──────────────────────────────────────────────────

interface ConsoleOpts {
  run?: string;
  dbPath: string;
}

/**
 * Load run model — shared by all sub-commands.
 * Returns null if no run found (caller should print message and exit).
 */
function loadRunModel(opts: ConsoleOpts): RunModel | null {
  return queryRunModel(opts.dbPath, opts.run);
}

/**
 * Load all console data for a run model.
 */
function loadConsoleData(opts: ConsoleOpts, runModel: RunModel): {
  hookFeed: HookFeedResult;
  fitnessView: FitnessViewResult;
  nextAction: NextAction;
} {
  const hookFeed = queryHookFeed(opts.dbPath, runModel.overview.featureId);
  const fitnessView = queryFitnessView(
    opts.dbPath,
    runModel.overview.runId,
    runModel.overview.featureId,
  );
  const nextAction = computeNextAction(runModel, hookFeed);
  return { hookFeed, fitnessView, nextAction };
}

function noRunMessage(): void {
  console.log('No active run found.');
}

function formatNextActionText(na: NextAction): string {
  const lines: string[] = [];
  lines.push(`▶ Next: ${na.action}`);
  if (na.command) {
    lines.push(`  Command: ${na.command}`);
  }
  lines.push(`  Priority: ${na.priority}`);
  lines.push(`  Reason: ${na.reason}`);
  return lines.join('\n');
}

// ── Command builder ─────────────────────────────────────────────────

export function consoleCommand(): Command {
  const cmd = new Command('console')
    .description('Live run console — real-time visibility into active runs');

  // ── show: full console ─────────────────────────────────────────
  cmd.command('show')
    .description('Show full console for a run')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      const { hookFeed, fitnessView, nextAction } = loadConsoleData(opts, runModel);
      const output = renderConsole(runModel, hookFeed, fitnessView, nextAction.action);
      console.log(output);
    });

  // ── overview: run overview pane only ───────────────────────────
  cmd.command('overview')
    .description('Show run overview pane only')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      const { nextAction } = loadConsoleData(opts, runModel);
      console.log(renderRunOverview(runModel.overview, nextAction.action));
    });

  // ── packets: packet graph pane only ───────────────────────────
  cmd.command('packets')
    .description('Show packet graph pane only')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      console.log(renderPacketGraph(runModel.packets));
    });

  // ── workers: worker sessions pane only ─────────────────────────
  cmd.command('workers')
    .description('Show worker sessions pane only')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      console.log(renderWorkerSessions(runModel.workers));
    });

  // ── hooks: hooks and gates pane only ──────────────────────────
  cmd.command('hooks')
    .description('Show hooks and gates pane only')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      const hookFeed = queryHookFeed(opts.dbPath, runModel.overview.featureId);
      console.log(renderHooksAndGates(hookFeed, runModel.gates));
    });

  // ── fitness: fitness and evidence pane only ────────────────────
  cmd.command('fitness')
    .description('Show fitness and evidence pane only')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts: ConsoleOpts) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      const fitnessView = queryFitnessView(
        opts.dbPath,
        runModel.overview.runId,
        runModel.overview.featureId,
      );
      console.log(renderFitnessAndEvidence(fitnessView));
    });

  // ── next: next lawful action ──────────────────────────────────
  cmd.command('next')
    .description('Show next lawful action')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: ConsoleOpts & { json?: boolean }) => {
      const runModel = loadRunModel(opts);
      if (!runModel) { noRunMessage(); return; }

      const hookFeed = queryHookFeed(opts.dbPath, runModel.overview.featureId);
      const nextAction = computeNextAction(runModel, hookFeed);

      if (opts.json) {
        console.log(JSON.stringify({
          action: nextAction.action,
          command: nextAction.command,
          priority: nextAction.priority,
          reason: nextAction.reason,
        }, null, 2));
      } else {
        console.log(formatNextActionText(nextAction));
      }
    });

  // ── actions: list available operator actions ────────────────────
  cmd.addCommand(actionsSubcommand());

  // ── act: execute an operator action ────────────────────────────
  cmd.addCommand(actSubcommand());

  // ── audit: operator audit trail ────────────────────────────────
  cmd.addCommand(auditSubcommand());

  // ── recover: guided recovery ──────────────────────────────────
  cmd.addCommand(recoverSubcommand());

  // ── outcome: run closure / outcome ──────────────────────────────
  cmd.addCommand(outcomeSubcommand());

  // ── handoff: delivery evidence / handoff ───────────────────────
  cmd.addCommand(handoffSubcommand());

  // ── promote-check: promotion eligibility ──────────────────────
  cmd.addCommand(promoteCheckSubcommand());

  // ── approve: approve run for promotion ────────────────────────
  cmd.addCommand(approveSubcommand());

  // ── reject: reject run for promotion ──────────────────────────
  cmd.addCommand(rejectSubcommand());

  // ── approval: current approval status ─────────────────────────
  cmd.addCommand(approvalSubcommand());

  // ── export: downstream integration ────────────────────────────
  cmd.addCommand(exportSubcommand());

  // ── watch: auto-refresh console ───────────────────────────────
  cmd.command('watch')
    .description('Watch console with auto-refresh (2s intervals)')
    .option('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--interval <ms>', 'Refresh interval in ms', '2000')
    .action((opts: ConsoleOpts & { interval: string }) => {
      const intervalMs = parseInt(opts.interval, 10) || 2000;

      function render(): void {
        const runModel = loadRunModel(opts);
        if (!runModel) {
          // Clear screen + print no run message
          process.stdout.write('\x1B[2J\x1B[H');
          console.log('No active run found. Waiting...');
          return;
        }

        const { hookFeed, fitnessView, nextAction } = loadConsoleData(opts, runModel);
        const output = renderConsole(runModel, hookFeed, fitnessView, nextAction.action);

        // Clear screen and move cursor to top-left
        process.stdout.write('\x1B[2J\x1B[H');
        console.log(output);
      }

      // Initial render
      render();

      // Set up interval
      const timer = setInterval(render, intervalMs);

      // Handle SIGINT gracefully
      const cleanup = (): void => {
        clearInterval(timer);
        console.log('\nConsole watch stopped.');
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });

  return cmd;
}
