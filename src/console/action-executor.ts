/**
 * Action Executor — executes lawful operator actions by checking availability
 * first, delegating to DB mutations, and recording audit entries.
 *
 * Every action follows: check availability → execute mutation → record audit.
 */

import type Database from 'better-sqlite3';
import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';
import { computeActionAvailability } from './action-availability.js';
import { ensureAuditTableWithDb, recordAuditWithDb } from './audit-trail.js';
import { queryRunModelWithDb } from './run-model.js';
import { queryHookFeed } from './hook-feed.js';
import { resolveDecision } from '../hooks/engine.js';

// ── Interfaces ──────────────────────────────────────────────────────

/** Re-export for backward compatibility */
export type { ActionResult } from '../types/actions.js';
import type { ActionResult, Precondition } from '../types/actions.js';

// ── Internal helpers ────────────────────────────────────────────────

function failResult(
  action: string,
  targetId: string,
  reason: string,
  preconditions: Precondition[] = [],
): ActionResult {
  return {
    action,
    targetId,
    success: false,
    beforeState: '?',
    afterState: '?',
    message: reason,
    error: reason,
    auditId: null,
    preconditions,
  };
}

function recordSuccess(
  db: Database.Database,
  action: string,
  targetId: string,
  targetType: string,
  beforeState: string,
  afterState: string,
  actor: string,
  reason: string,
  command: string,
): ActionResult {
  const entry = recordAuditWithDb(db, {
    actor,
    action,
    targetType,
    targetId,
    beforeState,
    afterState,
    reason,
    command,
    success: true,
    error: null,
  });

  return {
    action,
    targetId,
    success: true,
    beforeState,
    afterState,
    message: `${action} executed successfully`,
    error: null,
    auditId: entry.id,
    preconditions: [],
  };
}

// ── Action handlers ─────────────────────────────────────────────────

function executeStopRun(
  db: Database.Database,
  targetId: string,
  actor: string,
  reason: string,
  beforeStatus: string,
): ActionResult {
  const now = nowISO();

  db.prepare(
    `UPDATE auto_runs SET status = 'stopped', completed_at = ? WHERE run_id = ?`,
  ).run(now, targetId);

  db.prepare(
    `UPDATE auto_run_workers SET status = 'failed', completed_at = ?
     WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'timed_out')`,
  ).run(now, targetId);

  return recordSuccess(
    db, 'stop_run', targetId, 'run',
    beforeStatus, 'stopped', actor, reason,
    `multi-claude auto stop --run ${targetId}`,
  );
}

function executeRetryPacket(
  db: Database.Database,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  const now = nowISO();

  db.prepare(
    `UPDATE packets SET status = 'ready', updated_at = ? WHERE packet_id = ?`,
  ).run(now, targetId);

  return recordSuccess(
    db, 'retry_packet', targetId, 'packet',
    'failed', 'ready', actor, reason,
    `multi-claude claim ${targetId} --actor operator --session retry-${targetId}`,
  );
}

function executeResumeRun(
  db: Database.Database,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  db.prepare(
    `UPDATE auto_runs SET status = 'running', pause_reason = NULL, pause_gate_type = NULL
     WHERE run_id = ?`,
  ).run(targetId);

  return recordSuccess(
    db, 'resume_run', targetId, 'run',
    'paused', 'running', actor, reason,
    `multi-claude auto resume --run ${targetId}`,
  );
}

function executeApproveGate(
  db: Database.Database,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  // targetId format: scopeType:scopeId:gateType
  const parts = targetId.split(':');
  if (parts.length < 3) {
    return failResult('approve_gate', targetId, `Invalid gate target format: ${targetId}`);
  }
  const scopeType = parts[0];
  const scopeId = parts.slice(1, -1).join(':'); // handle scope IDs that contain colons
  const gateType = parts[parts.length - 1];

  const approvalId = generateId('apv');
  const now = nowISO();

  db.prepare(
    `INSERT INTO approvals (approval_id, scope_type, scope_id, approval_type, decision, actor, created_at)
     VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
  ).run(approvalId, scopeType, scopeId, gateType, actor, now);

  return recordSuccess(
    db, 'approve_gate', targetId, 'gate',
    'pending', 'approved', actor, reason,
    `multi-claude approve --scope-type ${scopeType} --scope-id ${scopeId} --type ${gateType} --actor ${actor}`,
  );
}

function executeResolveHook(
  dbPath: string,
  db: Database.Database,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  const ok = resolveDecision(dbPath, targetId, 'confirmed');
  if (!ok) {
    return failResult('resolve_hook', targetId, `Failed to resolve hook decision ${targetId}`);
  }

  return recordSuccess(
    db, 'resolve_hook', targetId, 'hook_decision',
    'pending', 'confirmed', actor, reason,
    `multi-claude hooks resolve --decision ${targetId} --resolution confirmed`,
  );
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Execute a lawful action with a pre-opened DB handle.
 * Checks availability, executes the mutation, and records an audit entry.
 */
export function executeActionWithDb(
  db: Database.Database,
  dbPath: string,
  action: string,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  // 1. Set up audit table
  ensureAuditTableWithDb(db);

  // 2. Load current state
  const runModel = queryRunModelWithDb(db);

  // Build a hook feed — queryHookFeed opens its own DB from dbPath
  const featureId = runModel?.overview.featureId ?? '';
  const hookFeed = queryHookFeed(dbPath, featureId);

  // 3. Check availability
  if (!runModel && action !== 'resolve_hook') {
    return failResult(action, targetId, 'No active run found');
  }

  // For actions that need a runModel, use the real one or a dummy
  const avail = runModel
    ? computeActionAvailability(action, targetId, runModel, hookFeed)
    : computeActionAvailability(action, targetId, null as unknown as any, hookFeed);

  if (!avail.available) {
    return failResult(action, targetId, avail.reason, avail.preconditions);
  }

  // 4. Execute the action
  switch (action) {
    case 'stop_run':
      return executeStopRun(db, targetId, actor, reason, runModel!.overview.status);

    case 'retry_packet':
      return executeRetryPacket(db, targetId, actor, reason);

    case 'resume_run':
      return executeResumeRun(db, targetId, actor, reason);

    case 'approve_gate':
      return executeApproveGate(db, targetId, actor, reason);

    case 'resolve_hook':
      return executeResolveHook(dbPath, db, targetId, actor, reason);

    default:
      return failResult(action, targetId, `Unknown action: ${action}`);
  }
}

/**
 * Execute a lawful action given a DB path.
 * Opens the DB, delegates to executeActionWithDb, and closes.
 */
export function executeAction(
  dbPath: string,
  action: string,
  targetId: string,
  actor: string,
  reason: string,
): ActionResult {
  const db = openDb(dbPath);
  try {
    return executeActionWithDb(db, dbPath, action, targetId, actor, reason);
  } finally {
    db.close();
  }
}
