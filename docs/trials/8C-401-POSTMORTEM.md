# 8C-401 Postmortem — Retry/Recovery Hardening (Self-Dogfood Trial)

## Trial Identity

| Field | Value |
|---|---|
| Trial | 8C |
| Repo | multi-claude (`F:\AI\multi-claude`) |
| Seam | Retry/Recovery Path Hardening |
| Work class | Control-plane / infra / self-dogfood |
| Committed | 2026-03-19 (7258897) |

## Verdicts

| Dimension | Verdict | Notes |
|---|---|---|
| **Product outcome** | **Pass** | Dead code revived, retry path wired, 42 new tests, real bugs fixed |
| **Trial methodology** | **Clean** | Worktree isolation verified, all 4 packets isolated, real branch merges |
| **Fit-map evidence** | **Valid** | Semantic mismatch measured, coupling guard tested, self-dogfood answered |
| **Grade** | **B+** | See scoring breakdown below |

## What Shipped

### Retry Law (8C-101)
- `MAX_RETRIES = 3` constant, exported and used across all retry rules
- `rule_4a` now allows retries up to `MAX_RETRIES` (was hardcoded to 1)
- `rule_4b` threshold aligned to `MAX_RETRIES`
- New `rule_4c_retry_limit`: fires `escalate` action when retries exhausted
- `endAttempt(dbPath, packetId, endReason)`: idempotent attempt lifecycle closer
- 9 new tests

### Cleanup Law (8C-102)
- `cleanupOnStop()`: unified cleanup entry point (worktree + envelope in one call)
- `cleanupOrphanWorktrees()`: scan-only orphan detection (reports, doesn't delete)
- `completeEnvelopeOnExit()`: safe envelope completion (never throws)
- `cleanup.ts` revived from dead code — now imported, tested, and authoritative
- 11 new tests (new file: `test/runtime/cleanup.test.ts`)

### Orchestrator Wiring (8C-103)
- `auto.ts` now handles `escalate` hook action (pauses run)
- `endAttempt()` called on every worker exit path (success, failure, crash, stop)
- Inline cleanup replaced with `cleanupOnStop()` (single authority)
- `runAutoStop()` now cleans up worktrees and ends attempts for stopped workers
- `retry_once` hook action logged but not fully re-launched (documented limitation)
- 0 new tests (wiring only — tests are 104's job)

### Test Harness (8C-104)
- 22 new end-to-end tests covering: retry path integration, retry limit enforcement, attempt lifecycle, cleanup integration, envelope lifecycle, cross-system integration
- New file: `test/retry-recovery.test.ts`

### Verifier Fix (8C-201)
- Fixed `escalate_human` → `escalate` type mismatch (1 source file + 2 test files)

### Totals
- **9 files changed, 1,016 insertions, 19 deletions**
- **183 → 225 tests, zero regressions**

## Packet Execution Summary

| Packet | Role | Budget | Wall time* | Outcome |
|---|---|---|---|---|
| 8C-101 | builder | 4-6 min (8 ceil) | ~3.5 min | Retry law + endAttempt, 9 tests |
| 8C-102 | builder | 4-6 min (8 ceil) | ~2.9 min | Cleanup consolidation, 11 tests |
| 8C-103 | builder | 5-7 min (10 ceil) | ~2.3 min | Orchestrator wiring, 6 integration points |
| 8C-104 | builder | 5-7 min (10 ceil) | ~4.1 min | 22 e2e tests |
| 8C-201 | verifier | — | ~2.6 min | 16/17 PASS, 1 semantic mismatch found |
| 8C-301 | integrator | — | ~3.2 min | Clean merges + 1 type fix |

*Approximate from agent execution duration. All packets well within budget.

### Timeline

| Time | Event |
|---|---|
| 14:20 | Isolation smoke check: 8/8 PASS |
| 14:22 | 8C-101 + 8C-102 launched in parallel (Wave 1, worktree isolation) |
| 14:29 | Both complete → scope check PASS → merged to main (203 tests) |
| 14:30 | Pre-Wave-2 gate: scope, coupling guard, test verification — PASS |
| 14:31 | 8C-103 + 8C-104 launched in parallel (Wave 2, worktree isolation) |
| 14:33 | 8C-103 complete (orchestrator wiring) |
| 14:35 | 8C-104 complete (test harness) |
| 14:37 | 8C-301 integrator: merges both branches, finds type mismatch, fixes |
| 14:41 | 8C-201 verifier: 16/17 PASS, finds escalate_human → escalate mismatch |
| 14:44 | Operator fixes verifier finding, 225/225 green |

**Total wall time: ~24 minutes** (including operator gates, verification, fix)
**Builder wall time: ~6.5 minutes** (Wave 1 parallel ~3.5 min + Wave 2 parallel ~4.1 min)

## The Central Hypothesis: Self-Dogfood Coupling

### Result: **MODERATE FIT — COUPLING GUARD IS CRITICAL**

The trial's thesis was: *Can multi-claude fit its own control-plane work when the task spans
runtime law, recovery state, and orchestration behavior?*

**Answer: Yes, but only with explicit law/wire separation.**

The coupling guard worked: no packet both redefined law AND wired orchestration. This prevented
the worst failure mode (semantic drift between law definition and consumption). But the semantic
mismatch that DID occur (`escalate_human` vs `escalate`) proves that even with the guard,
workers make independent type assumptions that diverge.

### The Coupling Tax

Self-dogfood work has inherent coupling that leaf-node work (8A) and UI work (8B) don't:
- Workers need to understand the architectural intent, not just the API surface
- Type system assumptions (`HookAction` union) create invisible coupling
- The `as HookAction` cast in 101's code masked a real bug from the compiler

This coupling tax is manageable with the law/wire separation, but it's real overhead that
single-Claude doesn't pay.

## Merge Friction Evidence

### Textual merge friction: **ZERO**
- Wave 1 merges: both clean (zero file overlap between 101 and 102)
- Wave 2 merges: both clean (103 owns auto.ts, 104 owns test file)

### Semantic merge friction: **TWO INSTANCES**

| Issue | Where | What happened | Found by |
|---|---|---|---|
| `escalate_human` vs `escalate` | policy.ts → auto.ts | 101 used `'escalate_human' as HookAction` cast. 103 initially matched it, but 301 integrator changed auto.ts to `'escalate'` based on the HookAction type. Result: runtime mismatch. | 301 integrator (partial), 201 verifier (full) |
| `retry_once` not fully wired | auto.ts | 103 logged `retry_once` but didn't implement re-claim + re-launch, documenting it as "complex". | 201 verifier (noted as partial pass) |

**Total: 2 semantic issues, both caught by verifier/integrator roles.**

### Integrator + Verifier Value

The `escalate_human` bug is the key evidence:
1. **101** (builder) introduced it — used a type cast to bypass the compiler
2. **103** (builder) initially matched it — then integrator changed it, creating the split
3. **301** (integrator) caught the type issue but only fixed one side
4. **201** (verifier) caught the runtime mismatch that the integrator missed

This validates both roles: the integrator caught something a builder wouldn't, and the verifier
caught something the integrator missed. Neither role was ceremony.

## Scope Violation Record

| Packet | Violation | Severity |
|---|---|---|
| None | — | — |

**All 4 packets stayed within allowed file surfaces.** No scope violations.

## Isolation Evidence

| Check | Result |
|---|---|
| CWD was `F:\AI\multi-claude` | YES |
| Smoke check: 8/8 PASS | YES |
| Each agent used `isolation: "worktree"` | YES (4 workers + 1 smoke check) |
| Worktree paths distinct | YES (agent-ae8e8939, agent-ab5d8446, agent-ae4515a8, agent-abfb5350) |
| Main untouched during waves | Verified at pre-Wave-2 gate |
| Integrator performed real branch merges | YES |
| Worktrees cleaned up | YES |

## Single-Claude Comparison

### Judgment: **NEUTRAL**

**Multi-claude actual**:
- Builder wall time: ~6.5 min (Wave 1 parallel + Wave 2 parallel)
- Integration + verification: ~5.8 min
- Operator overhead: ~5.5 min (smoke check, gates, fix)
- Semantic mismatch fix: ~4 min
- Total wall time: ~24 min

**Single-Claude estimate**:
- Would do 101 → 102 → 103 → 104 sequentially: ~13-15 min
- Zero semantic mismatches (same context, no type cast assumption drift)
- No integration overhead
- Self-verification (less rigorous but faster)
- Total: ~15-17 min

**Analysis**:
- Multi-claude saved ~7 min of builder time through parallel waves
- But added ~9 min of overhead (gates, integration, verification, mismatch fix)
- Net: multi-claude was ~7 min slower on wall time
- However: multi-claude caught a real bug (escalate_human type mismatch) that single-Claude might have propagated unchecked
- The verifier role proved its value by catching what the integrator missed

**The 8C-specific question**: *Is the coordination tax on law-dense, internally-coupled
control-plane work justified by parallelism?*

**Honest answer: Barely justified on quality, not on speed.** The parallel time savings are
real (~7 min) but offset by coordination overhead (~9 min). The quality win is also real
(verifier caught a bug the integrator missed) but modest. For 4-packet control-plane work
with tight coupling, single-Claude is faster and nearly as correct.

**Where multi-claude would win on infra work**: Larger refactors with 6+ packets where
parallel savings compound beyond the fixed coordination overhead. Or when independent
verification is mandated (compliance, production-critical changes).

## Grade Breakdown

| Bucket | Score | Max | Reasoning |
|---|---|---|---|
| Quality | 34 | 40 | Real bugs fixed, 42 new tests, dead code revived. retry_once partial wiring docks 2 points. |
| Lawfulness | 23 | 25 | Zero scope violations, coupling guard held perfectly. Type cast bypass (as HookAction) is a soft doc-law issue. |
| Collaboration | 14 | 20 | Zero textual conflicts. Semantic mismatch required 2 fix commits. Integrator missed what verifier caught — collaboration worked but was imperfect. |
| Velocity | 11 | 15 | All packets under budget. But total wall time (~24 min) vs single-Claude (~16 min) is a speed loss. |
| **Overall** | **82** | **100** | **B+** |

### Grade justification

**B+ (not A-) because**:
- Single-Claude comparison is neutral (no clear multi-claude advantage)
- Semantic mismatch required two fix passes (integrator + verifier)
- retry_once not fully wired (103 documented the gap but didn't solve it)
- Total wall time exceeded single-Claude estimate

**B+ (not B) because**:
- Coupling guard held perfectly (central hypothesis validated)
- Zero scope violations across 4 packets
- Zero textual merge conflicts
- All packets well within budget
- Verifier caught a real bug that would have shipped otherwise
- 42 new tests, 225/225 green, zero regressions
- Isolation methodology was clean throughout

## Doctrine Deltas

### Confirmed
1. **Law/wire separation is essential for coupled infra work** — the coupling guard prevented the worst failure mode (semantic drift between definition and consumption)
2. **Worktree isolation produces valid data for all work classes** — 8A (qualified), 8B (valid), 8C (valid)
3. **Wave-based parallelism applies to infra work** — law packets first (parallel), wiring + tests second (parallel)
4. **Verifier catches what integrator misses** — the `escalate_human` bug was only fully caught by the verifier, not the integrator. Both roles earned their keep.

### New lessons
5. **Type casts (`as X`) are semantic mismatch factories** — when one worker casts a value to bypass the type system, the mismatch becomes invisible to the compiler but real at runtime. Contract freeze should ban or flag `as` casts in allowed-file specifications.
6. **Self-dogfood coupling tax is real but manageable** — workers need to understand architecture, not just API surfaces. The tax is ~50% overhead (24 min vs 16 min estimate). Acceptable for quality-critical work, not for routine changes.
7. **4-packet infra features are near the break-even point** — coordination overhead roughly equals parallelism savings. The break-even for infra work is likely 5-6+ packets where the parallel savings compound.
8. **"Document the gap" is acceptable for partial wiring** — 103 couldn't fully implement retry re-launch but documented it clearly. This is better than a hack. The gap is visible for the next iteration.

### Fit-map signal (complete)
| Work class | Trial | Fit | Confidence | Evidence |
|---|---|---|---|---|
| Backend/state/domain | 8A | **Strong** | Qualified (no isolation) | Clean ownership, zero overlap, fast execution |
| UI/interaction/seam-heavy | 8B | **Moderate** | Valid | CSS ownership works, semantic friction is real, wins scale with packet count |
| Control-plane/infra | 8C | **Moderate** | Valid | Coupling guard works, type-cast mismatches surface, speed-neutral, quality-slight-win |

## Phase 8 Conclusion

The fit map now has three anchors:

1. **Backend law work** is multi-claude's sweet spot. Clean file ownership, natural wave structure, low merge friction, clear speed win.

2. **UI work** is viable but the win is narrow. CSS section ownership prevents textual conflicts, but semantic reconciliation (wrong API assumptions) is the real cost. Multi-claude needs 5+ packets to justify the overhead.

3. **Control-plane work** is at break-even. The coupling guard (law vs wire separation) is essential. Quality wins are real (verifier catches bugs) but speed wins are absent for small packet counts. Type system assumptions create invisible coupling.

**The meta-lesson**: Multi-claude's value scales with packet count and inversely with internal coupling. The system works best when packets have clear, non-overlapping file ownership and consume well-defined APIs. It struggles (relatively) when workers must make type-level assumptions about other workers' output.

## Recommended Next Action

Proceed to **8D Doctrine Pack**: synthesize 8A/8B/8C into `RUN-CLASS-FIT-MAP.md`, `PACKET-TEMPLATES.md`, updated `WHEN-MULTI-CLAUDE-WINS.md`, and `ANTI-PATTERNS.md`.
