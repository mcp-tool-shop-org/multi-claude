/**
 * Calibration Law — SQL schema.
 *
 * Tables:
 *   - calibration_reports: durable calibration snapshots
 */

import type Database from 'better-sqlite3';

const CALIBRATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS calibration_reports (
    report_id         TEXT PRIMARY KEY,
    policy_set_id     TEXT,
    policy_version    INTEGER,
    scope             TEXT NOT NULL DEFAULT 'global',
    content           TEXT NOT NULL,
    created_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_calibration_policy
    ON calibration_reports(policy_set_id);
`;

export function migrateCalibrationSchema(db: Database.Database): void {
  db.exec(CALIBRATION_SCHEMA);
}
