CREATE TABLE IF NOT EXISTS handoff_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  approval_type TEXT NOT NULL
    CHECK (approval_type IN (
      'handoff_approval', 'packet_truth_binding', 'render_authorization'
    )),
  approval_status TEXT NOT NULL
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'revoked')),
  approved_by TEXT,
  evidence_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ho_approvals_handoff ON handoff_approvals(handoff_id, packet_version);
