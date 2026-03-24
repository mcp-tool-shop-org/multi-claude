# Product Brief — @mcptoolshop/multi-claude

## What this is

A lane-based parallel execution system for orchestrating multiple Claude Code sessions. Decomposes features into packets, claims them atomically via SQLite, executes them in isolated git worktrees via the Claude Agent SDK, reconciles output against declared manifests, and verifies results before merging. Wave-based dispatch: parallel within waves, serial between waves.

## Thesis

Complex features require multiple specialists working in parallel without stepping on each other. Multi-claude solves this by enforcing packet-level isolation (each worker gets its own worktree), atomic claim ownership (SQLite transactions prevent double-assignment), and manifest-based reconciliation (declared output vs actual diff). The database is the source of truth for who owns what, what state it's in, and what was produced.

## Target user

- Org repos undergoing full treatment (multi-packet feature work, integration, verification)
- Orchestration systems that need to dispatch parallel Claude sessions with isolation guarantees
- Any codebase where multiple AI workers need to modify files without conflict

## Core value

Parallel execution with isolation. Multiple Claude sessions work simultaneously on the same repo, each in its own worktree, with atomic claims preventing double-assignment and reconciliation catching undeclared changes. The database is always queryable for current state.

## Non-goals

- Multi-claude is not a task scheduler. It dispatches work; it does not decide what work to do.
- Multi-claude is not a CI system. It executes and verifies packets; CI validates the repo.
- Multi-claude is not a merge tool. It produces branches; merge is a separate step.
- Multi-claude is not a resource manager. Budget management belongs to claude-guardian, not here.

## Anti-thesis — what this product must never become

1. **A tool that hides isolation failures.** If a worker modifies files outside its declared scope, reconciliation must catch it. Filtered patterns (node_modules, dist, .multi-claude) are documented exceptions, not loopholes.
2. **A tool where claim ownership is advisory.** Claims are atomic and exclusive. One active claim per packet, enforced by UNIQUE index + transaction. If this becomes advisory, the entire isolation model collapses.
3. **A tool that silently swallows lane failures.** If a worker fails, times out, or produces malformed output, the stop reason must be recorded truthfully. `completed` means the output validated — not that the worker exited cleanly.
4. **A tool where the database can lie about state.** The SQLite database is the source of truth. Packet status, claim ownership, attempt history, and verification results must always reflect actual state. Manual DB edits that create illegal state transitions are operator errors, not product features.
5. **A tool that merges unverified work.** Verification is a gate. Submitted → verifying → verified is a required path. No shortcut from submitted to merged.
6. **A tool with configurable isolation weakening.** No flags to skip reconciliation, ignore scope violations, or bypass role conflict checks.
