import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import { isFeatureTerminal } from '../lib/transitions.js';
import type { McfResult, ApprovalScopeType, ApprovalType, ApprovalDecision } from '../types/common.js';

const VALID_SCOPE_TYPE_COMBOS: Record<string, string[]> = {
  feature: ['feature_approval', 'merge_approval'],
  packet: ['protected_file_change'],
  packet_graph: ['packet_graph_approval'],
  contract_delta: ['contract_delta_approval', 'protected_file_change'],
  integration_run: ['merge_approval'],
  amendment: ['amendment_approval'],
  law_amendment: ['law_amendment'],
  exception: ['exception'],
};

export interface ApproveResult {
  approval_id: string;
  scope_type: string;
  scope_id: string;
  decision: string;
  side_effects: string[];
}

export function runApprove(
  dbPath: string,
  scopeType: ApprovalScopeType,
  scopeId: string,
  approvalType: ApprovalType,
  decision: ApprovalDecision,
  actor: string,
  rationale?: string,
  conditions?: string,
): McfResult<ApproveResult> {
  const db = openDb(dbPath);
  try {
    // 1. Validate scope_type and approval_type compatibility
    const validTypes = VALID_SCOPE_TYPE_COMBOS[scopeType];
    if (!validTypes || !validTypes.includes(approvalType)) {
      return mcfError('multi-claude approve', ERR.TYPE_MISMATCH,
        `Approval type '${approvalType}' is not valid for scope type '${scopeType}'`,
        { scope_type: scopeType, approval_type: approvalType, valid_types: validTypes ?? [] },
      );
    }

    // 2. Verify the scope entity exists and is not terminal
    if (scopeType === 'feature') {
      const feature = db.prepare('SELECT status FROM features WHERE feature_id = ?').get(scopeId) as { status: string } | undefined;
      if (!feature) return mcfError('multi-claude approve', ERR.SCOPE_NOT_FOUND, `Feature '${scopeId}' not found`, { scope_id: scopeId });
      if (isFeatureTerminal(feature.status as any)) {
        return mcfError('multi-claude approve', ERR.TERMINAL_STATE, `Feature '${scopeId}' is in terminal state '${feature.status}'`, { scope_id: scopeId, status: feature.status });
      }
    } else if (scopeType === 'packet' || scopeType === 'packet_graph') {
      // For packet_graph, scope_id is the feature_id
      const target = scopeType === 'packet'
        ? db.prepare('SELECT status FROM packets WHERE packet_id = ?').get(scopeId)
        : db.prepare('SELECT status FROM features WHERE feature_id = ?').get(scopeId);
      if (!target) return mcfError('multi-claude approve', ERR.SCOPE_NOT_FOUND, `Entity '${scopeId}' not found`, { scope_id: scopeId });
    } else if (scopeType === 'contract_delta') {
      const delta = db.prepare('SELECT status FROM contract_deltas WHERE contract_delta_id = ?').get(scopeId) as { status: string } | undefined;
      if (!delta) return mcfError('multi-claude approve', ERR.SCOPE_NOT_FOUND, `Contract delta '${scopeId}' not found`, { scope_id: scopeId });
    } else if (scopeType === 'amendment') {
      const amendment = db.prepare('SELECT status FROM packet_amendments WHERE amendment_id = ?').get(scopeId) as { status: string } | undefined;
      if (!amendment) return mcfError('multi-claude approve', ERR.SCOPE_NOT_FOUND, `Amendment '${scopeId}' not found`, { scope_id: scopeId });
    }
    // integration_run, law_amendment, exception: no entity validation needed pre-creation

    // 3. Conditions required for approved_with_conditions
    if (decision === 'approved_with_conditions' && !conditions) {
      return mcfError('multi-claude approve', ERR.CONDITIONS_REQUIRED, 'Decision "approved_with_conditions" requires conditions', {});
    }

    const now = nowISO();
    const approvalId = generateId('apr');
    const sideEffects: string[] = [];

    db.transaction(() => {
      // Insert approval record
      db.prepare(`
        INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor, rationale, conditions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(approvalId, scopeType, scopeId, approvalType, decision, actor, rationale ?? null, conditions ?? null, now);

      // Side effects based on approval type
      if (approvalType === 'feature_approval' && decision === 'approved' && scopeType === 'feature') {
        const feature = db.prepare('SELECT status FROM features WHERE feature_id = ?').get(scopeId) as { status: string };
        if (feature.status === 'proposed') {
          db.prepare(`UPDATE features SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE feature_id = ?`).run(actor, now, now, scopeId);
          db.prepare(`
            INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
            VALUES (?, 'feature', ?, 'proposed', 'approved', 'human', ?, 'approved via multi-claude approve', ?)
          `).run(generateId('tr'), scopeId, actor, now);
          sideEffects.push(`feature ${scopeId} → approved`);
        }
      }

      if (approvalType === 'contract_delta_approval' && decision === 'approved' && scopeType === 'contract_delta') {
        db.prepare(`UPDATE contract_deltas SET status = 'approved', approved_by = ?, approved_at = ? WHERE contract_delta_id = ?`).run(actor, now, scopeId);
        sideEffects.push(`contract delta ${scopeId} → approved`);
      }

      if (approvalType === 'amendment_approval' && decision === 'approved' && scopeType === 'amendment') {
        db.prepare(`UPDATE packet_amendments SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE amendment_id = ?`).run(actor, now, scopeId);
        sideEffects.push(`amendment ${scopeId} → approved`);
      }

      if (approvalType === 'amendment_approval' && decision === 'rejected' && scopeType === 'amendment') {
        db.prepare(`UPDATE packet_amendments SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE amendment_id = ?`).run(actor, now, scopeId);
        sideEffects.push(`amendment ${scopeId} → rejected`);
      }
    })();

    return {
      ok: true,
      command: 'multi-claude approve',
      result: {
        approval_id: approvalId,
        scope_type: scopeType,
        scope_id: scopeId,
        decision,
        side_effects: sideEffects,
      },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

export function approveCommand(): Command {
  const cmd = new Command('approve')
    .description('Record human approval')
    .requiredOption('--scope-type <type>', 'Scope type')
    .requiredOption('--scope-id <id>', 'Entity ID being approved')
    .requiredOption('--approval-type <type>', 'Approval type')
    .requiredOption('--decision <decision>', 'approved / rejected / approved_with_conditions')
    .requiredOption('--actor <name>', 'Human identity')
    .option('--rationale <text>', 'Why')
    .option('--conditions <text>', 'Conditions (required for approved_with_conditions)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = runApprove(
        opts.dbPath, opts.scopeType as ApprovalScopeType, opts.scopeId,
        opts.approvalType as ApprovalType, opts.decision as ApprovalDecision,
        opts.actor, opts.rationale, opts.conditions,
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
