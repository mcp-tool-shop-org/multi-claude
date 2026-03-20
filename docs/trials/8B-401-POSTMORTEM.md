# 8B-401 Postmortem — StudioFlow Visual Properties (UI-Heavy Trial)

## Trial Identity

| Field | Value |
|---|---|
| Trial | 8B |
| Repo | StudioFlow (`F:\AI\studioflow`) |
| Seam | Fill + Stroke Color Properties (Phase 6) |
| Work class | UI / interaction / seam-heavy |
| Committed | 2026-03-19 (8d2c9e1) |

## Verdicts

| Dimension | Verdict | Notes |
|---|---|---|
| **Product outcome** | **Pass** | Real feature shipped: fill/stroke colors with canvas rendering, inspector editing, multi-select "mixed", undo support |
| **Trial methodology** | **Clean** | Worktree isolation verified — each worker got its own branch and working copy |
| **Fit-map evidence** | **Valid** | CSS merge friction measured, semantic mismatch documented, operator overhead recorded |
| **Grade** | **A-** | See scoring breakdown below |

## What Shipped

### Color Domain (8B-101)
- `ColorValue` type (hex string) with `DEFAULT_FILL` and `DEFAULT_STROKE`
- `fill?: ColorValue` and `stroke?: ColorValue` on LayerItem (backwards-compatible)
- `item:set-fill` and `item:set-stroke` commands with undo/redo support
- `setItemFill` and `setItemStroke` store actions
- 12 new tests (command routing, store mutations, undo/redo)

### Canvas Rendering (8B-102)
- Items render with user fill as backgroundColor, stroke as border
- `makeDefaultItem()` includes default fill (`#2a2a38`)
- CSS `.canvas-item--has-stroke` in Canvas section
- 3 new tests

### Inspector Editing (8B-103)
- `ColorPicker` component: `<input type="color">` wrapper with label, hex display, "mixed" support
- Single-item view: fill and stroke ColorPickers dispatching `item:set-fill`/`item:set-stroke`
- Multi-select view: "mixed" indicator when selected items have different colors
- Inspector section CSS (57 lines)
- 4 new tests

### Integration (8B-301)
- Barrel export: `ColorValue` exported from `packages/domain/src/index.ts`
- 11 semantic fixes across 3 files (see Merge Friction section)

### Totals
- **15 files changed, 550 insertions**
- **209 → 228 tests, zero regressions**

## Packet Execution Summary

| Packet | Role | Budget | Wall time* | Outcome |
|---|---|---|---|---|
| 8B-101 | builder | 3-5 min (6 ceil) | ~3.5 min | Domain + store wired, 12 tests |
| 8B-102 | builder | 4-6 min (8 ceil) | ~3.0 min | Canvas rendering, 3 tests |
| 8B-103 | builder | 4-6 min (8 ceil) | ~3.5 min | Inspector editing, 4 tests |
| 8B-201 | verifier | — | ~3.5 min | 12/12 PASS |
| 8B-301 | integrator | — | ~4.0 min | Merges + 11 semantic fixes |

*Approximate from agent execution duration. All packets within budget.

### Timeline

| Time | Event |
|---|---|
| 13:48 | 8B-101 launched (Wave 1, worktree isolation) |
| 13:51 | 8B-101 complete → merged to main (fast-forward) |
| 13:52 | Pre-Wave-2 gate check: isolation proof, scope compliance, CSS ownership — PASS |
| 13:53 | 8B-102 + 8B-103 launched in parallel (Wave 2, worktree isolation) |
| 13:58 | 8B-102 complete (Canvas) |
| 13:59 | 8B-103 complete (Inspector) |
| 14:01 | 8B-301 integrator: merges both branches |
| 14:03 | 8B-301 integrator: semantic fixes + barrel exports → commit |
| 14:07 | 8B-201 verifier: 12/12 PASS |

**Total wall time: ~19 minutes** (including operator gates and verification)
**Builder wall time: ~7 minutes** (101 serial + 102‖103 parallel)

## The Central Hypothesis: CSS Section Ownership

### Result: **VALIDATED**

The trial's thesis was: *Can packet-shaping law make UI work viable for multi-claude when CSS seam files are shared?*

**Evidence:**
- `workspace.css` is a 1,259-line monolithic stylesheet
- 8B-102 added 4 lines in the **Canvas section** (line 621 area)
- 8B-103 added 57 lines in the **Inspector section** (lines 851-907)
- Git auto-merged both branches with **zero textual conflicts**

CSS section headers (`/* Canvas */`, `/* Inspector Panel */`) serve as effective ownership boundaries. When workers stay in their assigned sections, git can merge non-overlapping regions cleanly.

### Caveat
The changes were in well-separated regions (~230 lines apart). Adjacent or overlapping section changes would likely produce conflicts. Section ownership works for the common case but is not a universal solution.

## Merge Friction Evidence (THE KEY 8B MEASUREMENT)

### Textual merge friction: **ZERO**
- 8B-102 merge into main: clean, no conflicts
- 8B-103 merge into main: clean, CSS auto-merged (different sections)

### Semantic merge friction: **SIGNIFICANT (11 code sites)**

Wave 2 workers branched from the post-101 base (3b3a62d), so they had the `LayerItem.fill`/`item.stroke` types. However, they made independent API assumptions that diverged:

| Issue | Where | What happened |
|---|---|---|
| Property path | Inspector.tsx | 103 used `item.data.fill` instead of `item.fill` (4 sites) |
| Command type | Inspector.tsx | 103 dispatched `item:update` instead of `item:set-fill`/`item:set-stroke` (2 sites) |
| Type cast | Canvas.tsx | 102 used `(item as any).fill` cast (1 site — removed after merge gave real types) |
| Test assertions | Inspector.test.tsx | Tests used wrong property paths and command types (4 sites) |

**Total: 11 code sites across 3 files required semantic reconciliation by the integrator.**

### Why this happened
Workers had the types but made assumptions about the API shape. 103 assumed colors lived in a nested `data` object (common React pattern) instead of flat on `LayerItem`. 102 used a cast because its test environment didn't have full type resolution in the worktree. These are real-world integration issues that textual merge cannot detect.

### Integrator value
The integrator resolved all 11 sites in a single pass. Without an integrator role, these would have surfaced as runtime bugs. This validates the integrator as a distinct role — even when git merges are clean, semantic reconciliation is real work.

## Scope Violation Record

| Packet | Violation | Severity | Notes |
|---|---|---|---|
| 8B-101 | Touched `history.ts` (not in frozen allowed list) | Soft | Necessary to wire UNDOABLE_COMMANDS and COMMAND_LABELS for undo support |

**Lesson**: When a packet's contract says "undo support," the allowed file list must include all files in the undo path. `history.ts` was a predictable dependency — should have been in 000.

## Verifier Report

12/12 items PASS. Full evidence in 8B-201 verifier output. Key findings:
- `fill`/`stroke` optional and backwards-compatible
- Both commands undoable with full redo
- Canvas renders colors correctly
- Inspector shows pickers (single) and "mixed" (multi-select)
- CSS changes in correct sections
- No barrel export modifications by builders
- 228/228 tests green, zero regressions

One note: stale `.d.ts` dist files needed rebuild before typecheck. Source code is type-correct; build artifact needed refresh after integration.

## Isolation Evidence

| Check | Result |
|---|---|
| CWD was `F:\AI\studioflow` | YES |
| Each agent used `isolation: "worktree"` | YES |
| Worktree paths recorded | 8B-102: `.claude/worktrees/agent-a3630d10`, 8B-103: `.claude/worktrees/agent-ac34d5a0` |
| Each agent got its own branch | `worktree-agent-a3630d10`, `worktree-agent-ac34d5a0` |
| Main untouched during Wave 2 | Verified at pre-Wave-2 gate |
| Integrator performed real branch merges | YES — `git merge worktree-agent-a3630d10` + `git merge worktree-agent-ac34d5a0` |
| Worktrees cleaned up | YES — removed after integration |

**Isolation: CLEAN.** This is the methodological improvement over 8A.

## Single-Claude Comparison

### Judgment: **Multi-claude NEUTRAL-TO-SLIGHT-WIN**

**Multi-claude actual**:
- Wall time: ~19 min (including operator gates, verification)
- Builder wall time: ~7 min (101 serial + 102‖103 parallel)
- Integration overhead: ~4 min (merge + 11 semantic fixes)
- Verification: ~3.5 min

**Single-Claude estimate**:
- Would do 101 → 102 → 103 sequentially: ~10-11 min
- No merge friction (zero semantic mismatches because same context)
- No verification overhead (same Claude would self-verify)
- Total: ~12-14 min

**Analysis**:
- Multi-claude saved ~3.5 min of builder time through Wave 2 parallelism
- But added ~7.5 min of overhead (operator gates, integration, verification)
- Net: multi-claude was ~5 min slower on wall time
- However: multi-claude produced higher-quality output (independent verifier, explicit integration, documented merge evidence)

**The 8B-specific question** (from contract freeze): *Is the CSS merge friction overhead justified by the parallel time savings?*

**Honest answer: Barely.** The parallel savings (~3.5 min) are real but modest. The integration overhead (semantic reconciliation) is real. For a 3-packet UI feature with shared CSS, a single Claude would likely finish faster with zero merge friction. Multi-claude's advantage here is quality assurance (independent verification) and methodology (the integration forced explicit reconciliation of API assumptions).

**Where multi-claude would win on UI work**: Larger features with more packets (5+), where parallel time savings compound. For 3-packet features, the coordination overhead erodes the parallelism benefit.

## Grade Breakdown

| Bucket | Score | Max | Reasoning |
|---|---|---|---|
| Quality | 35 | 40 | Feature complete, 19 new tests, zero regressions, one stale-dist note |
| Lawfulness | 22 | 25 | One soft scope violation (history.ts), all CSS ownership rules held |
| Collaboration | 17 | 20 | Clean merges, semantic friction documented, integrator added real value |
| Velocity | 12 | 15 | All packets within budget, but total wall time modest vs single-Claude |
| **Overall** | **86** | **100** | **A-** |

### Grade justification

**A- (not A) because**:
- Semantic mismatch (11 sites) shows workers made avoidable API assumptions
- Single-Claude comparison is neutral-to-slight-win, not a clear multi-claude advantage
- Stale dist files needed manual rebuild (minor but real friction)

**A- (not B+) because**:
- CSS section ownership held — the central hypothesis validated
- Worktree isolation was clean (methodological improvement over 8A)
- Zero textual merge conflicts
- All packets within budget
- 12/12 verifier items PASS
- Feature is genuinely useful (real product value)

## Doctrine Deltas

### Confirmed
1. **CSS section ownership works for non-adjacent modifications** — git merges cleanly when workers stay in assigned sections separated by clear headers
2. **Worktree isolation produces valid fit-map data** — unlike 8A, merge friction was measurable
3. **Wave-based parallelism applies to UI work** — domain first (serial), then Canvas ‖ Inspector (parallel)
4. **Integrator role has real value even with clean merges** — semantic reconciliation is distinct from textual merge resolution
5. **Pre-Wave-2 gate catches drift before it compounds** — verified isolation + scope before launching parallel work

### New lessons
6. **Semantic mismatch > textual conflict for UI work** — workers with types still make wrong API assumptions (nested vs flat, wrong command names). This is the primary integration cost for UI packets.
7. **Contract freeze must include all files in the undo path** — when a packet says "undo support," `history.ts` and related files must be in the allowed list
8. **3-packet UI features don't strongly justify multi-claude** — coordination overhead erodes parallelism for small packet counts. The break-even is likely 5+ packets.
9. **Stale dist files are a worktree hazard** — when domain packages change types, downstream worktrees may have stale `.d.ts` files. Integration should include a rebuild step.

### Fit-map signal
| Work class | Fit | Confidence | Evidence |
|---|---|---|---|
| Backend/state/domain (8A) | Strong | Qualified (no isolation) | Clean ownership, zero overlap, fast execution |
| UI/interaction/seam-heavy (8B) | Moderate | Valid | CSS ownership works, but semantic friction is real. Wins scale with packet count. |

## Recommended Next Action

Proceed to **8C** (control-plane/infra work on multi-claude itself). This completes the Phase 8 triad and fills the fit-map's third column. Then produce the **8D Doctrine Pack** synthesizing all three trials.
