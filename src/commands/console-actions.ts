/**
 * console-actions.ts — CLI sub-commands for operator actions on active runs.
 *
 * Exports three sub-command builders that are registered
 * on the parent `console` command:
 *   - `console actions`  — list all available actions
 *   - `console act <action>` — execute a specific action
 *   - `console audit`    — show operator audit trail
 */

import { Command } from 'commander';
import { queryRunModel } from '../console/run-model.js';
import { queryHookFeed } from '../console/hook-feed.js';
import {
  computeAllActions,
} from '../console/action-availability.js';
import type { ActionAvailability } from '../console/action-availability.js';
import { executeAction } from '../console/action-executor.js';
import type { ActionResult } from '../console/action-executor.js';
export type { ActionResult };
import { queryAuditTrail } from '../console/audit-trail.js';
import type { AuditEntry } from '../console/audit-trail.js';
import { computeNextAction } from '../console/next-action.js';

// ── Render helpers ──────────────────────────────────────────────────

/**
 * Render all available/unavailable actions for a run.
 */
export function renderActions(actions: ActionAvailability[]): string {
  const lines: string[] = [];
  lines.push('═══ AVAILABLE ACTIONS ═══');

  if (actions.length === 0) {
    lines.push('  (no actions available)');
    return lines.join('\n');
  }

  // Separate available vs unavailable for grouping, but they
  // come pre-sorted from computeAllActions (available first).
  let hasHookDecisions = false;

  for (const a of actions) {
    const sym = a.available ? '✓' : '✗';
    lines.push(`  ${sym} ${a.action} (${a.targetId})`);

    if (a.available && a.command) {
      lines.push(`    Command: ${a.command}`);
    }

    lines.push(`    Reason: ${a.reason}`);

    // Show preconditions for unavailable actions
    if (!a.available && a.preconditions.length > 0) {
      lines.push('    Preconditions:');
      for (const p of a.preconditions) {
        const pSym = p.met ? '✓' : '✗';
        let line = `      ${pSym} ${p.check}`;
        if (!p.met) {
          line += ` — ${p.detail}`;
        }
        lines.push(line);
      }
    }

    lines.push('');

    if (a.targetType === 'hook_decision') {
      hasHookDecisions = true;
    }
  }

  // If no pending hook decisions, note it
  if (!hasHookDecisions) {
    lines.push('  ◌ No pending hook decisions to resolve');
  }

  return lines.join('\n');
}

/**
 * Render the result of executing an action.
 */
export function renderActionResult(result: ActionResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(`✓ Action: ${result.action}`);
    lines.push(`  Target: ${result.targetId}`);
    lines.push(`  Before: ${result.beforeState} → After: ${result.afterState}`);
    if (result.auditId) {
      lines.push(`  Audit: ${result.auditId}`);
    }
  } else {
    lines.push(`✗ Action: ${result.action}`);
    lines.push(`  Target: ${result.targetId}`);
    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }

    const failedPreconditions = result.preconditions.filter(p => !p.met);
    if (failedPreconditions.length > 0) {
      lines.push('');
      lines.push('  Preconditions that failed:');
      for (const p of failedPreconditions) {
        lines.push(`    ✗ ${p.check} — ${p.detail}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Render the operator audit trail.
 */
export function renderAuditTrail(entries: AuditEntry[]): string {
  const lines: string[] = [];
  lines.push('═══ OPERATOR AUDIT TRAIL ═══');

  if (entries.length === 0) {
    lines.push('  (no audit entries)');
    return lines.join('\n');
  }

  for (const entry of entries) {
    const ts = formatAuditTimestamp(entry.timestamp);
    const transition = `${entry.beforeState} → ${entry.afterState}`;
    lines.push(`  [${ts}] ${entry.action} → ${entry.targetId} (${transition}) by ${entry.actor}`);
    if (entry.reason) {
      lines.push(`    Reason: ${entry.reason}`);
    }
    if (!entry.success && entry.error) {
      lines.push(`    Error: ${entry.error}`);
    }
  }

  return lines.join('\n');
}

function formatAuditTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch {
    return iso.slice(11, 19) || iso;
  }
}

// ── Sub-command: console actions ─────────────────────────────────────

export function actionsSubcommand(): Command {
  return new Command('actions')
    .description('Show all available actions for the current run')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: { run?: string; dbPath: string; json?: boolean }) => {
      const runModel = queryRunModel(opts.dbPath, opts.run);
      if (!runModel) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found', actions: [] }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      const hookFeed = queryHookFeed(opts.dbPath, runModel.overview.featureId);
      const actions = computeAllActions(runModel, hookFeed);

      if (opts.json) {
        console.log(JSON.stringify({ actions }, null, 2));
      } else {
        console.log(renderActions(actions));
      }
    });
}

// ── Sub-command: console act <action> ────────────────────────────────

export function actSubcommand(): Command {
  return new Command('act')
    .description('Execute a specific operator action')
    .argument('<action>', 'Action to execute (e.g. stop_run, retry_packet, approve_gate, resolve_hook)')
    .option('--target <id>', 'Target entity ID')
    .option('--actor <name>', 'Actor name', 'operator')
    .option('--reason <text>', 'Reason for the action')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((action: string, opts: {
      target?: string;
      actor: string;
      reason?: string;
      run?: string;
      dbPath: string;
      json?: boolean;
    }) => {
      const runModel = queryRunModel(opts.dbPath, opts.run);
      if (!runModel) {
        if (opts.json) {
          console.log(JSON.stringify({ error: 'No active run found' }, null, 2));
        } else {
          console.log('No active run found.');
        }
        process.exitCode = 1;
        return;
      }

      const targetId = opts.target ?? runModel.overview.runId;
      const reason = opts.reason ?? `Operator action: ${action}`;

      // Execute the action (checks availability internally)
      const result = executeAction(opts.dbPath, action, targetId, opts.actor, reason);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(renderActionResult(result));

        if (result.success) {
          // Re-query for updated next action
          const updatedModel = queryRunModel(opts.dbPath, opts.run);
          if (updatedModel) {
            const hookFeed = queryHookFeed(opts.dbPath, updatedModel.overview.featureId);
            const nextAction = computeNextAction(updatedModel, hookFeed);
            console.log('');
            console.log(`▶ Next: ${nextAction.action}`);
          }
        }
      }

      if (!result.success) {
        process.exitCode = 1;
      }
    });
}

// ── Sub-command: console audit ───────────────────────────────────────

export function auditSubcommand(): Command {
  return new Command('audit')
    .description('Show recent operator intervention audit trail')
    .option('--limit <n>', 'Max entries to show', '20')
    .option('--action <filter>', 'Filter by action type')
    .option('--target-type <filter>', 'Filter by target type')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .option('--json', 'Output as JSON')
    .action((opts: {
      limit: string;
      action?: string;
      targetType?: string;
      dbPath: string;
      json?: boolean;
    }) => {
      const limit = parseInt(opts.limit, 10) || 20;

      const entries = queryAuditTrail(opts.dbPath, {
        limit,
        action: opts.action,
        targetType: opts.targetType,
      });

      if (opts.json) {
        console.log(JSON.stringify({ entries }, null, 2));
      } else {
        console.log(renderAuditTrail(entries));
      }
    });
}
