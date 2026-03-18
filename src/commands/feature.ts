import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { isKebabCase, generateId, nowISO } from '../lib/ids.js';
import { isValidFeatureTransition, isFeatureTerminal } from '../lib/transitions.js';
import type { McfResult, FeatureStatus } from '../types/common.js';

export interface FeatureCreateResult {
  feature_id: string;
  status: FeatureStatus;
}

export interface FeatureApproveResult {
  feature_id: string;
  approval_id: string;
  status: FeatureStatus;
}

export function runFeatureCreate(
  dbPath: string,
  featureId: string,
  title: string,
  objective: string,
  criteria: string[],
  repoSlug: string,
  priority = 'normal',
  mergeTarget = 'main',
  constitutionRefs: string[] = [],
): McfResult<FeatureCreateResult> {
  if (!isKebabCase(featureId)) {
    return mcfError('mcf feature create', ERR.INVALID_ID, `Feature ID must be kebab-case: ${featureId}`, { feature_id: featureId });
  }
  if (criteria.length === 0) {
    return mcfError('mcf feature create', ERR.NO_CRITERIA, 'At least one acceptance criterion required', {});
  }

  const db = openDb(dbPath);
  try {
    const existing = db.prepare('SELECT feature_id FROM features WHERE feature_id = ?').get(featureId);
    if (existing) {
      return mcfError('mcf feature create', ERR.DUPLICATE_FEATURE, `Feature '${featureId}' already exists`, { feature_id: featureId });
    }

    const now = nowISO();
    const transitionId = generateId('tr');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO features (feature_id, repo_slug, title, objective, status, priority, merge_target, constitution_refs, acceptance_criteria, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?, 'human', ?, ?)
      `).run(featureId, repoSlug, title, objective, priority, mergeTarget, JSON.stringify(constitutionRefs), JSON.stringify(criteria), now, now);

      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'feature', ?, NULL, 'proposed', 'human', 'cli', 'feature created', ?)
      `).run(transitionId, featureId, now);
    })();

    return {
      ok: true,
      command: 'mcf feature create',
      result: { feature_id: featureId, status: 'proposed' },
      transitions: [{ entity_type: 'feature', entity_id: featureId, from_state: null, to_state: 'proposed' }],
    };
  } finally {
    db.close();
  }
}

export function runFeatureApprove(
  dbPath: string,
  featureId: string,
  actor: string,
  rationale?: string,
): McfResult<FeatureApproveResult> {
  const db = openDb(dbPath);
  try {
    const feature = db.prepare('SELECT feature_id, status FROM features WHERE feature_id = ?').get(featureId) as { feature_id: string; status: FeatureStatus } | undefined;

    if (!feature) {
      return mcfError('mcf feature approve', ERR.FEATURE_NOT_FOUND, `Feature '${featureId}' not found`, { feature_id: featureId });
    }
    if (isFeatureTerminal(feature.status)) {
      return mcfError('mcf feature approve', ERR.TERMINAL_STATE, `Feature '${featureId}' is in terminal state '${feature.status}'`, { feature_id: featureId, current_status: feature.status });
    }
    if (feature.status !== 'proposed') {
      return mcfError('mcf feature approve', ERR.INVALID_STATE, `Feature '${featureId}' is '${feature.status}', expected 'proposed'`, { feature_id: featureId, current_status: feature.status });
    }

    const now = nowISO();
    const approvalId = generateId('apr');
    const transitionId = generateId('tr');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor, rationale, created_at)
        VALUES (?, 'feature', ?, 'feature_approval', 'approved', ?, ?, ?)
      `).run(approvalId, featureId, actor, rationale ?? null, now);

      db.prepare(`
        UPDATE features SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
        WHERE feature_id = ?
      `).run(actor, now, now, featureId);

      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'feature', ?, 'proposed', 'approved', 'human', ?, 'feature approved', ?)
      `).run(transitionId, featureId, actor, now);
    })();

    return {
      ok: true,
      command: 'mcf feature approve',
      result: { feature_id: featureId, approval_id: approvalId, status: 'approved' },
      transitions: [{ entity_type: 'feature', entity_id: featureId, from_state: 'proposed', to_state: 'approved' }],
    };
  } finally {
    db.close();
  }
}

export function featureCommand(): Command {
  const cmd = new Command('feature').description('Manage features');

  cmd.command('create')
    .description('Create a new feature')
    .requiredOption('--id <id>', 'Feature ID (kebab-case)')
    .requiredOption('--title <title>', 'Human-readable title')
    .requiredOption('--objective <objective>', 'What this feature must deliver')
    .requiredOption('--repo <slug>', 'Repo slug')
    .option('--criteria <criteria...>', 'Acceptance criteria', [])
    .option('--priority <priority>', 'Priority level', 'normal')
    .option('--merge-target <branch>', 'Merge target branch', 'main')
    .option('--constitution-refs <refs...>', 'Constitution references', [])
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runFeatureCreate(
        opts.dbPath, opts.id, opts.title, opts.objective,
        opts.criteria, opts.repo, opts.priority, opts.mergeTarget, opts.constitutionRefs,
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('approve')
    .description('Approve a feature for execution')
    .requiredOption('--feature <id>', 'Feature ID')
    .requiredOption('--actor <name>', 'Human identity')
    .option('--rationale <text>', 'Why approved')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runFeatureApprove(opts.dbPath, opts.feature, opts.actor, opts.rationale);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
