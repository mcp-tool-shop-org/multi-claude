/**
 * Calibration Law — Store.
 *
 * Durable calibration report snapshots.
 */

import type Database from 'better-sqlite3';
import { migrateCalibrationSchema } from './calibration-sql.js';
import type { CalibrationReport } from './types.js';

export class CalibrationStore {
  constructor(private db: Database.Database) {}

  migrate(): void {
    migrateCalibrationSchema(this.db);
  }

  insertReport(report: CalibrationReport): void {
    this.db.prepare(`
      INSERT INTO calibration_reports
        (report_id, policy_set_id, policy_version, scope, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      report.reportId, report.policySetId, report.policyVersion,
      report.scope, JSON.stringify(report), report.createdAt,
    );
  }

  getReport(reportId: string): CalibrationReport | undefined {
    const row = this.db.prepare(
      'SELECT content FROM calibration_reports WHERE report_id = ?',
    ).get(reportId) as { content: string } | undefined;
    return row ? JSON.parse(row.content) as CalibrationReport : undefined;
  }

  listReports(opts?: { policySetId?: string; limit?: number }): CalibrationReport[] {
    let sql = 'SELECT content FROM calibration_reports WHERE 1=1';
    const params: unknown[] = [];
    if (opts?.policySetId) { sql += ' AND policy_set_id = ?'; params.push(opts.policySetId); }
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    return (this.db.prepare(sql).all(...params) as { content: string }[])
      .map(r => JSON.parse(r.content) as CalibrationReport);
  }
}
