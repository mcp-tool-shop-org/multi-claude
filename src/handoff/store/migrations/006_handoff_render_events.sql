CREATE TABLE IF NOT EXISTS handoff_render_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handoff_id TEXT NOT NULL,
  packet_version INTEGER NOT NULL,
  role_renderer TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  model_adapter TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  token_budget INTEGER,
  rendered_at TEXT NOT NULL,
  output_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ho_render_events_handoff ON handoff_render_events(handoff_id, packet_version);
