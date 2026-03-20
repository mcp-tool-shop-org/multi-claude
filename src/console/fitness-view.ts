/**
 * fitness-view.ts — Read model that surfaces run/packet maturation state.
 *
 * Pure read-only queries against existing DB tables (run_scores, packet_scores,
 * packets, verification_results, packet_submissions, integration_runs).
 * Handles missing fitness tables gracefully (returns null/empty).
 */

import { openDb } from '../db/connection.js';
import { nowISO } from '../lib/ids.js';

// ── Interfaces ──────────────────────────────────────────────────────

export interface RunFitnessView {
  runId: string;
  featureId: string;
  grade: string;
  overall: number;
  quality: number;
  lawfulness: number;
  collaboration: number;
  velocity: number;
  penalties: Array<{ type: string; category: string; description: string; points: number }>;
  computedAt: string | null;
  stale: boolean;
}

export interface PacketMaturation {
  packetId: string;
  layer: string;
  role: string;
  currentStatus: string;
  maturationStage: 'none' | 'submitted' | 'verified' | 'integrated';
  submitScore: number;
  verifyScore: number;
  integrateScore: number;
  finalScore: number;
  penalties: number;
  packetClass: string;
  durationSeconds: number | null;
}

export interface EvidenceItem {
  type: 'verification' | 'submission' | 'integration';
  entityId: string;
  packetId: string | null;
  status: string;
  summary: string;
  timestamp: string;
  details: Record<string, unknown> | null;
}

export interface FitnessViewResult {
  runScore: RunFitnessView | null;
  packets: PacketMaturation[];
  evidence: EvidenceItem[];
  maturationSummary: {
    none: number;
    submitted: number;
    verified: number;
    integrated: number;
  };
  queriedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function tableExists(db: import('better-sqlite3').Database, name: string): boolean {
  const row = db.prepare(
    `SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name=?`
  ).get(name) as { cnt: number } | undefined;
  return (row?.cnt ?? 0) > 0;
}

function parsePenalties(json: string | null): Array<{ type: string; category: string; description: string; points: number }> {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p: Record<string, unknown>) => ({
      type: typeof p['type'] === 'string' ? p['type'] : '',
      category: typeof p['category'] === 'string' ? p['category'] : '',
      description: typeof p['description'] === 'string' ? p['description'] : '',
      points: typeof p['points'] === 'number' ? p['points'] : 0,
    }));
  } catch {
    return [];
  }
}

function safeJsonParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Query: Run Score ────────────────────────────────────────────────

interface RunScoreRow {
  run_id: string;
  feature_id: string;
  grade: string;
  total_score: number;
  quality_score: number;
  lawfulness_score: number;
  collaboration_score: number;
  velocity_score: number;
  penalties_json: string;
  computed_at: string | null;
}

function queryRunScore(db: import('better-sqlite3').Database, runId: string, featureId: string): RunFitnessView | null {
  if (!tableExists(db, 'run_scores')) return null;

  const row = db.prepare(
    `SELECT run_id, feature_id, grade, total_score, quality_score,
            lawfulness_score, collaboration_score, velocity_score,
            penalties_json, computed_at
     FROM run_scores
     WHERE run_id = ?`
  ).get(runId) as RunScoreRow | undefined;

  if (!row) return null;

  // Stale detection: compare computed_at vs max packets.updated_at for the feature
  let stale = false;
  if (row.computed_at && tableExists(db, 'packets')) {
    const maxUpdated = db.prepare(
      `SELECT MAX(updated_at) as max_updated FROM packets WHERE feature_id = ?`
    ).get(featureId) as { max_updated: string | null } | undefined;

    if (maxUpdated?.max_updated && maxUpdated.max_updated > row.computed_at) {
      stale = true;
    }
  }

  return {
    runId: row.run_id,
    featureId: row.feature_id,
    grade: row.grade,
    overall: row.total_score,
    quality: row.quality_score,
    lawfulness: row.lawfulness_score,
    collaboration: row.collaboration_score,
    velocity: row.velocity_score,
    penalties: parsePenalties(row.penalties_json),
    computedAt: row.computed_at,
    stale,
  };
}

// ── Query: Packet Maturation ────────────────────────────────────────

interface PacketScoreRow {
  packet_id: string;
  layer: string;
  role: string;
  current_status: string;
  maturation_stage: string;
  submit_score: number;
  verify_score: number;
  integrate_score: number;
  final_score: number;
  penalties: number;
  packet_class: string;
  duration_seconds: number | null;
}

interface PacketOnlyRow {
  packet_id: string;
  layer: string;
  role: string;
  status: string;
}

export function queryPacketMaturation(dbPath: string, featureId: string): PacketMaturation[] {
  const db = openDb(dbPath);
  try {
    return queryPacketMaturationInternal(db, featureId);
  } finally {
    db.close();
  }
}

function queryPacketMaturationInternal(db: import('better-sqlite3').Database, featureId: string): PacketMaturation[] {
  const hasPacketScores = tableExists(db, 'packet_scores');
  const hasPackets = tableExists(db, 'packets');

  if (!hasPackets) return [];

  if (hasPacketScores) {
    // Join packets with packet_scores for full maturation data
    const rows = db.prepare(
      `SELECT p.packet_id, p.layer, p.role, p.status AS current_status,
              COALESCE(ps.maturation_stage, 'none') AS maturation_stage,
              COALESCE(ps.submit_score, 0) AS submit_score,
              COALESCE(ps.verify_score, 0) AS verify_score,
              COALESCE(ps.integrate_score, 0) AS integrate_score,
              COALESCE(ps.final_score, 0) AS final_score,
              COALESCE(ps.penalties, 0) AS penalties,
              COALESCE(ps.packet_class, 'state_domain') AS packet_class,
              ps.duration_seconds
       FROM packets p
       LEFT JOIN packet_scores ps ON ps.packet_id = p.packet_id
       WHERE p.feature_id = ?
       ORDER BY p.packet_id`
    ).all(featureId) as PacketScoreRow[];

    return rows.map(r => ({
      packetId: r.packet_id,
      layer: r.layer,
      role: r.role,
      currentStatus: r.current_status,
      maturationStage: r.maturation_stage as PacketMaturation['maturationStage'],
      submitScore: r.submit_score,
      verifyScore: r.verify_score,
      integrateScore: r.integrate_score,
      finalScore: r.final_score,
      penalties: r.penalties,
      packetClass: r.packet_class,
      durationSeconds: r.duration_seconds,
    }));
  }

  // Fallback: no packet_scores table, return packets with zero scores
  const rows = db.prepare(
    `SELECT packet_id, layer, role, status FROM packets WHERE feature_id = ? ORDER BY packet_id`
  ).all(featureId) as PacketOnlyRow[];

  return rows.map(r => ({
    packetId: r.packet_id,
    layer: r.layer,
    role: r.role,
    currentStatus: r.status,
    maturationStage: 'none' as const,
    submitScore: 0,
    verifyScore: 0,
    integrateScore: 0,
    finalScore: 0,
    penalties: 0,
    packetClass: 'state_domain',
    durationSeconds: null,
  }));
}

// ── Query: Evidence ─────────────────────────────────────────────────

export function queryEvidence(dbPath: string, featureId: string, options?: {
  limit?: number;
  packetId?: string;
}): EvidenceItem[] {
  const db = openDb(dbPath);
  try {
    return queryEvidenceInternal(db, featureId, options);
  } finally {
    db.close();
  }
}

function queryEvidenceInternal(db: import('better-sqlite3').Database, featureId: string, options?: {
  limit?: number;
  packetId?: string;
}): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  // 1. Verification results
  if (tableExists(db, 'verification_results') && tableExists(db, 'packets')) {
    const packetFilter = options?.packetId
      ? `AND vr.packet_id = '${options.packetId.replace(/'/g, "''")}'`
      : '';

    const vrRows = db.prepare(
      `SELECT vr.verification_result_id, vr.packet_id, vr.status,
              vr.summary, vr.checks, vr.failures, vr.completed_at,
              vr.started_at
       FROM verification_results vr
       JOIN packets p ON p.packet_id = vr.packet_id
       WHERE p.feature_id = ? ${packetFilter}
       ORDER BY COALESCE(vr.completed_at, vr.started_at) DESC`
    ).all(featureId) as Array<{
      verification_result_id: string;
      packet_id: string;
      status: string;
      summary: string;
      checks: string | null;
      failures: string | null;
      completed_at: string | null;
      started_at: string;
    }>;

    for (const vr of vrRows) {
      const details: Record<string, unknown> = {};
      const checks = safeJsonParse(vr.checks);
      const failures = safeJsonParse(vr.failures);
      if (checks) details['checks'] = checks;
      if (failures) details['failures'] = failures;

      items.push({
        type: 'verification',
        entityId: vr.verification_result_id,
        packetId: vr.packet_id,
        status: vr.status,
        summary: vr.summary,
        timestamp: vr.completed_at ?? vr.started_at,
        details: Object.keys(details).length > 0 ? details : null,
      });
    }
  }

  // 2. Packet submissions
  if (tableExists(db, 'packet_submissions') && tableExists(db, 'packets')) {
    const packetFilter = options?.packetId
      ? `AND ps.packet_id = '${options.packetId.replace(/'/g, "''")}'`
      : '';

    const subRows = db.prepare(
      `SELECT ps.submission_id, ps.packet_id, ps.builder_summary,
              ps.declared_merge_ready, ps.submitted_at
       FROM packet_submissions ps
       JOIN packets p ON p.packet_id = ps.packet_id
       WHERE p.feature_id = ? ${packetFilter}
       ORDER BY ps.submitted_at DESC`
    ).all(featureId) as Array<{
      submission_id: string;
      packet_id: string;
      builder_summary: string;
      declared_merge_ready: number;
      submitted_at: string;
    }>;

    for (const sub of subRows) {
      items.push({
        type: 'submission',
        entityId: sub.submission_id,
        packetId: sub.packet_id,
        status: sub.declared_merge_ready ? 'merge_ready' : 'submitted',
        summary: sub.builder_summary,
        timestamp: sub.submitted_at,
        details: { declaredMergeReady: !!sub.declared_merge_ready },
      });
    }
  }

  // 3. Integration runs
  if (tableExists(db, 'integration_runs')) {
    // Integration runs don't have a packet_id directly, but filter by feature_id
    // If packetId filter is set, skip integration runs (they're feature-level)
    if (!options?.packetId) {
      const irRows = db.prepare(
        `SELECT integration_run_id, status, summary, packets_included,
                started_at, completed_at
         FROM integration_runs
         WHERE feature_id = ?
         ORDER BY COALESCE(completed_at, started_at) DESC`
      ).all(featureId) as Array<{
        integration_run_id: string;
        status: string;
        summary: string | null;
        packets_included: string;
        started_at: string;
        completed_at: string | null;
      }>;

      for (const ir of irRows) {
        items.push({
          type: 'integration',
          entityId: ir.integration_run_id,
          packetId: null,
          status: ir.status,
          summary: ir.summary ?? '',
          timestamp: ir.completed_at ?? ir.started_at,
          details: safeJsonParse(ir.packets_included),
        });
      }
    }
  }

  // Sort all evidence newest-first by timestamp
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply limit
  if (options?.limit && options.limit > 0) {
    return items.slice(0, options.limit);
  }

  return items;
}

// ── Query: Full Fitness View ────────────────────────────────────────

export function queryFitnessView(dbPath: string, runId: string, featureId: string): FitnessViewResult {
  const db = openDb(dbPath);
  try {
    const runScore = queryRunScore(db, runId, featureId);
    const packets = queryPacketMaturationInternal(db, featureId);
    const evidence = queryEvidenceInternal(db, featureId);

    const maturationSummary = { none: 0, submitted: 0, verified: 0, integrated: 0 };
    for (const p of packets) {
      maturationSummary[p.maturationStage]++;
    }

    return {
      runScore,
      packets,
      evidence,
      maturationSummary,
      queriedAt: nowISO(),
    };
  } finally {
    db.close();
  }
}
