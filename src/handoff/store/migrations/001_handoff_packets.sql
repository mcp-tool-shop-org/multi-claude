CREATE TABLE IF NOT EXISTS handoff_packets (
  handoff_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'invalidated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ho_packets_project ON handoff_packets(project_id);
CREATE INDEX IF NOT EXISTS idx_ho_packets_run ON handoff_packets(run_id);
CREATE INDEX IF NOT EXISTS idx_ho_packets_status ON handoff_packets(status);
