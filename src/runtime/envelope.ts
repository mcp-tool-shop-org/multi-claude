import { openDb } from '../db/connection.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { RuntimeEnvelope, StopReason } from './types.js';

const ENSURE_TABLE = `
CREATE TABLE IF NOT EXISTS runtime_envelopes (
  session_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  packet_id TEXT NOT NULL,
  worker TEXT NOT NULL,
  role TEXT NOT NULL,
  model TEXT NOT NULL,
  tool_profile_json TEXT NOT NULL DEFAULT '[]',
  cwd TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  stop_reason TEXT,
  error TEXT,
  validation_verdict TEXT,
  diff_reconciliation_verdict TEXT
)`;

export function createEnvelope(
  dbPath: string,
  runId: string,
  packetId: string,
  worker: string,
  role: string,
  model: string,
  toolProfile: string[],
  cwd: string,
  outputDir: string,
  promptHash: string,
): RuntimeEnvelope {
  const envelope: RuntimeEnvelope = {
    sessionId: generateId('sess'),
    runId,
    packetId,
    worker,
    role,
    model,
    toolProfile,
    cwd,
    outputDir,
    promptHash,
    startedAt: nowISO(),
    completedAt: null,
    status: 'running',
    stopReason: null,
    error: null,
    validationVerdict: null,
    diffReconciliationVerdict: null,
  };

  const db = openDb(dbPath);
  try {
    db.exec(ENSURE_TABLE);
    db.prepare(`
      INSERT INTO runtime_envelopes (session_id, run_id, packet_id, worker, role, model, tool_profile_json, cwd, output_dir, prompt_hash, started_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')
    `).run(
      envelope.sessionId, runId, packetId, worker, role, model,
      JSON.stringify(toolProfile), cwd, outputDir, promptHash, envelope.startedAt,
    );
  } finally {
    db.close();
  }

  return envelope;
}

export function completeEnvelope(
  dbPath: string,
  sessionId: string,
  stopReason: StopReason,
  error: string | null,
  validationVerdict: string | null,
  diffVerdict: string | null,
): void {
  const db = openDb(dbPath);
  try {
    db.exec(ENSURE_TABLE);
    db.prepare(`
      UPDATE runtime_envelopes
      SET completed_at = ?, status = ?, stop_reason = ?, error = ?,
          validation_verdict = ?, diff_reconciliation_verdict = ?
      WHERE session_id = ?
    `).run(nowISO(), stopReason, stopReason, error, validationVerdict, diffVerdict, sessionId);
  } finally {
    db.close();
  }
}

export function getEnvelopes(dbPath: string, runId?: string): RuntimeEnvelope[] {
  const db = openDb(dbPath);
  try {
    db.exec(ENSURE_TABLE);
    const query = runId
      ? 'SELECT * FROM runtime_envelopes WHERE run_id = ? ORDER BY started_at'
      : 'SELECT * FROM runtime_envelopes ORDER BY started_at DESC LIMIT 50';
    const rows = runId
      ? db.prepare(query).all(runId) as Array<Record<string, unknown>>
      : db.prepare(query).all() as Array<Record<string, unknown>>;

    return rows.map(r => ({
      sessionId: r.session_id as string,
      runId: r.run_id as string,
      packetId: r.packet_id as string,
      worker: r.worker as string,
      role: r.role as string,
      model: r.model as string,
      toolProfile: JSON.parse(r.tool_profile_json as string),
      cwd: r.cwd as string,
      outputDir: r.output_dir as string,
      promptHash: r.prompt_hash as string,
      startedAt: r.started_at as string,
      completedAt: r.completed_at as string | null,
      status: r.status as StopReason | 'running',
      stopReason: r.stop_reason as StopReason | null,
      error: r.error as string | null,
      validationVerdict: r.validation_verdict as string | null,
      diffReconciliationVerdict: r.diff_reconciliation_verdict as string | null,
    }));
  } finally {
    db.close();
  }
}
