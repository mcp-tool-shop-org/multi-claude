# Phase 10C — Live Promotion Trials

## Thesis

Pressure-test the full 9A–10B governed execution spine on real repositories
under real coupling, real ambiguity, and real acceptance decisions.

## What 10C Must Prove

| # | Claim | How Tested |
|---|-------|-----------|
| 1 | Handoff truth is sufficient for real review | Reviewer does not need raw DB |
| 2 | Promotion eligibility is calibrated | Not routinely too lax or too strict |
| 3 | Approval binding is trustworthy | Binds to correct evidence, never floats |
| 4 | Invalidation fires correctly | Material changes invalidate; non-material do not |
| 5 | Recovery-to-approval path is usable | Intervened runs can still promote lawfully |
| 6 | Packetization doctrine survives real repos | Law helps even when ownership is imperfect |

## Trial Protocol

Each trial follows the same structured flow:

### 1. Pre-Trial Framing
- Repo name + GitHub URL
- Task type (feature / refactor / bugfix / cross-cutting)
- Why this repo was chosen
- Expected coupling class (low / medium / high)
- Expected packet count
- Expected review complexity

### 2. Run Execution (9A–10B Flow)
1. `multi-claude plan evaluate` — fitness assessment
2. `multi-claude blueprint init` — packet graph
3. `multi-claude blueprint validate` + `freeze`
4. Execute run (workers claim + submit)
5. `multi-claude console show` — observe
6. Intervene / recover if needed
7. `multi-claude console outcome` — run closure
8. `multi-claude console handoff` — delivery evidence
9. `multi-claude console promote-check` — eligibility
10. `multi-claude console approve` or refuse

### 3. Post-Approval Mutation
After approval, introduce a real follow-on change:
- Verify approval remains valid when it should
- Verify approval invalidates when it should
- Verify invalidation reason is exact
- Verify re-promotion path is lawful

### 4. Trial Write-Up
Structured artifact (see template: 10C-TRIAL-TEMPLATE.md)

## Evaluation Rubric

### Product-Truth Metrics (scored per trial)

| Metric | Pass | Marginal | Fail |
|--------|------|----------|------|
| Promotion correctness | Verdict matches reviewer judgment | Off by one severity level | Clearly wrong |
| Approval binding | Fingerprint tracks material truth | Minor false-positive invalidation | Approval floats silently |
| Invalidation accuracy | Fires on material change only | Over-triggers on non-material | Misses material change |
| Handoff completeness | Reviewer can decide from artifact | Needs 1-2 raw lookups | Artifact insufficient |
| Evidence grounding | Claims match actual truth | Minor gaps in file-level detail | Fabricated or misleading |
| Recovery guidance | Actionable, reduces friction | Correct but not actionable | Missing or wrong |

### Friction Metrics (counted per trial)

| Metric | Target |
|--------|--------|
| Raw DB inspections needed | 0 (ideal), ≤ 2 (acceptable) |
| Refusal reasons not actionable | 0 |
| Invalidations judged too strict | ≤ 1 |
| Invalidations judged too weak | 0 |
| Contribution summaries judged ambiguous | ≤ 1 per trial |

### Doctrine Metrics (pattern-level, across trials)

| Metric | What It Tells You |
|--------|-------------------|
| Coupling level vs usefulness | Where multi-claude adds vs subtracts value |
| Packet count vs decision clarity | Minimum viable packet count for clean handoff |
| Semantic overlap vs handoff quality | When shared state corrupts contribution truth |
| Intervention frequency vs review readiness | When recovery presence helps vs hurts confidence |

## Trial Selection

### Trial A — Low Coupling
**Repo:** claude-guardian (mcp-tool-shop-org/claude-guardian)
**Profile:** 19 TS files, modular MCP server, clean file ownership
**Why:** Confirms happy-path pipeline end-to-end. Each module owns its concern.
**Expected:** Clean handoff, straightforward promotion, minimal intervention.

### Trial B — Medium Coupling
**Repo:** studioflow (mcp-tool-shop-org/studioflow)
**Profile:** 93 files, Tauri v2 + React monorepo, uni-directional deps
**Why:** Tests coordination across language boundary (Rust + TS) with shared domain layer.
**Expected:** Some contribution boundary blur, moderate review complexity.

### Trial C — High Coupling
**Repo:** claude-rpg (mcp-tool-shop-org/claude-rpg)
**Profile:** 65 TS files, shared mutable game state, tight seam fabric
**Why:** Forces the system into the place where doctrine either holds or breaks.
**Expected:** Contribution ambiguity, semantic overlap, promotion should be conservative.

## Pass/Fail Criteria

### 10C Passes If:
- Full 9A–10B chain works on all three repos
- At least one non-clean trial yields a trustworthy handoff and promotion decision
- Invalidation works correctly after post-approval change
- Synthesis produces concrete doctrine findings

### 10C Fails If:
- Reviewers repeatedly need raw internal truth because handoff is insufficient
- Promotion is routinely too permissive or too conservative
- Invalidation logic feels disconnected from actual material change
- Coupled repos collapse contribution clarity so badly approval becomes guesswork

## Outputs

- `docs/trials/10C-TRIAL-PLAN.md` (this file)
- `docs/trials/10C-TRIAL-TEMPLATE.md`
- `docs/trials/10C-A-claude-guardian.md`
- `docs/trials/10C-B-studioflow.md`
- `docs/trials/10C-C-claude-rpg.md`
- `docs/trials/10C-SYNTHESIS.md`
