CREATE TABLE IF NOT EXISTS handoff_artifacts (
  artifact_id TEXT PRIMARY KEY,
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('file', 'log', 'diff', 'report', 'snapshot')),
  version TEXT,
  media_type TEXT,
  content_hash TEXT,
  storage_ref TEXT NOT NULL,
  size_bytes INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (handoff_id) REFERENCES handoff_packets(handoff_id)
);

CREATE INDEX IF NOT EXISTS idx_ho_artifacts_handoff ON handoff_artifacts(handoff_id, packet_version);
