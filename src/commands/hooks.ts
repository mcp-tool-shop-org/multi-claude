import { Command } from 'commander';
import { emitHookEvent, getRecentDecisions, resolveDecision } from '../hooks/engine.js';
import type { HookEventPayload } from '../hooks/events.js';
import type { PolicyMode } from '../hooks/policy.js';

export function hooksCommand(): Command {
  const cmd = new Command('hooks').description('Hook policy engine — automatic multi-claude activation');

  cmd.command('evaluate')
    .description('Evaluate hook policy for an event')
    .requiredOption('--event <event>', 'Event type (e.g. packet.verified, feature.approved)')
    .requiredOption('--entity-type <type>', 'Entity type (feature, packet, wave, approval)')
    .requiredOption('--entity-id <id>', 'Entity ID')
    .requiredOption('--feature <id>', 'Feature ID')
    .option('--mode <mode>', 'Policy mode: advisory or autonomous', 'advisory')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = emitHookEvent(
        opts.dbPath,
        opts.event as HookEventPayload['event'],
        opts.entityType as HookEventPayload['entityType'],
        opts.entityId,
        opts.feature,
        opts.mode as PolicyMode,
      );

      if (result.decision) {
        console.log(JSON.stringify({
          ok: true,
          command: 'multi-claude hooks evaluate',
          result: {
            decision_id: result.log.id,
            event: result.log.event,
            rule_matched: result.log.ruleMatched,
            action: result.decision.action,
            packets: result.decision.packets,
            role: result.decision.role,
            model: result.decision.model,
            reason: result.decision.reason,
            requires_human_approval: result.decision.requiresHumanApproval,
            mode: result.log.mode,
            operator_decision: result.log.operatorDecision,
          },
          transitions: [],
        }, null, 2));
      } else {
        console.log(JSON.stringify({
          ok: true,
          command: 'multi-claude hooks evaluate',
          result: {
            decision_id: result.log.id,
            event: result.log.event,
            rule_matched: null,
            action: null,
            reason: 'No policy rule matched',
          },
          transitions: [],
        }, null, 2));
      }
    });

  cmd.command('log')
    .description('Show recent hook decisions')
    .option('--limit <n>', 'Number of decisions', '20')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const decisions = getRecentDecisions(opts.dbPath, parseInt(opts.limit, 10));
      console.log(JSON.stringify({
        ok: true,
        command: 'multi-claude hooks log',
        result: { decisions, count: decisions.length },
        transitions: [],
      }, null, 2));
    });

  cmd.command('resolve')
    .description('Confirm or reject a hook decision')
    .requiredOption('--decision <id>', 'Decision ID')
    .requiredOption('--resolution <r>', 'confirmed or rejected')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const ok = resolveDecision(opts.dbPath, opts.decision, opts.resolution as 'confirmed' | 'rejected');
      console.log(JSON.stringify({
        ok,
        command: 'multi-claude hooks resolve',
        result: { decision_id: opts.decision, resolution: opts.resolution },
        transitions: [],
      }, null, 2));
    });

  return cmd;
}
