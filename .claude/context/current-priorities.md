# Current Priorities — @mcptoolshop/multi-claude

## Active work

- Role OS lockdown (this audit). Sixth repo in org rollout.

## Next up

- None scheduled beyond lockdown.

## Blocked

- Nothing currently blocked.

## Completed recently

- v1.0.0 published (current)
- Wave-based parallel execution operational
- SQLite-backed claim/progress/submit/verify pipeline
- Git worktree isolation per packet
- Reconciliation (declared vs actual diff)
- Role conflict matrix (builder/verifier/integrator)
- Handoff Spine routing (5 lanes)
- 1600+ tests passing

## Banned detours

1. **No workflow engine features.** Multi-claude dispatches packets. No conditional branching, no approval UIs, no human-in-the-loop steps.
2. **No resource management.** Budget and concurrency belong to claude-guardian. No duplicate budget tracking.
3. **No merge conflict resolution.** Multi-claude produces branches. Git merge is a separate concern.
4. **No web dashboard.** The Express monitor is a control plane API, not a user-facing dashboard. No frontend.
5. **No custom worker runtimes.** Workers use Claude Agent SDK exclusively. No pluggable executor backends.

## Must-preserve invariants

These cannot be traded away without explicit human approval:

1. **Claim atomicity.** Single `db.transaction()` wraps all claim checks + mutations. UNIQUE index prevents double-claim. No advisory claims.
2. **One active claim per packet.** `idx_claims_active_packet` UNIQUE partial index. If violated, entire isolation model collapses.
3. **Per-packet worktree isolation.** Each packet gets its own git worktree + branch. Workers cannot access other packets' worktrees.
4. **Reconciliation catches undeclared changes.** If actual git diff contains files not in the declared manifest, reconciliation reports them. Filtered patterns (node_modules, dist, etc.) are documented exceptions.
5. **Verification is a gate.** Submitted → verifying → verified is required. No shortcut to merged without verification.
6. **Role conflict enforcement.** Integrator must not have built in the same feature. Verifier must not have built the same packet. DB-enforced.
7. **Stop reason reflects output classification.** `completed` = valid JSON exists. `failed` = ERROR file present. `malformed_output` = invalid/missing JSON. These are output-driven, not exit-code-driven.
8. **Database is source of truth.** Packet status, claim ownership, attempt history, verification results — all queryable from SQLite. No in-memory-only state for critical data (session registry is explicitly non-critical).
9. **Starter-pack, CLI, and docs must remain synchronized.** Changes to packet lifecycle, claim semantics, or reconciliation rules require updates to all consuming surfaces.

## Validation law

- `npm test` runs 1600+ tests covering atomicity, conflicts, e2e, routing
- `npm run build` compiles TypeScript
- CI matrix: Node 20 + 22
- All validation is terminal-based
