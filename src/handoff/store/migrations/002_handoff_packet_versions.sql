CREATE TABLE IF NOT EXISTS handoff_packet_versions (
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  instructions_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  rejected_json TEXT NOT NULL,
  open_loops_json TEXT NOT NULL,
  artifacts_json TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (handoff_id, packet_version),
  FOREIGN KEY (handoff_id) REFERENCES handoff_packets(handoff_id)
);
