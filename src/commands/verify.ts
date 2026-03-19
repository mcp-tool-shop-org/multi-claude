import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { McfResult } from '../types/common.js';

type VerifierRole = 'verifier-checklist' | 'verifier-analysis';
type Verdict = 'pass' | 'fail' | 'incomplete';

export interface VerifyResult {
  verification_result_id: string;
  packet_id: string;
  verdict: Verdict;
  verifier_role: VerifierRole;
  checks_passed: number;
  checks_failed: number;
  retry_recommendation: string | null;
}

export function runVerify(
  dbPath: string,
  packetId: string,
  verifier: string,
  verifierRole: VerifierRole,
  checksJson: string,
  verdict: Verdict,
  summary: string,
  failuresJson?: string,
  analysisJson?: string,
  retryRecommendation?: string,
): McfResult<VerifyResult> {
  const db = openDb(dbPath);
  try {
    // 1. Verify packet exists and is in submitted or verifying state
    const packet = db.prepare(`
      SELECT packet_id, status, rule_profile FROM packets WHERE packet_id = ?
    `).get(packetId) as { packet_id: string; status: string; rule_profile: string } | undefined;

    if (!packet) {
      return mcfError('multi-claude verify', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
    }
    if (packet.status !== 'submitted' && packet.status !== 'verifying') {
      return mcfError('multi-claude verify', ERR.PACKET_NOT_SUBMITTED, `Packet is '${packet.status}', expected 'submitted' or 'verifying'`, { packet_id: packetId, current_status: packet.status });
    }

    // 2. Find the submission
    const submission = db.prepare(`
      SELECT submission_id, attempt_id, submitted_by
      FROM packet_submissions
      WHERE packet_id = ?
      ORDER BY submitted_at DESC LIMIT 1
    `).get(packetId) as { submission_id: string; attempt_id: string; submitted_by: string } | undefined;

    if (!submission) {
      return mcfError('multi-claude verify', ERR.SUBMISSION_NOT_FOUND, `No submission found for packet '${packetId}'`, { packet_id: packetId });
    }

    // 3. Verify independence: verifier != builder
    if (verifier === submission.submitted_by) {
      return mcfError('multi-claude verify', ERR.INDEPENDENCE_VIOLATION, `Verifier '${verifier}' is the same as builder '${submission.submitted_by}'`, { verifier, builder: submission.submitted_by });
    }

    // 4. If verifier-analysis: require prior checklist failure
    if (verifierRole === 'verifier-analysis') {
      const priorChecklist = db.prepare(`
        SELECT verification_result_id, status
        FROM verification_results
        WHERE packet_id = ? AND verifier_role = 'verifier-checklist' AND status = 'failed'
        ORDER BY completed_at DESC LIMIT 1
      `).get(packetId) as { verification_result_id: string; status: string } | undefined;

      if (!priorChecklist) {
        return mcfError('multi-claude verify', ERR.CHECKLIST_REQUIRED_FIRST, 'Verifier-analysis requires a prior checklist failure', { packet_id: packetId });
      }
    }

    // 5. Validate checks JSON
    let checks: Record<string, boolean>;
    try {
      checks = JSON.parse(checksJson) as Record<string, boolean>;
    } catch {
      return mcfError('multi-claude verify', ERR.INVALID_CHECKS, 'Checks JSON is invalid', {});
    }

    // Count pass/fail
    const checkEntries = Object.entries(checks);
    const passed = checkEntries.filter(([, v]) => v === true).length;
    const failed = checkEntries.filter(([, v]) => v === false).length;

    // 6. Verdict consistency checks
    if (verdict === 'pass' && failed > 0) {
      return mcfError('multi-claude verify', ERR.VERDICT_MISMATCH, `Verdict is 'pass' but ${failed} checks failed`, { checks_failed: failed });
    }
    if (verdict === 'fail' && !failuresJson) {
      return mcfError('multi-claude verify', ERR.MISSING_FAILURES, 'Fail verdict requires failure details', {});
    }
    if (verifierRole === 'verifier-analysis' && verdict === 'fail' && !analysisJson) {
      return mcfError('multi-claude verify', ERR.MISSING_ANALYSIS, 'Verifier-analysis failure requires analysis and retry recommendation', {});
    }
    if (verifierRole === 'verifier-analysis' && verdict === 'fail' && !retryRecommendation) {
      return mcfError('multi-claude verify', ERR.MISSING_ANALYSIS, 'Verifier-analysis failure requires retry recommendation', {});
    }

    // 7. Determine target packet state
    const fromState = packet.status;
    let toState: string;
    let verificationStatus: string;

    if (verdict === 'pass') {
      toState = 'verified';
      verificationStatus = 'verified';
    } else {
      toState = 'failed';
      verificationStatus = 'failed';
    }

    const now = nowISO();
    const verificationId = generateId('ver');

    // 8. Atomic: insert result + update packet + log transition
    db.transaction(() => {
      db.prepare(`
        INSERT INTO verification_results (
          verification_result_id, packet_id, attempt_id, submission_id,
          verified_by, verifier_role, started_at, completed_at,
          status, rule_profile, checks, failures, artifacts,
          failure_analysis, retry_recommendation, summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        verificationId, packetId, submission.attempt_id, submission.submission_id,
        verifier, verifierRole, now, now,
        verificationStatus, packet.rule_profile,
        checksJson,
        failuresJson ?? null,
        null,
        analysisJson ?? null,
        retryRecommendation ?? null,
        summary,
      );

      // Update packet status
      db.prepare(`UPDATE packets SET status = ?, updated_at = ? WHERE packet_id = ?`).run(toState, now, packetId);

      // Log transition
      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'packet', ?, ?, ?, 'verifier', ?, ?, ?)
      `).run(generateId('tr'), packetId, fromState, toState, verifier, `verdict: ${verdict}`, now);
    })();

    return {
      ok: true,
      command: 'multi-claude verify',
      result: {
        verification_result_id: verificationId,
        packet_id: packetId,
        verdict,
        verifier_role: verifierRole,
        checks_passed: passed,
        checks_failed: failed,
        retry_recommendation: retryRecommendation ?? null,
      },
      transitions: [{ entity_type: 'packet', entity_id: packetId, from_state: fromState, to_state: toState }],
    };
  } finally {
    db.close();
  }
}

export function verifyCommand(): Command {
  const cmd = new Command('verify')
    .description('Run verification on a submitted packet')
    .requiredOption('--packet <id>', 'Packet ID')
    .requiredOption('--verifier <name>', 'Verifier identity')
    .requiredOption('--verifier-role <role>', 'verifier-checklist or verifier-analysis')
    .requiredOption('--checks <path>', 'Path to JSON checklist results')
    .requiredOption('--verdict <verdict>', 'pass / fail / incomplete')
    .requiredOption('--summary <text>', 'Verification summary')
    .option('--failures <path>', 'Path to JSON failure details')
    .option('--analysis <path>', 'Path to JSON failure analysis')
    .option('--retry-recommendation <rec>', 'retry / amend / supersede / escalate')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const checksJson = readFileSync(opts.checks, 'utf-8');
      const failuresJson = opts.failures ? readFileSync(opts.failures, 'utf-8') : undefined;
      const analysisJson = opts.analysis ? readFileSync(opts.analysis, 'utf-8') : undefined;
      const result = runVerify(
        opts.dbPath, opts.packet, opts.verifier, opts.verifierRole as VerifierRole,
        checksJson, opts.verdict as Verdict, opts.summary,
        failuresJson, analysisJson, opts.retryRecommendation,
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
