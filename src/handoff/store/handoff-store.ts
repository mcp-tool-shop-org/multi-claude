/**
 * Handoff Spine — Durable store.
 *
 * All packet reads are exact-lookup by ID. No fuzzy retrieval.
 * Packet versions are immutable once written.
 * The store records render events and usage for full audit trail.
 */

import type Database from 'better-sqlite3';
import type {
  HandoffPacket,
  HandoffPacketRecord,
  HandoffId,
  PacketVersion,
  HandoffPacketStatus,
} from '../schema/packet.js';
import type { HandoffArtifactRecord } from '../schema/artifact.js';
import type { RenderEventRecord, HandoffUseRecord } from '../schema/render.js';
import type {
  HandoffLineageRecord,
  HandoffInvalidationRecord,
  HandoffApprovalRecord,
  HandoffPacketVersionRow,
  LineageRelation,
  InvalidationReasonCode,
} from '../schema/version.js';
import { migrateHandoffSchema } from './handoff-sql.js';
import { nowISO } from '../../lib/ids.js';

export class HandoffStore {
  constructor(private readonly db: Database.Database) {}

  migrate(): void {
    migrateHandoffSchema(this.db);
  }

  // ── Packet identity ───────────────────────────────────────────

  createPacket(record: HandoffPacketRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_packets (handoff_id, project_id, run_id, current_version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.handoffId,
      record.projectId,
      record.runId,
      record.currentVersion,
      record.status,
      record.createdAt,
      record.updatedAt,
    );
  }

  getPacket(handoffId: HandoffId): HandoffPacketRecord | null {
    const row = this.db.prepare(
      `SELECT handoff_id, project_id, run_id, current_version, status, created_at, updated_at
       FROM handoff_packets WHERE handoff_id = ?`
    ).get(handoffId) as {
      handoff_id: string; project_id: string; run_id: string;
      current_version: number; status: string; created_at: string; updated_at: string;
    } | undefined;

    if (!row) return null;
    return {
      handoffId: row.handoff_id,
      projectId: row.project_id,
      runId: row.run_id,
      currentVersion: row.current_version,
      status: row.status as HandoffPacketStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Find all handoff packets for a given run ID, most recent first.
   */
  findHandoffsByRunId(runId: string): HandoffPacketRecord[] {
    const rows = this.db.prepare(
      `SELECT handoff_id, project_id, run_id, current_version, status, created_at, updated_at
       FROM handoff_packets WHERE run_id = ? ORDER BY created_at DESC`
    ).all(runId) as Array<{
      handoff_id: string; project_id: string; run_id: string;
      current_version: number; status: string; created_at: string; updated_at: string;
    }>;

    return rows.map(row => ({
      handoffId: row.handoff_id,
      projectId: row.project_id,
      runId: row.run_id,
      currentVersion: row.current_version,
      status: row.status as HandoffPacketStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updatePacketStatus(handoffId: HandoffId, status: HandoffPacketStatus): void {
    this.db.prepare(
      `UPDATE handoff_packets SET status = ?, updated_at = ? WHERE handoff_id = ?`
    ).run(status, nowISO(), handoffId);
  }

  updateCurrentVersion(handoffId: HandoffId, version: PacketVersion): void {
    this.db.prepare(
      `UPDATE handoff_packets SET current_version = ?, updated_at = ? WHERE handoff_id = ?`
    ).run(version, nowISO(), handoffId);
  }

  // ── Packet versions (immutable) ───────────────────────────────

  insertVersion(row: HandoffPacketVersionRow): void {
    this.db.prepare(`
      INSERT INTO handoff_packet_versions
        (handoff_id, packet_version, created_at, summary, instructions_json,
         decisions_json, rejected_json, open_loops_json, artifacts_json,
         scope_json, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.handoffId,
      row.packetVersion,
      row.createdAt,
      row.summary,
      row.instructionsJson,
      row.decisionsJson,
      row.rejectedJson,
      row.openLoopsJson,
      row.artifactsJson,
      row.scopeJson,
      row.contentHash,
    );
  }

  getVersion(handoffId: HandoffId, version: PacketVersion): HandoffPacketVersionRow | null {
    const row = this.db.prepare(
      `SELECT handoff_id, packet_version, created_at, summary,
              instructions_json, decisions_json, rejected_json,
              open_loops_json, artifacts_json, scope_json, content_hash
       FROM handoff_packet_versions
       WHERE handoff_id = ? AND packet_version = ?`
    ).get(handoffId, version) as {
      handoff_id: string; packet_version: number; created_at: string;
      summary: string; instructions_json: string; decisions_json: string;
      rejected_json: string; open_loops_json: string; artifacts_json: string;
      scope_json: string; content_hash: string;
    } | undefined;

    if (!row) return null;
    return {
      handoffId: row.handoff_id,
      packetVersion: row.packet_version,
      createdAt: row.created_at,
      summary: row.summary,
      instructionsJson: row.instructions_json,
      decisionsJson: row.decisions_json,
      rejectedJson: row.rejected_json,
      openLoopsJson: row.open_loops_json,
      artifactsJson: row.artifacts_json,
      scopeJson: row.scope_json,
      contentHash: row.content_hash,
    };
  }

  listVersions(handoffId: HandoffId): HandoffPacketVersionRow[] {
    const rows = this.db.prepare(
      `SELECT handoff_id, packet_version, created_at, summary,
              instructions_json, decisions_json, rejected_json,
              open_loops_json, artifacts_json, scope_json, content_hash
       FROM handoff_packet_versions
       WHERE handoff_id = ?
       ORDER BY packet_version ASC`
    ).all(handoffId) as Array<{
      handoff_id: string; packet_version: number; created_at: string;
      summary: string; instructions_json: string; decisions_json: string;
      rejected_json: string; open_loops_json: string; artifacts_json: string;
      scope_json: string; content_hash: string;
    }>;

    return rows.map(row => ({
      handoffId: row.handoff_id,
      packetVersion: row.packet_version,
      createdAt: row.created_at,
      summary: row.summary,
      instructionsJson: row.instructions_json,
      decisionsJson: row.decisions_json,
      rejectedJson: row.rejected_json,
      openLoopsJson: row.open_loops_json,
      artifactsJson: row.artifacts_json,
      scopeJson: row.scope_json,
      contentHash: row.content_hash,
    }));
  }

  /**
   * Reconstruct a full HandoffPacket from stored version row + parent record.
   */
  reconstructPacket(handoffId: HandoffId, version?: PacketVersion): HandoffPacket | null {
    const record = this.getPacket(handoffId);
    if (!record) return null;

    const v = version ?? record.currentVersion;
    const row = this.getVersion(handoffId, v);
    if (!row) return null;

    return {
      handoffId: row.handoffId,
      packetVersion: row.packetVersion,
      createdAt: row.createdAt,
      derivedFromRunId: record.runId,
      scope: JSON.parse(row.scopeJson),
      summary: row.summary,
      instructions: JSON.parse(row.instructionsJson),
      decisions: JSON.parse(row.decisionsJson),
      rejected: JSON.parse(row.rejectedJson),
      openLoops: JSON.parse(row.openLoopsJson),
      artifacts: JSON.parse(row.artifactsJson),
      contentHash: row.contentHash,
    };
  }

  // ── Artifacts ─────────────────────────────────────────────────

  insertArtifact(record: HandoffArtifactRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_artifacts
        (artifact_id, handoff_id, packet_version, name, kind, version,
         media_type, content_hash, storage_ref, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.artifactId,
      record.handoffId,
      record.packetVersion,
      record.name,
      record.kind,
      record.version ?? null,
      record.mediaType ?? null,
      record.contentHash ?? null,
      record.storageRef,
      record.sizeBytes ?? null,
      record.createdAt,
    );
  }

  getArtifacts(handoffId: HandoffId, packetVersion: PacketVersion): HandoffArtifactRecord[] {
    const rows = this.db.prepare(
      `SELECT artifact_id, handoff_id, packet_version, name, kind, version,
              media_type, content_hash, storage_ref, size_bytes, created_at
       FROM handoff_artifacts
       WHERE handoff_id = ? AND packet_version = ?`
    ).all(handoffId, packetVersion) as Array<{
      artifact_id: string; handoff_id: string; packet_version: number;
      name: string; kind: string; version: string | null;
      media_type: string | null; content_hash: string | null;
      storage_ref: string; size_bytes: number | null; created_at: string;
    }>;

    return rows.map(r => ({
      artifactId: r.artifact_id,
      handoffId: r.handoff_id,
      packetVersion: r.packet_version,
      name: r.name,
      kind: r.kind as HandoffArtifactRecord['kind'],
      version: r.version ?? undefined,
      mediaType: r.media_type ?? undefined,
      contentHash: r.content_hash ?? undefined,
      storageRef: r.storage_ref,
      sizeBytes: r.size_bytes ?? undefined,
      createdAt: r.created_at,
    }));
  }

  // ── Lineage ───────────────────────────────────────────────────

  insertLineage(record: HandoffLineageRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_lineage (handoff_id, parent_handoff_id, relation, created_at)
      VALUES (?, ?, ?, ?)
    `).run(record.handoffId, record.parentHandoffId ?? null, record.relation, record.createdAt);
  }

  getLineage(handoffId: HandoffId): HandoffLineageRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, parent_handoff_id, relation, created_at
       FROM handoff_lineage WHERE handoff_id = ? ORDER BY created_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; parent_handoff_id: string | null;
      relation: string; created_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      parentHandoffId: r.parent_handoff_id ?? undefined,
      relation: r.relation as LineageRelation,
      createdAt: r.created_at,
    }));
  }

  getDescendants(handoffId: HandoffId): HandoffLineageRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, parent_handoff_id, relation, created_at
       FROM handoff_lineage WHERE parent_handoff_id = ? ORDER BY created_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; parent_handoff_id: string | null;
      relation: string; created_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      parentHandoffId: r.parent_handoff_id ?? undefined,
      relation: r.relation as LineageRelation,
      createdAt: r.created_at,
    }));
  }

  // ── Invalidations ─────────────────────────────────────────────

  insertInvalidation(record: HandoffInvalidationRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_invalidations (handoff_id, packet_version, reason_code, reason, invalidated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.handoffId, record.packetVersion, record.reasonCode, record.reason, record.invalidatedAt);
  }

  getInvalidations(handoffId: HandoffId): HandoffInvalidationRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, packet_version, reason_code, reason, invalidated_at
       FROM handoff_invalidations WHERE handoff_id = ? ORDER BY invalidated_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; packet_version: number;
      reason_code: string; reason: string; invalidated_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      packetVersion: r.packet_version,
      reasonCode: r.reason_code as InvalidationReasonCode,
      reason: r.reason,
      invalidatedAt: r.invalidated_at,
    }));
  }

  isVersionInvalidated(handoffId: HandoffId, version: PacketVersion): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM handoff_invalidations WHERE handoff_id = ? AND packet_version = ? LIMIT 1`
    ).get(handoffId, version);
    return row !== undefined;
  }

  // ── Render events ─────────────────────────────────────────────

  insertRenderEvent(record: RenderEventRecord): number {
    const result = this.db.prepare(`
      INSERT INTO handoff_render_events
        (handoff_id, packet_version, role_renderer, renderer_version,
         model_adapter, adapter_version, token_budget, rendered_at, output_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.handoffId,
      record.packetVersion,
      record.roleRenderer,
      record.rendererVersion,
      record.modelAdapter,
      record.adapterVersion,
      record.tokenBudget ?? null,
      record.renderedAt,
      record.outputHash,
    );
    return Number(result.lastInsertRowid);
  }

  getRenderEvents(handoffId: HandoffId): RenderEventRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, packet_version, role_renderer, renderer_version,
              model_adapter, adapter_version, token_budget, rendered_at, output_hash
       FROM handoff_render_events WHERE handoff_id = ? ORDER BY rendered_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; packet_version: number;
      role_renderer: string; renderer_version: string;
      model_adapter: string; adapter_version: string;
      token_budget: number | null; rendered_at: string; output_hash: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      packetVersion: r.packet_version,
      roleRenderer: r.role_renderer,
      rendererVersion: r.renderer_version,
      modelAdapter: r.model_adapter,
      adapterVersion: r.adapter_version,
      tokenBudget: r.token_budget ?? undefined,
      renderedAt: r.rendered_at,
      outputHash: r.output_hash,
    }));
  }

  // ── Uses ──────────────────────────────────────────────────────

  insertUse(record: HandoffUseRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_uses
        (handoff_id, packet_version, render_event_id, consumer_run_id, consumer_role, used_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.handoffId,
      record.packetVersion,
      record.renderEventId ?? null,
      record.consumerRunId,
      record.consumerRole,
      record.usedAt,
    );
  }

  getUses(handoffId: HandoffId): HandoffUseRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, packet_version, render_event_id, consumer_run_id, consumer_role, used_at
       FROM handoff_uses WHERE handoff_id = ? ORDER BY used_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; packet_version: number;
      render_event_id: number | null; consumer_run_id: string;
      consumer_role: string; used_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      packetVersion: r.packet_version,
      renderEventId: r.render_event_id ?? undefined,
      consumerRunId: r.consumer_run_id,
      consumerRole: r.consumer_role,
      usedAt: r.used_at,
    }));
  }

  // ── Approvals ─────────────────────────────────────────────────

  insertApproval(record: HandoffApprovalRecord): void {
    this.db.prepare(`
      INSERT INTO handoff_approvals
        (handoff_id, packet_version, approval_type, approval_status,
         approved_by, evidence_fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.handoffId,
      record.packetVersion,
      record.approvalType,
      record.approvalStatus,
      record.approvedBy ?? null,
      record.evidenceFingerprint ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }

  getApprovals(handoffId: HandoffId): HandoffApprovalRecord[] {
    const rows = this.db.prepare(
      `SELECT id, handoff_id, packet_version, approval_type, approval_status,
              approved_by, evidence_fingerprint, created_at, updated_at
       FROM handoff_approvals WHERE handoff_id = ? ORDER BY created_at ASC`
    ).all(handoffId) as Array<{
      id: number; handoff_id: string; packet_version: number;
      approval_type: string; approval_status: string;
      approved_by: string | null; evidence_fingerprint: string | null;
      created_at: string; updated_at: string;
    }>;

    return rows.map(r => ({
      id: r.id,
      handoffId: r.handoff_id,
      packetVersion: r.packet_version,
      approvalType: r.approval_type as HandoffApprovalRecord['approvalType'],
      approvalStatus: r.approval_status as HandoffApprovalRecord['approvalStatus'],
      approvedBy: r.approved_by ?? undefined,
      evidenceFingerprint: r.evidence_fingerprint ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ── Transactions ──────────────────────────────────────────────

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
