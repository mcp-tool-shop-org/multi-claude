-- Factory Fitness Schema — v1.0.0
-- Scoring entities for run, packet, and role fitness.

CREATE TABLE IF NOT EXISTS run_scores (
    run_id              TEXT PRIMARY KEY,
    feature_id          TEXT NOT NULL,
    total_score         REAL NOT NULL DEFAULT 0,
    quality_score       REAL NOT NULL DEFAULT 0,
    lawfulness_score    REAL NOT NULL DEFAULT 0,
    collaboration_score REAL NOT NULL DEFAULT 0,
    velocity_score      REAL NOT NULL DEFAULT 0,
    grade               TEXT NOT NULL DEFAULT 'F'
                        CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'computed', 'final')),
    scoring_version     TEXT NOT NULL DEFAULT '1.0.0',
    penalties_json      TEXT NOT NULL DEFAULT '[]',
    evidence_json       TEXT NOT NULL DEFAULT '{}',
    computed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS packet_scores (
    packet_id           TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL,
    packet_class        TEXT NOT NULL
                        CHECK (packet_class IN ('state_domain', 'backend', 'ui_component', 'ui_interaction', 'verification', 'integration', 'docs_knowledge', 'proof_control')),
    submit_score        REAL NOT NULL DEFAULT 0,
    verify_score        REAL NOT NULL DEFAULT 0,
    integrate_score     REAL NOT NULL DEFAULT 0,
    penalties           REAL NOT NULL DEFAULT 0,
    final_score         REAL NOT NULL DEFAULT 0,
    maturation_stage    TEXT NOT NULL DEFAULT 'none'
                        CHECK (maturation_stage IN ('none', 'submitted', 'verified', 'integrated')),
    duration_seconds    REAL,
    duration_score      REAL,
    evidence_json       TEXT NOT NULL DEFAULT '{}',
    computed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS role_contributions (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL,
    role                TEXT NOT NULL,
    contribution_score  REAL NOT NULL DEFAULT 0,
    quality_component   REAL NOT NULL DEFAULT 0,
    collaboration_component REAL NOT NULL DEFAULT 0,
    penalties           REAL NOT NULL DEFAULT 0,
    notes               TEXT,
    computed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS score_events (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL,
    event_type          TEXT NOT NULL,
    source_entity       TEXT NOT NULL,
    source_id           TEXT NOT NULL,
    metric_key          TEXT NOT NULL,
    delta               REAL NOT NULL,
    evidence_ref        TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_packet_scores_run ON packet_scores(run_id);
CREATE INDEX IF NOT EXISTS idx_role_contributions_run ON role_contributions(run_id);
CREATE INDEX IF NOT EXISTS idx_score_events_run ON score_events(run_id, metric_key);
