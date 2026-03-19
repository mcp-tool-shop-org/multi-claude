import { Command } from 'commander';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import type { McfResult } from '../types/common.js';

export interface PromoteResult {
  knowledge_promotion_id: string;
  packet_id: string;
  notes_created: number;
  relationships_created: number;
  architecture_updated: boolean;
}

export function runPromote(
  dbPath: string,
  packetId: string,
  submissionId: string,
  promoter: string,
  summary: string,
  repoNoteRefs: string[] = [],
  relationshipRefs: string[] = [],
  architectureUpdated = false,
  docsUpdated: string[] = [],
): McfResult<PromoteResult> {
  const db = openDb(dbPath);
  try {
    // 1. Verify packet exists and is in verified or later state
    const packet = db.prepare('SELECT packet_id, status FROM packets WHERE packet_id = ?').get(packetId) as { packet_id: string; status: string } | undefined;
    if (!packet) {
      return mcfError('mcf promote', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
    }
    const validStates = ['verified', 'integrating', 'merged'];
    if (!validStates.includes(packet.status)) {
      return mcfError('mcf promote', ERR.INVALID_STATE, `Packet is '${packet.status}', expected verified or later`, { packet_id: packetId, current_status: packet.status });
    }

    // 2. Verify submission exists and belongs to this packet
    const submission = db.prepare(`
      SELECT submission_id, submitted_by FROM packet_submissions WHERE submission_id = ? AND packet_id = ?
    `).get(submissionId, packetId) as { submission_id: string; submitted_by: string } | undefined;
    if (!submission) {
      return mcfError('mcf promote', ERR.SUBMISSION_NOT_FOUND, `Submission '${submissionId}' not found for packet '${packetId}'`, { submission_id: submissionId, packet_id: packetId });
    }

    // 3. Check 1:1 — no existing promotion for this submission
    const existing = db.prepare('SELECT knowledge_promotion_id FROM knowledge_promotions WHERE submission_id = ?').get(submissionId) as { knowledge_promotion_id: string } | undefined;
    if (existing) {
      return mcfError('mcf promote', ERR.ALREADY_PROMOTED, `Submission '${submissionId}' already has a promotion`, { existing_promotion_id: existing.knowledge_promotion_id });
    }

    // 4. Independence: promoter != builder
    if (promoter === submission.submitted_by) {
      return mcfError('mcf promote', ERR.INDEPENDENCE_VIOLATION, `Promoter '${promoter}' is the same as builder '${submission.submitted_by}'`, { promoter, builder: submission.submitted_by });
    }

    const now = nowISO();
    const promotionId = generateId('kp');

    db.transaction(() => {
      db.prepare(`
        INSERT INTO knowledge_promotions (
          knowledge_promotion_id, packet_id, submission_id, promoted_by, promoted_at,
          status, repo_note_refs, relationship_refs, architecture_note_updated, docs_updated, summary
        ) VALUES (?, ?, ?, ?, ?, 'promoted', ?, ?, ?, ?, ?)
      `).run(
        promotionId, packetId, submissionId, promoter, now,
        JSON.stringify(repoNoteRefs),
        JSON.stringify(relationshipRefs),
        architectureUpdated ? 1 : 0,
        JSON.stringify(docsUpdated),
        summary,
      );

      db.prepare(`
        INSERT INTO state_transition_log (transition_id, entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, created_at)
        VALUES (?, 'knowledge_promotion', ?, NULL, 'promoted', 'knowledge', ?, 'knowledge promoted', ?)
      `).run(generateId('tr'), promotionId, promoter, now);
    })();

    return {
      ok: true,
      command: 'mcf promote',
      result: {
        knowledge_promotion_id: promotionId,
        packet_id: packetId,
        notes_created: repoNoteRefs.length,
        relationships_created: relationshipRefs.length,
        architecture_updated: architectureUpdated,
      },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

export function promoteCommand(): Command {
  const cmd = new Command('promote')
    .description('Record knowledge promotion')
    .requiredOption('--packet <id>', 'Packet ID')
    .requiredOption('--submission <id>', 'Submission ID')
    .requiredOption('--promoter <name>', 'Knowledge role identity')
    .requiredOption('--summary <text>', 'Promotion summary')
    .option('--repo-notes <ids...>', 'Repo-knowledge note IDs', [])
    .option('--relationships <ids...>', 'Relationship IDs', [])
    .option('--architecture-updated', 'Architecture note was updated', false)
    .option('--docs-updated <files...>', 'Doc files updated', [])
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts) => {
      const result = runPromote(
        opts.dbPath, opts.packet, opts.submission, opts.promoter, opts.summary,
        opts.repoNotes, opts.relationships, opts.architectureUpdated, opts.docsUpdated,
      );
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  return cmd;
}
