-- MCF Execution DB Schema v0.1.0
-- Generated from EXECUTION-DB.md

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ── Features ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS features (
    feature_id            TEXT PRIMARY KEY,
    repo_slug             TEXT NOT NULL,
    title                 TEXT NOT NULL,
    objective             TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'proposed'
                          CHECK (status IN (
                              'proposed', 'approved', 'in_progress',
                              'verifying', 'complete', 'abandoned', 'superseded'
                          )),
    priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('critical', 'high', 'normal', 'low')),
    merge_target          TEXT NOT NULL,
    constitution_refs     TEXT,
    acceptance_criteria   TEXT NOT NULL,
    summary_fragment      TEXT,
    release_note_fragment TEXT,
    created_by            TEXT NOT NULL,
    approved_by           TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    approved_at           TEXT,
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at          TEXT
);

-- ── Packets ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS packets (
    packet_id               TEXT PRIMARY KEY,
    feature_id              TEXT NOT NULL REFERENCES features(feature_id),
    title                   TEXT NOT NULL,
    layer                   TEXT NOT NULL
                            CHECK (layer IN (
                                'contract', 'backend', 'state', 'ui',
                                'integration', 'docs', 'test'
                            )),
    descriptor              TEXT NOT NULL,
    role                    TEXT NOT NULL
                            CHECK (role IN (
                                'builder', 'verifier', 'integrator',
                                'coordinator', 'architect', 'knowledge', 'sweep'
                            )),
    playbook_id             TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN (
                                'draft', 'ready', 'claimed', 'in_progress',
                                'submitted', 'verifying', 'verified',
                                'integrating', 'merged',
                                'blocked', 'failed', 'abandoned', 'superseded'
                            )),
    goal                    TEXT NOT NULL,
    acceptance_criteria     TEXT,
    context                 TEXT,
    allowed_files           TEXT NOT NULL,
    forbidden_files         TEXT NOT NULL DEFAULT '[]',
    module_family           TEXT,
    protected_file_access   TEXT NOT NULL DEFAULT 'none'
                            CHECK (protected_file_access IN ('none', 'merge_only', 'author_approved')),
    seam_file_access        TEXT NOT NULL DEFAULT 'none'
                            CHECK (seam_file_access IN ('none', 'declare_only', 'modify')),
    merge_with_layer        TEXT,
    sequence_display        INTEGER,
    verification_profile_id TEXT NOT NULL,
    verification_overrides  TEXT,
    rule_profile            TEXT NOT NULL DEFAULT 'builder'
                            CHECK (rule_profile IN ('builder', 'integration', 'contract', 'docs')),
    contract_delta_policy   TEXT NOT NULL DEFAULT 'declare'
                            CHECK (contract_delta_policy IN (
                                'none', 'declare', 'fast_path', 'author'
                            )),
    knowledge_writeback_required INTEGER NOT NULL DEFAULT 1,
    merge_target            TEXT,
    created_by              TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    superseded_by_packet_id TEXT REFERENCES packets(packet_id)
);

-- ── Packet Dependencies ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS packet_dependencies (
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    depends_on_packet_id   TEXT NOT NULL REFERENCES packets(packet_id),
    dependency_type        TEXT NOT NULL
                           CHECK (dependency_type IN ('hard', 'soft')),
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (packet_id, depends_on_packet_id),
    CHECK (packet_id != depends_on_packet_id)
);

-- ── Packet Attempts ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS packet_attempts (
    attempt_id             TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_number         INTEGER NOT NULL,
    started_by             TEXT NOT NULL,
    started_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    ended_at               TEXT,
    end_reason             TEXT
                           CHECK (end_reason IS NULL OR end_reason IN (
                               'submitted', 'failed', 'expired', 'abandoned', 'blocked'
                           )),
    session_id             TEXT,
    branch_name            TEXT,
    worktree_path          TEXT,
    model_name             TEXT,
    role                   TEXT NOT NULL,
    summary                TEXT,
    UNIQUE (packet_id, attempt_number)
);

-- ── Claims ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS claims (
    claim_id               TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_id             TEXT NOT NULL REFERENCES packet_attempts(attempt_id),
    claimed_by             TEXT NOT NULL,
    session_id             TEXT,
    claimed_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    lease_expires_at       TEXT NOT NULL,
    renewal_count          INTEGER NOT NULL DEFAULT 0,
    released_at            TEXT,
    release_reason         TEXT
                           CHECK (release_reason IS NULL OR release_reason IN (
                               'submitted', 'expired', 'abandoned', 'blocked', 'failed', 'manual'
                           )),
    is_active              INTEGER NOT NULL DEFAULT 1
                           CHECK (is_active IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_active_packet
    ON claims(packet_id) WHERE is_active = 1;

-- ── Packet Submissions ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS packet_submissions (
    submission_id          TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_id             TEXT NOT NULL REFERENCES packet_attempts(attempt_id),
    submitted_by           TEXT NOT NULL,
    submitted_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    patch_ref              TEXT,
    artifact_manifest      TEXT NOT NULL,
    contract_delta_ref     TEXT REFERENCES contract_deltas(contract_delta_id),
    writeback              TEXT NOT NULL,
    seam_changes           TEXT,
    amendments_applied     TEXT,
    declared_merge_ready   INTEGER NOT NULL CHECK (declared_merge_ready IN (0, 1)),
    merge_blockers         TEXT,
    builder_summary        TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_attempt
    ON packet_submissions(attempt_id);

-- ── Verification Results ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verification_results (
    verification_result_id TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_id             TEXT NOT NULL REFERENCES packet_attempts(attempt_id),
    submission_id          TEXT NOT NULL REFERENCES packet_submissions(submission_id),
    verified_by            TEXT NOT NULL,
    verifier_role          TEXT NOT NULL
                           CHECK (verifier_role IN ('verifier-checklist', 'verifier-analysis')),
    started_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at           TEXT,
    status                 TEXT NOT NULL DEFAULT 'verifying'
                           CHECK (status IN ('verifying', 'verified', 'failed', 'incomplete')),
    rule_profile           TEXT NOT NULL,
    checks                 TEXT NOT NULL,
    failures               TEXT,
    artifacts              TEXT,
    failure_analysis       TEXT,
    retry_recommendation   TEXT
                           CHECK (retry_recommendation IS NULL OR retry_recommendation IN (
                               'retry', 'amend', 'supersede', 'escalate'
                           )),
    summary                TEXT NOT NULL
);

-- ── Packet Amendments ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS packet_amendments (
    amendment_id           TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_id             TEXT REFERENCES packet_attempts(attempt_id),
    amendment_class        TEXT NOT NULL
                           CHECK (amendment_class IN ('minor', 'major')),
    proposed_by            TEXT NOT NULL,
    proposed_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    reason                 TEXT NOT NULL,
    requested_changes      TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
    reviewed_by            TEXT,
    reviewed_at            TEXT,
    resolution_notes       TEXT
);

-- ── Contract Deltas ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contract_deltas (
    contract_delta_id      TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    attempt_id             TEXT REFERENCES packet_attempts(attempt_id),
    scope                  TEXT NOT NULL
                           CHECK (scope IN ('fast_path', 'protected', 'major')),
    status                 TEXT NOT NULL DEFAULT 'proposed'
                           CHECK (status IN (
                               'proposed', 'approved', 'rejected',
                               'landed', 'superseded'
                           )),
    proposed_by            TEXT NOT NULL,
    proposed_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    description            TEXT NOT NULL,
    affected_files         TEXT NOT NULL,
    affected_packets       TEXT,
    compatibility_impact   TEXT NOT NULL
                           CHECK (compatibility_impact IN ('none', 'additive', 'breaking')),
    fast_path_claim        TEXT,
    approval_required      INTEGER NOT NULL DEFAULT 1
                           CHECK (approval_required IN (0, 1)),
    approved_by            TEXT,
    approved_at            TEXT,
    resolution_notes       TEXT
);

-- ── Approvals ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approvals (
    approval_id            TEXT PRIMARY KEY,
    scope_type             TEXT NOT NULL
                           CHECK (scope_type IN (
                               'feature', 'packet', 'packet_graph',
                               'contract_delta', 'integration_run',
                               'amendment', 'law_amendment', 'exception'
                           )),
    scope_id               TEXT NOT NULL,
    approval_type          TEXT NOT NULL
                           CHECK (approval_type IN (
                               'feature_approval', 'packet_graph_approval',
                               'protected_file_change', 'contract_delta_approval',
                               'merge_approval', 'amendment_approval',
                               'law_amendment', 'exception'
                           )),
    decision               TEXT NOT NULL
                           CHECK (decision IN ('approved', 'rejected', 'approved_with_conditions')),
    conditions             TEXT,
    actor                  TEXT NOT NULL,
    rationale              TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Integration Runs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS integration_runs (
    integration_run_id     TEXT PRIMARY KEY,
    feature_id             TEXT NOT NULL REFERENCES features(feature_id),
    status                 TEXT NOT NULL DEFAULT 'preparing'
                           CHECK (status IN (
                               'preparing', 'integrating', 'merged', 'failed', 'abandoned'
                           )),
    started_by             TEXT NOT NULL,
    started_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at           TEXT,
    integrator_session_id  TEXT,
    packets_included       TEXT NOT NULL,
    seam_changes_applied   TEXT,
    merge_target           TEXT NOT NULL,
    full_verification_pass INTEGER,
    merge_approval_id      TEXT REFERENCES approvals(approval_id),
    summary                TEXT
);

-- ── Artifacts ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id            TEXT PRIMARY KEY,
    scope_type             TEXT NOT NULL
                           CHECK (scope_type IN (
                               'feature', 'packet', 'attempt', 'submission',
                               'verification_result', 'integration_run'
                           )),
    scope_id               TEXT NOT NULL,
    artifact_type          TEXT NOT NULL,
    path                   TEXT NOT NULL,
    checksum               TEXT,
    size_bytes             INTEGER,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_by             TEXT,
    metadata               TEXT
);

-- ── State Transition Log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS state_transition_log (
    transition_id          TEXT PRIMARY KEY,
    entity_type            TEXT NOT NULL
                           CHECK (entity_type IN (
                               'feature', 'packet', 'claim', 'submission',
                               'verification_result', 'amendment', 'contract_delta',
                               'integration_run', 'knowledge_promotion'
                           )),
    entity_id              TEXT NOT NULL,
    from_state             TEXT,
    to_state               TEXT NOT NULL,
    actor_type             TEXT NOT NULL
                           CHECK (actor_type IN (
                               'coordinator', 'architect', 'builder', 'verifier',
                               'integrator', 'knowledge', 'sweep', 'human', 'system'
                           )),
    actor_id               TEXT NOT NULL,
    reason                 TEXT,
    metadata               TEXT,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ── Knowledge Promotions ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_promotions (
    knowledge_promotion_id TEXT PRIMARY KEY,
    packet_id              TEXT NOT NULL REFERENCES packets(packet_id),
    submission_id          TEXT NOT NULL REFERENCES packet_submissions(submission_id),
    promoted_by            TEXT NOT NULL,
    promoted_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'promoted', 'rejected')),
    repo_note_refs         TEXT,
    relationship_refs      TEXT,
    architecture_note_updated INTEGER NOT NULL DEFAULT 0
                           CHECK (architecture_note_updated IN (0, 1)),
    docs_updated           TEXT,
    summary                TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_submission
    ON knowledge_promotions(submission_id);

-- ── Verification Profiles ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS verification_profiles (
    verification_profile_id TEXT PRIMARY KEY,
    repo_slug              TEXT NOT NULL,
    layer                  TEXT NOT NULL,
    name                   TEXT NOT NULL,
    rule_profile           TEXT NOT NULL
                           CHECK (rule_profile IN ('builder', 'integration', 'contract', 'docs')),
    steps                  TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    is_active              INTEGER NOT NULL DEFAULT 1
                           CHECK (is_active IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_profiles_active
    ON verification_profiles(repo_slug, layer) WHERE is_active = 1;

-- ── Indexes ──────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_features_status ON features(status);
CREATE INDEX IF NOT EXISTS idx_features_repo ON features(repo_slug);

CREATE INDEX IF NOT EXISTS idx_packets_feature_status ON packets(feature_id, status);
CREATE INDEX IF NOT EXISTS idx_packets_status_role ON packets(status, role);
CREATE INDEX IF NOT EXISTS idx_packets_layer ON packets(layer);
CREATE INDEX IF NOT EXISTS idx_packets_feature_active
    ON packets(feature_id) WHERE status IN (
        'ready', 'claimed', 'in_progress', 'submitted',
        'verifying', 'verified', 'integrating'
    );

CREATE INDEX IF NOT EXISTS idx_deps_packet ON packet_dependencies(packet_id, dependency_type);
CREATE INDEX IF NOT EXISTS idx_deps_target ON packet_dependencies(depends_on_packet_id, dependency_type);

CREATE INDEX IF NOT EXISTS idx_attempts_packet ON packet_attempts(packet_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_claims_lease_expiry ON claims(lease_expires_at) WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_submissions_packet ON packet_submissions(packet_id, submitted_at);

CREATE INDEX IF NOT EXISTS idx_verifications_packet ON verification_results(packet_id, status);
CREATE INDEX IF NOT EXISTS idx_verifications_submission ON verification_results(submission_id);

CREATE INDEX IF NOT EXISTS idx_approvals_scope ON approvals(scope_type, scope_id, approval_type);

CREATE INDEX IF NOT EXISTS idx_integration_runs_feature ON integration_runs(feature_id, status);

CREATE INDEX IF NOT EXISTS idx_transitions_entity ON state_transition_log(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transitions_actor ON state_transition_log(actor_type, actor_id, created_at);

CREATE INDEX IF NOT EXISTS idx_artifacts_scope ON artifacts(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_promotions_packet ON knowledge_promotions(packet_id);
CREATE INDEX IF NOT EXISTS idx_promotions_status ON knowledge_promotions(status);

CREATE INDEX IF NOT EXISTS idx_amendments_packet ON packet_amendments(packet_id, status);

CREATE INDEX IF NOT EXISTS idx_deltas_packet ON contract_deltas(packet_id, status);
