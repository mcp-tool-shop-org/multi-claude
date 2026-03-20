/**
 * Scoring Engine — computes fitness scores from execution evidence.
 *
 * Reads from: packets, verification_results, integration_runs, runtime_envelopes,
 *   hook_decisions, state_transition_log, packet_submissions, knowledge_promotions
 *
 * Writes to: run_scores, packet_scores, role_contributions, score_events
 */

import { openDb } from '../db/connection.js';
import { nowISO } from '../lib/ids.js';
// Metric registry available for future detailed scoring
// import { METRIC_REGISTRY } from './metrics.js';
import { MATURATION, PACKET_CLASS_BUDGETS, type RunScore, type PacketFitness, type Penalty, type PacketClass } from './types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Duration scoring ───────────────────────────────────────────

function scoreDuration(durationSec: number, packetClass: PacketClass): number {
  const [, budgetMax] = PACKET_CLASS_BUDGETS[packetClass];
  if (durationSec <= budgetMax) return 1.0;
  const ceiling2x = budgetMax * 2;
  if (durationSec >= ceiling2x) return 0.0;
  // Linear decay from budget max to 2x ceiling
  return 1.0 - (durationSec - budgetMax) / (ceiling2x - budgetMax);
}

// ─── Grade from score ───────────────────────────────────────────

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ─── Compute packet maturation score ────────────────────────────

function computePacketScore(
  packetId: string,
  packetClass: PacketClass,
  maturationStage: 'submitted' | 'verified' | 'integrated' | 'none',
  durationSec: number | null,
  penalties: number,
): PacketFitness {
  const budget = PACKET_CLASS_BUDGETS[packetClass];
  // Duration score computed for future weighted scoring
  void (durationSec != null ? scoreDuration(durationSec, packetClass) : 0);

  // Base score (100 raw, then matured)
  let maturedPoints = 0;
  if (maturationStage === 'submitted') {
    maturedPoints = 100 * MATURATION.submit;
  } else if (maturationStage === 'verified') {
    maturedPoints = 100 * (MATURATION.submit + MATURATION.verify);
  } else if (maturationStage === 'integrated') {
    maturedPoints = 100 * (MATURATION.submit + MATURATION.verify + MATURATION.integrate);
  }

  return {
    packetId,
    role: '', // filled by caller
    layer: '', // filled by caller
    duration: durationSec ?? 0,
    budgetRange: budget,
    withinBudget: durationSec != null ? durationSec <= budget[1] : true,
    verificationPass: maturationStage === 'verified' || maturationStage === 'integrated',
    integrationSurvival: maturationStage === 'integrated',
    amendCount: 0, // filled by caller
    manualInterventionCount: 0, // filled by caller
    maturedPoints: Math.max(0, maturedPoints - penalties),
    maturationStage,
  };
}

// ─── Main scoring function ──────────────────────────────────────

export function scoreRun(dbPath: string, runId: string, featureId: string): RunScore {
  const db = openDb(dbPath);

  try {
    // Ensure fitness tables exist
    const schemaPath = join(import.meta.dirname, 'schema.sql');
    try {
      const sql = readFileSync(schemaPath, 'utf-8');
      db.exec(sql);
    } catch {
      // Tables may already exist
    }

    // Get all packets for this feature
    const packets = db.prepare(`
      SELECT p.packet_id, p.layer, p.role, p.status, p.created_at, p.updated_at
      FROM packets p WHERE p.feature_id = ?
    `).all(featureId) as Array<{ packet_id: string; layer: string; role: string; status: string; created_at: string; updated_at: string }>;

    const totalPackets = packets.length;
    if (totalPackets === 0) {
      return emptyScore(runId, featureId);
    }

    // Count states
    const verifiedCount = packets.filter(p => ['verified', 'integrating', 'merged'].includes(p.status)).length;
    const mergedCount = packets.filter(p => p.status === 'merged').length;

    // Get verification results
    const verResults = db.prepare(`
      SELECT vr.packet_id, vr.status, vr.checks
      FROM verification_results vr
      JOIN packets p ON p.packet_id = vr.packet_id
      WHERE p.feature_id = ?
    `).all(featureId) as Array<{ packet_id: string; status: string; checks_json: string }>;

    const totalChecks = verResults.length;
    const passedChecks = verResults.filter(v => v.status === 'verified').length;

    // Count reopens (verified → failed transitions)
    const reopens = db.prepare(`
      SELECT COUNT(*) as c FROM state_transition_log
      WHERE entity_type = 'packet' AND from_state = 'verified' AND to_state = 'failed'
      AND entity_id IN (SELECT packet_id FROM packets WHERE feature_id = ?)
    `).get(featureId) as { c: number };

    // Get amendments
    const amendments = db.prepare(`
      SELECT COUNT(*) as c FROM packet_amendments
      WHERE packet_id IN (SELECT packet_id FROM packets WHERE feature_id = ?)
    `).get(featureId) as { c: number };

    // Get state transitions for lawfulness
    // Transition count queried for future lawfulness scoring
    void db.prepare(`
      SELECT COUNT(*) as c FROM state_transition_log
      WHERE entity_id IN (SELECT packet_id FROM packets WHERE feature_id = ?)
    `).get(featureId);

    // Get hook decisions
    const hookDecisions = db.prepare(`
      SELECT COUNT(*) as c FROM hook_decisions WHERE feature_id = ?
    `).get(featureId) as { c: number };

    // Get submissions
    const submissions = db.prepare(`
      SELECT COUNT(*) as c FROM packet_submissions
      WHERE packet_id IN (SELECT packet_id FROM packets WHERE feature_id = ?)
    `).get(featureId) as { c: number };

    // ── Quality (40) ──────────────────────────────────
    const verifiedRate = totalPackets > 0 ? verifiedCount / totalPackets : 0;
    const integrationRate = verifiedCount > 0 ? mergedCount / verifiedCount : 0;
    const buildPassRate = totalChecks > 0 ? passedChecks / totalChecks : 0;
    const reopenRate = totalPackets > 0 ? 1 - (reopens.c / totalPackets) : 1;
    const reconcileRate = 1.0; // TODO: read from runtime envelopes when available

    const quality =
      verifiedRate * 12 +
      integrationRate * 10 +
      buildPassRate * 8 +
      reopenRate * 5 +
      reconcileRate * 5;

    // ── Lawfulness (25) ───────────────────────────────
    const transitionCompliance = 1.0; // All transitions go through CLI — 100% by design
    const envelopeCompleteness = 1.0; // TODO: check actual envelope records
    const stopRetryCorrectness = 1.0; // TODO: check stop envelope records
    const hookCoverage = hookDecisions.c > 0 ? Math.min(1.0, hookDecisions.c / Math.max(1, totalPackets)) : 0;
    const artifactValidity = submissions.c > 0 ? 1.0 : 0; // All accepted submissions are valid by design

    const lawfulness =
      transitionCompliance * 8 +
      envelopeCompleteness * 6 +
      stopRetryCorrectness * 4 +
      hookCoverage * 4 +
      artifactValidity * 3;

    // ── Collaboration (20) ────────────────────────────
    const manualRescueRate = 1.0; // TODO: track operator interventions
    const mergeFriction = 1.0; // TODO: track merge conflicts
    const downstreamSuccess = 1.0; // TODO: track dependency chain success
    const verifierFindRate = passedChecks > 0 ? 0.8 : 0; // Default reasonable
    const knowledgeReuse = 0.5; // Default — no reuse data yet

    const collaboration =
      manualRescueRate * 6 +
      mergeFriction * 5 +
      downstreamSuccess * 4 +
      verifierFindRate * 3 +
      knowledgeReuse * 2;

    // ── Velocity (15) ─────────────────────────────────
    const durationVsBudget = 0.7; // TODO: compute from runtime envelopes
    const timeToVerified = 0.7; // TODO: compute from timestamps
    const timeToIntegrated = 0.7; // TODO: compute from timestamps
    const queueLatency = 0.8; // TODO: compute from claim timestamps

    const velocity =
      durationVsBudget * 6 +
      timeToVerified * 4 +
      timeToIntegrated * 3 +
      queueLatency * 2;

    // ── Penalties ─────────────────────────────────────
    const penalties: Penalty[] = [];

    if (amendments.c > 0) {
      penalties.push({ type: 'soft', category: 'amendment', description: `${amendments.c} amendment(s) required`, points: amendments.c });
    }
    if (reopens.c > 0) {
      penalties.push({ type: 'soft', category: 'reopen', description: `${reopens.c} packet(s) reopened`, points: reopens.c * 2 });
    }

    const totalPenalty = penalties.reduce((sum, p) => sum + p.points, 0);

    // ── Total ─────────────────────────────────────────
    const total = Math.max(0, Math.min(100, quality + lawfulness + collaboration + velocity - totalPenalty));
    const grade = gradeFromScore(total);

    // ── Packet fitness ────────────────────────────────
    const packetFitness: PacketFitness[] = packets.map(p => {
      let maturationStage: 'submitted' | 'verified' | 'integrated' | 'none' = 'none';
      if (p.status === 'merged') maturationStage = 'integrated';
      else if (['verified', 'integrating'].includes(p.status)) maturationStage = 'verified';
      else if (p.status === 'submitted') maturationStage = 'submitted';

      const classMap: Record<string, PacketClass> = {
        contract: 'state_domain', backend: 'backend', state: 'state_domain',
        ui: 'ui_interaction', test: 'verification', integration: 'integration', docs: 'docs_knowledge',
      };
      const pClass = classMap[p.layer] ?? 'state_domain';

      const fitness = computePacketScore(p.packet_id, pClass, maturationStage, null, 0);
      fitness.role = p.role;
      fitness.layer = p.layer;
      return fitness;
    });

    const runScore: RunScore = {
      runId, featureId,
      timestamp: nowISO(),
      overall: Math.round(total * 10) / 10,
      quality: Math.round(quality * 10) / 10,
      lawfulness: Math.round(lawfulness * 10) / 10,
      collaboration: Math.round(collaboration * 10) / 10,
      velocity: Math.round(velocity * 10) / 10,
      grade,
      packets: packetFitness,
      penalties,
    };

    // Persist
    db.prepare(`
      INSERT OR REPLACE INTO run_scores (run_id, feature_id, total_score, quality_score, lawfulness_score, collaboration_score, velocity_score, grade, status, penalties_json, evidence_json, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'computed', ?, '{}', ?)
    `).run(runId, featureId, runScore.overall, runScore.quality, runScore.lawfulness, runScore.collaboration, runScore.velocity, grade, JSON.stringify(penalties), nowISO());

    for (const pf of packetFitness) {
      const classMap: Record<string, PacketClass> = {
        contract: 'state_domain', backend: 'backend', state: 'state_domain',
        ui: 'ui_interaction', test: 'verification', integration: 'integration', docs: 'docs_knowledge',
      };
      db.prepare(`
        INSERT OR REPLACE INTO packet_scores (packet_id, run_id, packet_class, submit_score, verify_score, integrate_score, penalties, final_score, maturation_stage, duration_seconds, duration_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pf.packetId, runId, classMap[pf.layer] ?? 'state_domain',
        pf.maturationStage !== 'none' ? MATURATION.submit * 100 : 0,
        pf.verificationPass ? MATURATION.verify * 100 : 0,
        pf.integrationSurvival ? MATURATION.integrate * 100 : 0,
        0, pf.maturedPoints, pf.maturationStage,
        pf.duration || null, null, nowISO(),
      );
    }

    return runScore;
  } finally {
    db.close();
  }
}

function emptyScore(runId: string, featureId: string): RunScore {
  return {
    runId, featureId, timestamp: nowISO(),
    overall: 0, quality: 0, lawfulness: 0, collaboration: 0, velocity: 0,
    grade: 'F', packets: [], penalties: [],
  };
}
