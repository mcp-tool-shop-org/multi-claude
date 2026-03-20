CREATE TABLE IF NOT EXISTS handoff_invalidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  reason_code TEXT NOT NULL
    CHECK (reason_code IN (
      'schema_drift', 'execution_diverged', 'approval_revoked',
      'superseded', 'manual', 'integrity_failure'
    )),
  reason TEXT NOT NULL,
  invalidated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ho_invalidations_handoff ON handoff_invalidations(handoff_id, packet_version);
