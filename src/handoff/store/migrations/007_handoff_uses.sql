CREATE TABLE IF NOT EXISTS handoff_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  render_event_id INTEGER,
  consumer_run_id TEXT NOT NULL,
  consumer_role TEXT NOT NULL,
  used_at TEXT NOT NULL,
  FOREIGN KEY (render_event_id) REFERENCES handoff_render_events(id)
);

CREATE INDEX IF NOT EXISTS idx_ho_uses_handoff ON handoff_uses(handoff_id, packet_version);
CREATE INDEX IF NOT EXISTS idx_ho_uses_consumer ON handoff_uses(consumer_run_id);
