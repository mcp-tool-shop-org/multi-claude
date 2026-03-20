/**
 * Handoff Spine — CLI: handoff create
 */

import { Command } from 'commander';
import { openDb } from '../../db/connection.js';
import { HandoffStore } from '../store/handoff-store.js';
import { createHandoff } from '../api/create-handoff.js';
import type { LineageRelation } from '../schema/version.js';

export function handoffCreateCommand(): Command {
  return new Command('create')
    .description('Create a handoff packet from execution truth')
    .requiredOption('--run <runId>', 'Source run ID')
    .requiredOption('--project <projectId>', 'Project ID')
    .requiredOption('--summary <text>', 'State summary')
    .option('--lane <lane>', 'Lane: worker | reviewer | approver | recovery')
    .option('--repo-root <path>', 'Repository root path')
    .option('--parent <handoffId>', 'Parent handoff ID for lineage')
    .option('--relation <type>', 'Lineage relation: derived_from | supersedes | split_from | recovery_from', 'derived_from')
    .option('--instruction <text...>', 'Authoritative instructions (repeatable)')
    .option('--constraint <text...>', 'Constraints (repeatable)')
    .option('--prohibition <text...>', 'Prohibitions (repeatable)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const db = openDb(opts.dbPath);
      const store = new HandoffStore(db);
      store.migrate();

      try {
        const result = createHandoff(store, {
          projectId: opts.project,
          runId: opts.run,
          lane: opts.lane,
          repoRoot: opts.repoRoot,
          sourcePacketId: undefined,
          summary: opts.summary,
          instructions: {
            authoritative: opts.instruction ?? [],
            constraints: opts.constraint ?? [],
            prohibitions: opts.prohibition ?? [],
          },
          decisionSource: { approvals: [], contractDeltas: [] },
          rejectionSource: { rejectedApprovals: [], rejectedDeltas: [] },
          openLoopSource: {
            failedPacketIds: [],
            blockedPacketIds: [],
            pendingPacketIds: [],
            unresolvedGates: [],
          },
          artifactSource: { artifacts: [] },
          parentHandoffId: opts.parent,
          lineageRelation: opts.relation as LineageRelation,
        });

        console.log(JSON.stringify(result, null, 2));
      } finally {
        db.close();
      }
    });
}
