/**
 * Handoff Spine — CLI: handoff decide
 *
 * multi-claude handoff decide --id <handoffId> --action approve|reject|request-recovery
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { createDecisionBrief } from '../api/create-decision-brief.js';
import { bindDecisionAction } from '../decision/bind-decision-action.js';
import type { DecisionAction } from '../decision/types.js';
import type { ModelAdapterName } from '../api/render-handoff.js';

export function handoffDecideCommand(): Command {
  return new Command('decide')
    .description('Take a decision action on a handoff packet')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .requiredOption('--action <action>', 'Action: approve | reject | request-recovery | needs-review')
    .requiredOption('--actor <actor>', 'Who is taking the action')
    .requiredOption('--reason <reason>', 'Why this action is being taken')
    .option('--model <model>', 'Model adapter: claude | gpt | ollama', 'claude')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        // Step 1: Generate approver brief (decision actions are approver-lane)
        const briefResult = createDecisionBrief(store, {
          handoffId: opts.id,
          role: 'approver',
          model: opts.model as ModelAdapterName,
        });

        if (!briefResult.ok) {
          console.error(`Brief generation failed: ${briefResult.error}`);
          process.exit(1);
        }

        // Step 2: Bind the action
        const bindResult = bindDecisionAction(store, {
          brief: briefResult.brief,
          action: opts.action as DecisionAction,
          actor: opts.actor,
          reason: opts.reason,
          renderEventId: briefResult.renderEventId,
        });

        if (!bindResult.ok) {
          console.error(`Action binding failed: ${bindResult.error}`);
          process.exit(1);
        }

        console.log(JSON.stringify({
          action: bindResult.record.action,
          actionId: bindResult.record.actionId,
          handoffId: bindResult.record.handoffId,
          packetVersion: bindResult.record.packetVersion,
          evidenceFingerprint: bindResult.record.evidenceFingerprint,
          briefId: bindResult.record.briefId,
          actor: bindResult.record.actor,
          decidedAt: bindResult.record.decidedAt,
        }, null, 2));
      } finally {
        db.close();
      }
    });
}
