import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { McfResult } from '../types/common.js';

type IntegrateAction = 'prepare' | 'execute' | 'complete' | 'fail';

interface IntegrationPacket {
  packet_id: string;
  layer: string;
  merge_with_layer: string | null;
  status: string;
}

export interface IntegratePrepareResult {
  integration_run_id: string;
  feature_id: string;
  packets_included: string[];
  merge_target: string;
  status: string;
  integration_order: Array<{ packet_id: string; layer: string; slot: number }>;
}

export interface IntegrateExecuteResult {
  integration_run_id: string;
  status: string;
  packets_moved: number;
}

export interface IntegrateCompleteResult {
  integration_run_id: string;
  feature_id: string;
  status: string;
  feature_status: string;
  packets_merged: number;
}

export interface IntegrateFailResult {
  integration_run_id: string;
  status: string;
  packets_affected: number;
}

const LAYER_ORDER: Record<string, number> = {
  contract: 1, backend: 2, state: 3, ui: 4, integration: 5, docs: 6, test: 0,
};

function mergeSlot(p: IntegrationPacket): number {
  if (p.layer === 'test' && p.merge_with_layer) {
    return LAYER_ORDER[p.merge_with_layer] ?? 5;
  }
  return LAYER_ORDER[p.layer] ?? 5;
}

export function runIntegrate(
  dbPath: string,
  featureId: string,
  integrator: string,
  action: IntegrateAction,
  session?: string,
): McfResult<IntegratePrepareResult | IntegrateExecuteResult | IntegrateCompleteResult | IntegrateFailResult> {
  const db = openDb(dbPath);
  try {
    if (action === 'prepare') {
      return prepareFn(db, featureId, integrator, session);
    } else if (action === 'execute') {
      return executeFn(db, featureId, integrator);
    } else if (action === 'complete') {
      return completeFn(db, featureId, integrator);
    } else if (action === 'fail') {
      return failFn(db, featureId, integrator);
    }
    return mcfError('mcf integrate', ERR.INVALID_STATE, `Unknown action: ${action}`, {});
  } finally {
    db.close();
  }
}

function prepareFn(
  db: ReturnType<typeof openDb>,
  featureId: string,
  integrator: string,
  session?: string,
): McfResult<IntegratePrepareResult> {
  // 1. Verify feature exists
  const feature = db.prepare('SELECT feature_id, status, merge_target FROM features WHERE feature_id = ?').get(featureId) as { feature_id: string; status: string; merge_target: string } | undefined;
  if (!feature) return mcfError('mcf integrate', ERR.FEATURE_NOT_FOUND, `Feature '${featureId}' not found`, {});
  if (feature.status !== 'in_progress' && feature.status !== 'verifying') {
    return mcfError('mcf integrate', ERR.INVALID_STATE, `Feature is '${feature.status}', expected 'in_progress' or 'verifying'`, { current_status: feature.status });
  }

  // 2. Verify all merge-relevant packets are verified
  const unreadyPackets = db.prepare(`
    SELECT packet_id, status FROM packets
    WHERE feature_id = ? AND status NOT IN ('verified', 'merged', 'abandoned', 'superseded')
  `).all(featureId) as Array<{ packet_id: string; status: string }>;

  if (unreadyPackets.length > 0) {
    return mcfError('mcf integrate', ERR.PACKETS_NOT_READY,
      `${unreadyPackets.length} packets are not verified`,
      { unready: unreadyPackets },
    );
  }

  // 3. Verify integrator independence
  const builtByIntegrator = db.prepare(`
    SELECT DISTINCT pa.started_by, pa.packet_id
    FROM packet_attempts pa
    JOIN packets p ON p.packet_id = pa.packet_id
    WHERE p.feature_id = ? AND pa.started_by = ?
  `).all(featureId, integrator) as Array<{ started_by: string; packet_id: string }>;

  if (builtByIntegrator.length > 0) {
    return mcfError('mcf integrate', ERR.INDEPENDENCE_VIOLATION,
      `Integrator '${integrator}' built packets in this feature`,
      { built_packets: builtByIntegrator.map(r => r.packet_id) },
    );
  }

  // 4. Verify knowledge promotions exist for writeback-required packets
  const missingPromotions = db.prepare(`
    SELECT p.packet_id FROM packets p
    WHERE p.feature_id = ? AND p.knowledge_writeback_required = 1
      AND p.status = 'verified'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge_promotions kp
        JOIN packet_submissions ps ON ps.submission_id = kp.submission_id
        WHERE ps.packet_id = p.packet_id
      )
  `).all(featureId) as Array<{ packet_id: string }>;

  if (missingPromotions.length > 0) {
    return mcfError('mcf integrate', ERR.MISSING_PROMOTIONS,
      `${missingPromotions.length} packets missing knowledge promotions`,
      { missing: missingPromotions.map(r => r.packet_id) },
    );
  }

  // 5. Verify merge approval exists
  const mergeApproval = db.prepare(`
    SELECT approval_id FROM approvals
    WHERE scope_type = 'feature' AND scope_id = ? AND approval_type = 'merge_approval' AND decision = 'approved'
    ORDER BY created_at DESC LIMIT 1
  `).get(featureId) as { approval_id: string } | undefined;

  if (!mergeApproval) {
    return mcfError('mcf integrate', ERR.NO_MERGE_APPROVAL, 'Feature merge not approved by human', { feature_id: featureId });
  }

  // 6. Verify merge target consistency
  const packetTargets = db.prepare(`
    SELECT packet_id, merge_target FROM packets
    WHERE feature_id = ? AND status = 'verified'
  `).all(featureId) as Array<{ packet_id: string; merge_target: string | null }>;

  const effectiveTargets = new Set(packetTargets.map(p => p.merge_target ?? feature.merge_target));
  if (effectiveTargets.size > 1) {
    return mcfError('mcf integrate', ERR.TARGET_MISMATCH,
      'Packets resolve to different merge targets',
      { targets: Array.from(effectiveTargets) },
    );
  }

  // 7. Create integration run
  const verifiedPackets = db.prepare(`
    SELECT packet_id, layer, merge_with_layer, status FROM packets
    WHERE feature_id = ? AND status = 'verified'
    ORDER BY packet_id
  `).all(featureId) as IntegrationPacket[];

  const sorted = [...verifiedPackets].sort((a, b) => mergeSlot(a) - mergeSlot(b));

  const now = nowISO();
  const runId = generateId('ir');

  db.transaction(() => {
    db.prepare(`
      INSERT INTO integration_runs (
        integration_run_id, feature_id, status, started_by, started_at,
        integrator_session_id, packets_included, merge_target, merge_approval_id
      ) VALUES (?, ?, 'preparing', ?, ?, ?, ?, ?, ?)
    `).run(
      runId, featureId, integrator, now,
      session ?? null,
      JSON.stringify(verifiedPackets.map(p => p.packet_id)),
      feature.merge_target,
      mergeApproval.approval_id,
    );

    // Update feature to verifying
    if (feature.status !== 'verifying') {
      db.prepare(`UPDATE features SET status = 'verifying', updated_at = ? WHERE feature_id = ?`).run(now, featureId);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'feature', ?, ?, 'verifying', 'integrator', ?, 'integration prepare', ?)
      `).run(generateId('tr'), featureId, feature.status, integrator, now);
    }
  })();

  return {
    ok: true,
    command: 'mcf integrate --action prepare',
    result: {
      integration_run_id: runId,
      feature_id: featureId,
      packets_included: verifiedPackets.map(p => p.packet_id),
      merge_target: feature.merge_target,
      status: 'preparing',
      integration_order: sorted.map(p => ({ packet_id: p.packet_id, layer: p.layer, slot: mergeSlot(p) })),
    },
    transitions: [],
  };
}

function executeFn(
  db: ReturnType<typeof openDb>,
  featureId: string,
  integrator: string,
): McfResult<IntegrateExecuteResult> {
  const run = db.prepare(`
    SELECT integration_run_id, status, packets_included, started_by
    FROM integration_runs WHERE feature_id = ? AND status = 'preparing'
    ORDER BY started_at DESC LIMIT 1
  `).get(featureId) as { integration_run_id: string; status: string; packets_included: string; started_by: string } | undefined;

  if (!run) return mcfError('mcf integrate', ERR.INVALID_RUN_STATE, 'No preparing integration run found', { feature_id: featureId });
  if (run.started_by !== integrator) return mcfError('mcf integrate', ERR.NOT_OWNER, 'Integrator mismatch', { expected: run.started_by, actual: integrator });

  const packetIds = JSON.parse(run.packets_included) as string[];
  const now = nowISO();

  db.transaction(() => {
    db.prepare(`UPDATE integration_runs SET status = 'integrating' WHERE integration_run_id = ?`).run(run.integration_run_id);

    for (const pid of packetIds) {
      db.prepare(`UPDATE packets SET status = 'integrating', updated_at = ? WHERE packet_id = ?`).run(now, pid);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'verified', 'integrating', 'integrator', ?, 'integration execute', ?)
      `).run(generateId('tr'), pid, integrator, now);
    }
  })();

  return {
    ok: true,
    command: 'mcf integrate --action execute',
    result: { integration_run_id: run.integration_run_id, status: 'integrating', packets_moved: packetIds.length },
    transitions: packetIds.map(id => ({ entity_type: 'packet' as const, entity_id: id, from_state: 'verified', to_state: 'integrating' })),
  };
}

function completeFn(
  db: ReturnType<typeof openDb>,
  featureId: string,
  integrator: string,
): McfResult<IntegrateCompleteResult> {
  const run = db.prepare(`
    SELECT integration_run_id, status, packets_included, started_by
    FROM integration_runs WHERE feature_id = ? AND status = 'integrating'
    ORDER BY started_at DESC LIMIT 1
  `).get(featureId) as { integration_run_id: string; status: string; packets_included: string; started_by: string } | undefined;

  if (!run) return mcfError('mcf integrate', ERR.INVALID_RUN_STATE, 'No integrating run found', { feature_id: featureId });
  if (run.started_by !== integrator) return mcfError('mcf integrate', ERR.NOT_OWNER, 'Integrator mismatch', {});

  const packetIds = JSON.parse(run.packets_included) as string[];
  const now = nowISO();

  let featureComplete = false;

  db.transaction(() => {
    // Merge all packets
    for (const pid of packetIds) {
      db.prepare(`UPDATE packets SET status = 'merged', updated_at = ? WHERE packet_id = ?`).run(now, pid);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'integrating', 'merged', 'integrator', ?, 'integration complete', ?)
      `).run(generateId('tr'), pid, integrator, now);
    }

    // Complete integration run
    db.prepare(`UPDATE integration_runs SET status = 'merged', completed_at = ? WHERE integration_run_id = ?`).run(now, run.integration_run_id);

    // Check if feature is complete (all packets merged/abandoned/superseded)
    const remaining = db.prepare(`
      SELECT packet_id FROM packets
      WHERE feature_id = ? AND status NOT IN ('merged', 'abandoned', 'superseded')
    `).all(featureId) as Array<{ packet_id: string }>;

    if (remaining.length === 0) {
      featureComplete = true;
      db.prepare(`UPDATE features SET status = 'complete', completed_at = ?, updated_at = ? WHERE feature_id = ?`).run(now, now, featureId);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'feature', ?, 'verifying', 'complete', 'integrator', ?, 'all packets merged', ?)
      `).run(generateId('tr'), featureId, integrator, now);
    }
  })();

  return {
    ok: true,
    command: 'mcf integrate --action complete',
    result: {
      integration_run_id: run.integration_run_id,
      feature_id: featureId,
      status: 'merged',
      feature_status: featureComplete ? 'complete' : 'verifying',
      packets_merged: packetIds.length,
    },
    transitions: [
      ...packetIds.map(id => ({ entity_type: 'packet' as const, entity_id: id, from_state: 'integrating', to_state: 'merged' })),
      ...(featureComplete ? [{ entity_type: 'feature' as const, entity_id: featureId, from_state: 'verifying', to_state: 'complete' }] : []),
    ],
  };
}

function failFn(
  db: ReturnType<typeof openDb>,
  featureId: string,
  integrator: string,
): McfResult<IntegrateFailResult> {
  const run = db.prepare(`
    SELECT integration_run_id, status, packets_included, started_by
    FROM integration_runs WHERE feature_id = ? AND status = 'integrating'
    ORDER BY started_at DESC LIMIT 1
  `).get(featureId) as { integration_run_id: string; status: string; packets_included: string; started_by: string } | undefined;

  if (!run) return mcfError('mcf integrate', ERR.INVALID_RUN_STATE, 'No integrating run found', { feature_id: featureId });

  const packetIds = JSON.parse(run.packets_included) as string[];
  const now = nowISO();

  db.transaction(() => {
    // Roll back packets to verified
    for (const pid of packetIds) {
      db.prepare(`UPDATE packets SET status = 'verified', updated_at = ? WHERE packet_id = ?`).run(now, pid);
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, 'integrating', 'verified', 'integrator', ?, 'integration failed — rollback', ?)
      `).run(generateId('tr'), pid, integrator, now);
    }

    db.prepare(`UPDATE integration_runs SET status = 'failed', completed_at = ? WHERE integration_run_id = ?`).run(now, run.integration_run_id);

    // Return feature to in_progress
    db.prepare(`UPDATE features SET status = 'in_progress', updated_at = ? WHERE feature_id = ?`).run(now, featureId);
    db.prepare(`
      INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
      VALUES (?, 'feature', ?, 'verifying', 'in_progress', 'integrator', ?, 'integration failed', ?)
    `).run(generateId('tr'), featureId, integrator, now);
  })();

  return {
    ok: true,
    command: 'mcf integrate --action fail',
    result: { integration_run_id: run.integration_run_id, status: 'failed', packets_affected: packetIds.length },
    transitions: packetIds.map(id => ({ entity_type: 'packet' as const, entity_id: id, from_state: 'integrating', to_state: 'verified' })),
  };
}

export function integrateCommand(): Command {
  const cmd = new Command('integrate')
    .description('Start or complete feature integration')
    .requiredOption('--feature <id>', 'Feature ID')
    .requiredOption('--integrator <name>', 'Integrator identity')
    .requiredOption('--action <action>', 'prepare / execute / complete / fail')
    .option('--session <id>', 'Session identifier')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runIntegrate(opts.dbPath, opts.feature, opts.integrator, opts.action as IntegrateAction, opts.session);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
