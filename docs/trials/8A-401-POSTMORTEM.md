# 8A-401 Postmortem — Governor Protocol Hardening

## Trial Identity

| Field | Value |
|---|---|
| Trial | 8A |
| Repo | ConsensusOS |
| Seam | Governor token-task execution |
| Work class | State/backend/domain |
| Committed | 2026-03-19 (59da073) |

## Verdicts

| Dimension | Verdict | Notes |
|---|---|---|
| **Product outcome** | **Pass** | Real invariant hardening, 54 new tests, 349/349 green, build clean |
| **Trial methodology** | **Compromised** | No worktree isolation — workers wrote to same repo |
| **Fit-map evidence** | **Qualified** | Merge friction, integrator value, and operator overhead not properly measured |
| **Grade** | **B (capped)** | Code would be A-quality; methodology weakness caps the trial grade |

## What Shipped

### Invariant Hardening (real correctness fixes)
- `consume()` rejects revoked tokens — was silently accepting them
- `consume()` rejects double-consume — was silently allowing it
- `validate()` is now a pure read — was mutating state as a side-effect
- `autoExpire()` extracted as explicit mutation path with audit trail
- Token expiration during execution handled gracefully — was crashing
- `active()` filter audits expired tokens instead of silently dropping them
- Token state consistency invariant documented and enforced at plugin level

### Boundary Hardening
- `requestValidationRule()` rejects malformed inputs at policy boundary
- `verifyCompleteness()` checks lifecycle audit completeness
- All audit query methods return deep copies (structuredClone)

### Test Surface
- 19 adversarial tests (expiration races, resource exhaustion, priority inversion, idempotence)
- 11 integration tests (full lifecycle, consistency invariant, batch expiration)
- 24 expanded unit tests across existing files
- **295 → 349 total tests, zero regressions**

## Packet Execution Summary

| Packet | Role | Class | Budget | Actual* | Outcome |
|---|---|---|---|---|---|
| 8A-101 | builder | state/domain | 4-6 min | ~2.6 min | All 6 invariants fixed |
| 8A-102 | builder | backend | 4-6 min | ~2.0 min | All 6 items delivered |
| 8A-103 | builder | verification | 5-8 min | ~2.4 min | 19 adversarial tests |
| 8A-104 | builder | backend | 4-6 min | ~3.1 min | Plugin wired, 11 integration tests |
| 8A-201 | verifier | — | — | ~3.3 min | Conditional pass |
| 8A-301 | integrator | — | — | trivial | No real merge (see methodology) |

*Approximate wall time from agent execution duration. Not precise — includes tool overhead.

## Methodology Problem

### What went wrong
Workers launched without worktree isolation. The `isolation: "worktree"` parameter
failed because the Agent tool requires the working directory to be a git repo, and
the session CWD was `F:\AI` (not a git repo), while ConsensusOS lives at `F:\AI\ConsensusOS`.

### What this invalidated
1. **Merge friction**: Zero conflicts observed, but this is trivially true when
   workers write directly to the same files. Real worktree isolation would require
   actual branch merges, which is where friction surfaces.
2. **Integrator independence**: The integrator had nothing to integrate. In a proper
   run, the integrator would merge 4 branches with potential conflicts.
3. **Operator overhead**: Reduced artificially because there was no merge gate to
   manage, no conflict resolution, no branch coordination.
4. **Worker independence**: Workers could see each other's in-progress changes.
   This happened visibly: 8A-103 saw a partial failure from 8A-104's incomplete
   work (318/319 vs 349/349 once both finished).

### What this did NOT invalidate
1. **Packet boundary design**: The ownership split was clean — zero file overlap
   between Wave 1 packets, and Wave 2 packets correctly depended on Wave 1 output.
2. **Invariant correctness**: The hardening work is genuine. The bugs were real.
3. **Test quality**: 54 tests proving real invariants, not manufactured coverage.
4. **Scope discipline**: One soft violation (security-audit.test.ts) — understandable
   and already flagged as a packet-shaping lesson.

## Scope Violation Record

| Packet | File | Allowed? | Reason |
|---|---|---|---|
| 8A-101 | tests/security-audit.test.ts | No | Test was asserting old validate() side-effect behavior; needed update for test suite to pass |

**Lesson**: When a packet changes a public API contract, the contract freeze must
declare all test files that assert the old behavior. This is predictable and should
be caught during 000.

## Single-Claude Comparison

### Judgment: **Cannot call cleanly**

Under proper isolation, this would likely have been a **multi-claude win** because:
- Wave 1 parallelism (101 ‖ 102) is genuine — zero file overlap, real time savings
- Wave 2 parallelism (103 ‖ 104) is genuine — tests and integration are independent

But without isolation, the "win" is partly inflated by:
- No merge overhead (which would have been real, even if small)
- No operator gate time (which adds 5-10 min in a real run)
- No branch coordination cost

**Honest estimate**: Multi-claude would likely still win on this work class, but
the margin is uncertain. Merge friction would have been low (clean ownership), but
not zero. A single Claude would have completed the same work in roughly 12-15 minutes
with no coordination overhead.

## Doctrine Deltas

### Confirmed
1. **Backend law work with clean ownership is a strong fit** — packet boundaries
   held perfectly, zero ownership conflicts, zero "while here" drift
2. **Frozen invariant lists keep scope tight** — all 4 packets delivered exactly
   the frozen work items, no more
3. **Wave-based parallelism works for layered work** — (core ‖ boundary) → (tests ‖ integration)
   is a natural backend packet shape

### New lessons
4. **Worktree isolation is required for valid fit-map data** — without it, merge
   friction and integrator value cannot be measured. This is non-negotiable for
   future trials.
5. **Contract freeze must include test-file dependencies** — when a packet changes
   a public API, all test files asserting the old behavior must be in its allowed surface.
6. **Backend work may be faster than budget** — all packets finished well under
   budget. This is either good news (backend law work is a sweet spot) or a sign
   that the work was not complex enough to stress-test coordination.

## Grade Breakdown (estimated, not fitness-engine computed)

| Bucket | Estimated | Cap | Reasoning |
|---|---|---|---|
| Quality (40) | 36 | — | All invariants shipped, 54 tests, zero regressions |
| Lawfulness (25) | 20 | — | One soft scope violation, all transitions lawful |
| Collaboration (20) | 12 | Capped | Integrator independence not tested, merge friction unmeasured |
| Velocity (15) | 13 | — | All packets under budget |
| **Overall** | **81** | **B** | Code is A-quality, trial method caps to B |

## Recommended Next Action

### Option A: Accept 8A as qualified baseline
Accept the B-grade result. Use it as a weak baseline for backend work class.
Run 8B and 8C under proper isolation. If both produce clean data, the fit map
has two strong datapoints and one qualified one. Acceptable.

### Option B: Narrow rerun for methodological purity
Rerun 8A with:
- CWD set to ConsensusOS (so worktree isolation works)
- OR manual branch creation per packet
- Measure actual merge friction and integrator value
- Compare to this result

**My recommendation**: Option A. The code shipped. The methodology lesson is learned.
Spend the isolation effort on 8B and 8C where it matters more (UI work has real
merge friction; infra work has real coordination cost). Backend law work is the
least likely to produce surprising merge friction, so the missing data matters
least here.

But this is the operator's call.
