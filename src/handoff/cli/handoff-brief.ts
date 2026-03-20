/**
 * Handoff Spine — CLI: handoff brief
 *
 * multi-claude handoff brief --id <handoffId> --role reviewer|approver
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { createDecisionBrief } from '../api/create-decision-brief.js';
import type { DecisionRole } from '../decision/types.js';
import type { ModelAdapterName } from '../api/render-handoff.js';

export function handoffBriefCommand(): Command {
  return new Command('brief')
    .description('Generate a decision brief for a handoff packet')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .requiredOption('--role <role>', 'Role: reviewer | approver')
    .option('--model <model>', 'Model adapter: claude | gpt | ollama', 'claude')
    .option('--json', 'Output raw JSON instead of rendered text')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = createDecisionBrief(store, {
          handoffId: opts.id,
          role: opts.role as DecisionRole,
          model: opts.model as ModelAdapterName,
        });

        if (!result.ok) {
          console.error(`Brief generation failed: ${result.error}`);
          process.exit(1);
        }

        if (opts.json) {
          console.log(JSON.stringify(result.brief, null, 2));
        } else {
          console.log(result.renderedText);
        }
      } finally {
        db.close();
      }
    });
}
