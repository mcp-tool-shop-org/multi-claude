# 8C-000 Contract Freeze — Retry/Recovery Hardening (Self-Dogfood Trial)

## Trial Identity

| Field | Value |
|---|---|
| Trial ID | 8C |
| Phase | 8: Repeatability & Fit Map |
| Work Class | Control-plane / infra / self-dogfood |
| Repo | multi-claude (`F:\AI\multi-claude`) |
| Feature | Retry/Recovery Path Hardening |
| Frozen by | Operator (single-Claude) |
| Frozen at | 2026-03-19 |
| Isolation | **Worktree — mandatory, verified by smoke check** |

## Operative Framing

> Trial 8C is the self-dogfood leg of the Phase 8 fit map. Multi-claude will
> improve its own retry/recovery control plane under packet discipline. The
> central question is whether the coordination tax of parallel work on a
> law-dense, internally-coupled codebase is justified — or whether single-Claude
> is simply better for this kind of work.

## Trial Thesis

**Can multi-claude fit its own control-plane work when the task spans runtime
law, recovery state, and orchestration behavior — but without broad UI seams?**

This is the final fit-map leg. 8A proved backend/domain is strong fit. 8B proved
UI/interaction is moderate fit. 8C must answer: is infra/control-plane work a fit
at all, or does internal coupling make coordination tax too high?

## Feature: Retry/Recovery Path Hardening

### The Problem

The retry/recovery system has solid foundations (durable attempt tracking, hook
policy rules, cleanup policy) but critical paths are **dead code or unfinished**:

1. Hook policy recommends `retry_once` but `auto.ts` never executes it (CRITICAL)
2. No `max_retries` enforcement — infinite retry is theoretically possible
3. Worker crash leaves attempt in `running` state with no end_reason — blocks future claims
4. `cleanup.ts` is fully dead code — never imported, never called
5. `runAutoStop()` stops sessions but doesn't clean up worktrees
6. RuntimeEnvelope stuck in `running` if orchestrator crashes before `completeEnvelope()`

### Scope (bounded — no session persistence, no merge automation)

- Wire retry action execution in the orchestrator
- Enforce retry limits with escalation
- Guarantee attempt lifecycle completion on all exit paths
- Consolidate cleanup into a single consistent path
- Add tests for all retry/recovery/cleanup scenarios

### What is OUT of scope

- Persisting session registry to DB (architectural change, not hardening)
- Pre-integration merge conflict detection (different seam)
- Resume-after-process-crash (requires architectural work beyond hardening)
- New hook actions beyond retry_once (launch_verifier, launch_docs, etc.)
- Any changes to the hook engine itself (conditions.ts evaluation logic)

### Why this feature

- `retry_once` being dead code is a **real bug** — the policy system exists but doesn't work
- Self-dogfood tests multi-claude on its own codebase (the ultimate fitness question)
- Forces cross-file work on tightly-coupled modules (auto.ts ↔ cleanup.ts ↔ session-registry.ts)
- The coupling risk is the point — if packets can stay honest on law-dense code, that's a strong signal

## Known Coupling Risk

`auto.ts` (762 lines) is the orchestration spine. It imports from cleanup, session-registry,
envelope, claim, hooks, and runtime. Every packet will need to read it, but ownership must
be surgical:

**The key 8C rule**: No packet may both redefine recovery law AND wire orchestration behavior.
- 8C-101 defines retry law (policy, limits, attempt lifecycle)
- 8C-102 defines cleanup law (consolidate dead code, stop-cleanup)
- 8C-103 wires both into the orchestrator (consumes, does not redefine)
- 8C-104 tests the integrated behavior

This separation prevents the bad version of 8C where one packet quietly changes retry
semantics while another wires orchestration behavior that assumes the old semantics.

## Packet Graph

### Wave 1 — Parallel Law Hardening

#### 8C-101: Retry Law
| Field | Value |
|---|---|
| Class | backend/runtime |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Harden retry policy, enforce limits, guarantee attempt lifecycle completion.

**Work**:
- Add `MAX_RETRIES = 3` constant and `RetryLimitExceeded` escalation to `policy.ts`
  - New rule: `rule_4c_retry_limit` — when retryCount >= MAX_RETRIES, recommend `escalate_human` action
  - Modify `rule_4a_retry_deterministic`: change `retryCount >= 1` to `retryCount < MAX_RETRIES` (currently only allows 1 retry)
- Add `endAttempt(dbPath, packetId, endReason)` function to `claim.ts`
  - Marks the active attempt's `end_reason` and `ended_at`
  - Called on all exit paths (success, failure, crash, timeout)
  - Idempotent: no-op if attempt already ended
- Add unit tests in `test/claim.test.ts`: endAttempt on active attempt, endAttempt idempotent, endAttempt on nonexistent packet
- Add unit tests in `test/hooks/policy.test.ts`: retry_limit rule fires at MAX_RETRIES, retry_once fires below limit, escalate_human action shape

**Allowed files**:
- `src/hooks/policy.ts`
- `src/commands/claim.ts`
- `test/hooks/policy.test.ts`
- `test/claim.test.ts`

**Forbidden files**:
- `src/commands/auto.ts` (orchestrator — 103 only)
- `src/runtime/cleanup.ts` (cleanup — 102 only)
- `src/runtime/session-registry.ts` (cleanup — 102 only)
- `src/runtime/envelope.ts` (cleanup — 102 only)
- `src/hooks/conditions.ts` (evaluation engine — frozen)
- All barrel exports

**Success invariants**:
- MAX_RETRIES constant exported from policy.ts
- rule_4c fires when retryCount >= MAX_RETRIES
- rule_4a allows retries below MAX_RETRIES (not just 1)
- endAttempt() is idempotent and handles missing packets
- Existing 183 tests remain green + new retry/claim tests added
- No orchestrator or cleanup files touched

---

#### 8C-102: Cleanup Law
| Field | Value |
|---|---|
| Class | backend/runtime |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Consolidate cleanup into a single consistent path, wire envelope completion on all exits.

**Work**:
- Revive `cleanup.ts` as the single cleanup authority:
  - Add `cleanupOnStop(repoRoot, packetId, stopReason, dbPath)` — calls both `cleanupWorkerArtifacts()` AND `completeEnvelope()` for the active session
  - Add `cleanupOrphanWorktrees(repoRoot, dbPath)` — scans `.multi-claude/worktrees/`, cross-references `runtime_envelopes` table, logs orphans found
  - Export both new functions + existing `cleanupWorkerArtifacts`
- Add `completeEnvelopeOnExit()` wrapper to `envelope.ts` — safe version that catches errors (never throws) and logs if envelope was already completed
- Add unit tests in `test/runtime/cleanup.test.ts` (NEW):
  - cleanupOnStop with completed stopReason cleans worktree
  - cleanupOnStop with failed stopReason preserves evidence
  - cleanupOnStop calls completeEnvelope
  - cleanupOrphanWorktrees finds and reports orphans
  - completeEnvelopeOnExit is idempotent

**Allowed files**:
- `src/runtime/cleanup.ts`
- `src/runtime/envelope.ts`
- `test/runtime/cleanup.test.ts` (NEW)

**Forbidden files**:
- `src/commands/auto.ts` (orchestrator — 103 only)
- `src/commands/claim.ts` (retry law — 101 only)
- `src/hooks/policy.ts` (retry law — 101 only)
- `src/runtime/session-registry.ts` (read-only for 102, modify only if needed for orphan detection)
- All barrel exports

**Success invariants**:
- `cleanupOnStop()` is a single function that handles all exit paths
- `cleanupOrphanWorktrees()` can find and report stale worktrees
- `completeEnvelopeOnExit()` never throws
- Dead code in cleanup.ts is no longer dead (exported, tested)
- Existing 183 tests remain green + new cleanup tests added
- No orchestrator or retry-law files touched

---

### Wave 2 — Orchestration Wiring + Test Harness

#### 8C-103: Orchestrator Retry Wiring
| Field | Value |
|---|---|
| Class | control-plane |
| Budget | 5-7 min |
| Ceiling | 10 min |
| Role | builder |
| Depends on | 101, 102 |

**Goal**: Wire retry execution and cleanup consolidation into auto.ts orchestrator.

**Work**:
- Import `endAttempt` from claim.ts, `cleanupOnStop` from cleanup.ts
- In `auto.ts` result processing loop (line ~345-349):
  - Add handler for `retry_once` hook action: re-claim packet, increment attempt, re-render, re-launch worker in same wave
  - Add handler for `escalate_human`: pause run with reason `retry_limit_exceeded`
- In `auto.ts` result processing (line ~420-492):
  - Call `endAttempt()` on every exit path (success, failure, timeout, crash)
  - Replace inline worktree cleanup (lines 486-492) with `cleanupOnStop()`
- In `runAutoStop()` (line ~666-687):
  - After `stopAllSessions()`, enumerate incomplete workers and call `cleanupOnStop()` for each
  - Call `endAttempt()` for stopped sessions
- Do NOT modify retry policy rules or cleanup law — consume only

**Allowed files**:
- `src/commands/auto.ts`

**Forbidden files**:
- `src/hooks/policy.ts` (retry law — 101 only)
- `src/commands/claim.ts` (retry law — 101 only)
- `src/runtime/cleanup.ts` (cleanup law — 102 only)
- `src/runtime/envelope.ts` (cleanup law — 102 only)
- `src/hooks/conditions.ts` (frozen)
- `src/runtime/session-registry.ts` (frozen)
- All test files (104 only)

**Ownership rule**: 103 may ONLY add import statements and wire calls to functions defined
by 101 and 102. It must NOT redefine any retry or cleanup behavior. If a function signature
doesn't match what 103 needs, 103 must document the mismatch — not fix the upstream code.

**Success invariants**:
- `retry_once` hook action is handled (re-claim + re-launch)
- `escalate_human` hook action pauses the run
- `endAttempt()` called on every worker exit path
- `cleanupOnStop()` replaces all inline cleanup
- `runAutoStop()` cleans up worktrees for stopped workers
- No retry policy or cleanup law files modified
- Existing 183 tests remain green (no test files touched)

---

#### 8C-104: Retry/Recovery Test Harness
| Field | Value |
|---|---|
| Class | verification |
| Budget | 5-7 min |
| Ceiling | 10 min |
| Role | builder |
| Depends on | 101, 102 |

**Goal**: End-to-end tests proving retry path, cleanup consistency, and recovery behavior.

**Work**:
- Add `test/retry-recovery.test.ts` (NEW) with scenarios:
  - **Retry path**: packet fails with deterministic class → hook recommends retry_once → (mock) re-claim succeeds → attempt_number increments
  - **Retry limit**: packet fails MAX_RETRIES times → hook recommends escalate_human → run pauses
  - **Attempt lifecycle**: endAttempt sets end_reason on active attempt → idempotent on second call
  - **Cleanup on success**: cleanupOnStop with completed removes worktree + branch
  - **Cleanup on failure**: cleanupOnStop with failed preserves evidence
  - **Cleanup on stop**: runAutoStop calls cleanupOnStop for incomplete workers
  - **Envelope completion**: completeEnvelopeOnExit called on every exit path
  - **Orphan detection**: cleanupOrphanWorktrees finds stale worktrees
- Tests should use the existing test DB helpers (see `test/fixtures/` and `test/e2e.test.ts` patterns)
- Tests should mock git/filesystem operations (no real worktree creation in test)

**Allowed files**:
- `test/retry-recovery.test.ts` (NEW)
- `test/fixtures/` (if new fixtures needed)

**Forbidden files**:
- All `src/` files (read-only for import types)
- All existing test files

**Success invariants**:
- All retry/recovery scenarios have explicit test coverage
- Tests use existing patterns (DB helpers, mock patterns)
- No source files modified
- Existing 183 tests remain green + new retry/recovery tests added

---

### Tail

#### 8C-201: Verifier Checklist
| Field | Value |
|---|---|
| Role | verifier |
| Depends on | 101, 102, 103, 104 |

**Checklist**:
1. [ ] MAX_RETRIES constant exists and is enforced in policy rules
2. [ ] rule_4a allows retries below MAX_RETRIES (not hardcoded to 1)
3. [ ] rule_4c fires escalate_human at MAX_RETRIES
4. [ ] endAttempt() exists, is idempotent, handles missing packets
5. [ ] cleanupOnStop() consolidates worktree cleanup + envelope completion
6. [ ] cleanupOrphanWorktrees() finds stale worktrees
7. [ ] completeEnvelopeOnExit() never throws
8. [ ] auto.ts handles retry_once action (re-claim + re-launch)
9. [ ] auto.ts handles escalate_human action (pause run)
10. [ ] auto.ts calls endAttempt() on every exit path
11. [ ] auto.ts uses cleanupOnStop() instead of inline cleanup
12. [ ] runAutoStop() cleans up worktrees for stopped workers
13. [ ] No packet exceeded its allowed file surface
14. [ ] No packet both redefined law AND wired orchestration
15. [ ] Build passes: `npx tsc --noEmit`
16. [ ] All tests pass (should be 183+ original + new)
17. [ ] No regressions in existing tests

---

#### 8C-301: Integrator
| Field | Value |
|---|---|
| Role | integrator |
| Depends on | 201 |

**Critical integration tasks**:
1. Merge all worktree branches into main
2. Resolve any import conflicts in auto.ts (103 imports from 101/102's new exports)
3. Verify that 103's wiring matches 101/102's actual function signatures
4. If signature mismatch exists: fix in integration commit (document as merge friction)
5. Verify build + full test suite after merge
6. Record merge friction evidence (conflicts, semantic mismatches, resolution time)

**Expected friction**: The primary risk is that 103 (orchestrator) imports functions from
101 (claim) and 102 (cleanup) by name — if the actual export names differ from what 103
assumed, the integrator must reconcile. This is the same class of semantic mismatch seen
in 8B but in infra code.

---

#### 8C-401: Knowledge / Postmortem
| Field | Value |
|---|---|
| Role | knowledge |
| Depends on | 301 |

Record:
- Fitness score and grade
- Per-packet timing profile
- Merge friction evidence (the 8C version: semantic coupling, not CSS sections)
- Operator overhead
- Single-Claude comparison judgment
- Self-dogfood verdict (can multi-claude improve its own control plane?)
- **The coupling question**: Did the law/orchestration separation hold?
- Doctrine deltas

---

## Scoring Expectations

| Bucket | Prediction | Reasoning |
|---|---|---|
| Quality (40) | 30-34 | Control-plane work has real correctness requirements; dead code revival is bounded |
| Lawfulness (25) | 18-22 | Coupling pressure may cause soft boundary violations; law/wire separation is new constraint |
| Collaboration (20) | 14-17 | Semantic mismatch likely (103 assumes 101/102 export shapes); less friction than UI |
| Velocity (15) | 10-12 | Infra packets historically run at budget; Wave 2 has higher ceiling (10 min) |
| **Overall** | **72-85** | **Predicted: B to B+** |

### Grade criteria

**Call 8C an A only if**:
- Run score lands in A range (≥85)
- Law/orchestration separation held perfectly (no packet both defined and wired)
- No manual rescue in integration
- Operator overhead stays under 20 minutes
- All packets stay within ceiling

**Call it a B if**:
- One packet crosses the law/wire boundary (soft violation)
- OR integration needs signature reconciliation (expected)
- OR one packet exceeds ceiling

**Call it a C or below if**:
- Law/orchestration separation failed (multiple packets redefining + wiring)
- OR multiple packets exceed ceiling
- OR manual rescue required for build/tests
- OR coupling tax made coordination clearly worse than single-Claude

## Single-Claude Comparison Rubric

**The 8C-specific question**: Is the coordination tax on law-dense, internally-coupled
control-plane work justified by parallelism?

A single Claude would:
- Do 101 → 102 → 103 → 104 sequentially in ~15-20 minutes
- Have zero semantic mismatch (same context sees all function signatures)
- Have zero integration overhead
- But also have zero independent verification

Multi-claude needs to beat that on either wall time OR quality to justify the coordination.
Given the coupling density, the prediction is **neutral-to-slight-loss on speed, slight-win
on quality** (independent verification catches coupling bugs that single-Claude might miss).

## Isolation Requirements (NON-NEGOTIABLE)

- [ ] CWD must be `F:\AI\multi-claude` when launching agents
- [ ] Each agent must use `isolation: "worktree"`
- [ ] Each agent gets its own branch in `.claude/worktrees/`
- [ ] File changes must be contained in worktrees until integration
- [ ] Integrator must perform real branch merges
- [ ] Merge friction must be recorded (conflicts, resolution time)

## Risk Register

| Risk | Mitigation |
|---|---|
| 103 assumes wrong function signatures from 101/102 | 103's contract says "document mismatch, don't fix upstream" — integrator reconciles |
| 101 and 102 both need to modify auto.ts imports | Neither touches auto.ts — only 103 modifies it |
| cleanup.ts revival conflicts with inline cleanup in auto.ts | 102 owns cleanup.ts, 103 owns auto.ts — clear boundary |
| Wave 2 workers branch before 101/102 merge | Operator must merge Wave 1 to main before Wave 2 launch (same pattern as 8B) |
| Tests in 104 import from 101/102's new exports that don't exist yet on base branch | 104 depends on 101+102 merge; launches in Wave 2 after merge |
| policy.ts has tight coupling to conditions.ts | 101 may only modify policy.ts rules, not conditions.ts evaluation — frozen |
