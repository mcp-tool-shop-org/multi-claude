/**
 * Handoff Spine — CLI: handoff render
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { renderHandoff, type ModelAdapterName } from '../api/render-handoff.js';
import type { HandoffLane } from '../schema/packet.js';

export function handoffRenderCommand(): Command {
  return new Command('render')
    .description('Render a handoff packet for a specific role and model')
    .requiredOption('--id <handoffId>', 'Handoff packet ID')
    .requiredOption('--role <role>', 'Role: worker | reviewer | approver | recovery')
    .requiredOption('--model <model>', 'Model adapter: claude | gpt | ollama')
    .option('--version <n>', 'Specific version (default: current)', parseInt)
    .option('--token-budget <n>', 'Token budget limit', parseInt)
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = renderHandoff(store, {
          handoffId: opts.id,
          version: opts.version,
          role: opts.role as HandoffLane,
          model: opts.model as ModelAdapterName,
          tokenBudget: opts.tokenBudget,
        });

        console.log(JSON.stringify(result, null, 2));
        if (!result.ok) process.exit(1);
      } finally {
        db.close();
      }
    });
}
