CREATE TABLE IF NOT EXISTS handoff_lineage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  parent_handoff_id TEXT,
  relation TEXT NOT NULL
    CHECK (relation IN ('derived_from', 'supersedes', 'split_from', 'recovery_from')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ho_lineage_handoff ON handoff_lineage(handoff_id);
CREATE INDEX IF NOT EXISTS idx_ho_lineage_parent ON handoff_lineage(parent_handoff_id);
