# Brand Rules — @mcptoolshop/multi-claude

## Tone

Operational. Transactional. Multi-claude reports claim results, worker outcomes, reconciliation verdicts, and verification results. It does not narrate, celebrate, or soften failures.

## Domain language

| Term | Meaning | Never say instead |
|------|---------|-------------------|
| packet | A scoped unit of work with declared inputs, outputs, and dependencies | "task", "job", "ticket" |
| lane | A dispatch category derived from role + priority (worker/reviewer/approver/recovery) | "queue", "channel" |
| claim | Atomic exclusive ownership of a packet with a 2-hour lease | "lock", "reservation" |
| wave | A set of packets dispatched in parallel within one execution cycle | "batch", "round" |
| worktree | A per-packet git worktree providing file isolation | "workspace", "sandbox" |
| reconciliation | Comparison of declared artifact manifest against actual git diff | "validation", "check" |
| stop reason | How a worker session ended (completed/failed/malformed_output/stopped/timed_out) | "status", "result" |
| verdict | Verification outcome (pass/fail with specific check results) | "judgment", "review" |
| attempt | A numbered execution of a packet (retry increments attempt number) | "try", "run" |

## Forbidden metaphors

- No "intelligent dispatch" language. Dispatch is wave-based, deterministic, and dependency-ordered. Not smart.
- No "self-healing" language. Failed packets stay failed until manually retried or re-planned.
- No "orchestration magic." Multi-claude is a transaction system with git isolation. The mechanics are explicit.
- No "team" language for workers. Workers are Claude sessions with scoped prompts, not team members.

## Truth constraints

1. **Claim is atomic or it didn't happen.** If `runClaim()` returns ok:true, the packet is exclusively owned. No partial claims, no "almost claimed."
2. **Stop reason reflects output classification, not worker exit.** `completed` means valid JSON artifacts exist. It does NOT mean reconciliation passed or verification succeeded.
3. **Reconciliation filtered patterns are documented.** Build artifact paths (node_modules, dist, etc.) are invisible to reconciliation. This is a known limitation, not a feature.
4. **Verification is a gate, not a suggestion.** Submitted packets must pass verification before merging. No bypass, no override, no "good enough."

## Enforcement language bans

1. **No "the system handles it."** Multi-claude dispatches and tracks. If something fails, the operator must intervene. No implied automatic recovery.
2. **No "safely isolated."** Isolation is per-packet worktree + DB claim. It is not "safe" — it has known gaps (worktree outside transaction, session registry in memory). Be precise about what's isolated and what isn't.
3. **No "verified" for unverified work.** Only work that has passed the verification gate is verified. Submitted ≠ verified. Completed ≠ verified.
4. **No "parallel" without qualifying the scope.** Parallel within waves, serial between waves. Not arbitrary parallelism.

## Contamination risks

- **"Workflow engine" drift.** Multi-claude executes packets with isolation. The moment it adds conditional branching, approval flows, or human-in-the-loop steps beyond claim/verify, it has become a workflow engine.
- **"Resource manager" drift.** Budget and concurrency belong to claude-guardian. Multi-claude should not duplicate budget tracking or concurrency limiting.
- **"Merge tool" drift.** Multi-claude produces branches. Merge conflict resolution, rebasing, and branch cleanup are separate concerns.
