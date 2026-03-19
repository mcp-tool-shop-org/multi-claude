# 8B-000 Contract Freeze — StudioFlow Visual Properties (UI-Heavy Trial)

## Trial Identity

| Field | Value |
|---|---|
| Trial ID | 8B |
| Phase | 8: Repeatability & Fit Map |
| Work Class | UI / interaction / seam-heavy |
| Repo | StudioFlow (`F:\AI\studioflow`) |
| Feature | Phase 6: Fill + Stroke Color Properties |
| Frozen by | Operator (single-Claude) |
| Frozen at | 2026-03-19 |
| Isolation | **Worktree — mandatory, verified by smoke check** |

## Operative Framing

> StudioFlow Trial 8B is a bounded UI-feature run designed to measure multi-claude's
> fit for seam-heavy frontend work. Two UI packets will modify the same monolithic CSS
> file (different sections) under worktree isolation, producing real merge friction for
> the integrator to resolve.

## Trial Thesis

**Can packet-shaping law make UI work genuinely viable for multi-claude when
CSS seam files are shared and merge friction is real?**

This is the hardest trial in Phase 8. Phase 5 already proved that oversized UI
packets (16+ min) and shared CSS ownership produce merge friction. Phase 6 must
prove that the corrective packet-shaping law works.

## Feature: Fill + Stroke Color Properties

### Scope (bounded — no shadows, no gradients, no opacity)
- Add `fill` and `stroke` color fields to LayerItem
- Render colors on canvas items
- Edit colors in inspector (single-item + multi-select)
- Command-driven mutation with undo support
- Tests for all of the above

### Why this feature
- Real product value (colors are the next step toward actual design work)
- Forces CSS modification in both Canvas and Inspector sections
- Breaking domain change (LayerItem schema) tests integration rigor
- Multi-select color summary ("mixed" display) tests real UI complexity

## Known Seam Risk: workspace.css

`apps/desktop/src/styles/workspace.css` is a 1,259-line monolithic stylesheet.
Phase 5 postmortem documented merge friction when SF5-103 (Canvas) and SF5-104
(Inspector) both modified it.

**8B's deliberate stress test**: 8B-102 and 8B-103 will both modify workspace.css
under worktree isolation, in different sections:
- 8B-102 owns the **Canvas section** (lines 410-619)
- 8B-103 owns the **Inspector section** (lines 620+)

The integrator must merge both branches. If this produces clean merges, CSS
section ownership is validated. If not, the postmortem documents the friction.

## Packet Graph

### Wave 1 — Domain Foundation

#### 8B-101: Color Domain + Store
| Field | Value |
|---|---|
| Class | state/domain |
| Budget | 3-5 min |
| Ceiling | 6 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Add fill/stroke color types to domain and wire into document store.

**Work**:
- Create `packages/domain/src/color.ts` with `ColorValue` type (hex string, e.g. `"#ff0000"`)
- Add optional `fill?: ColorValue` and `stroke?: ColorValue` fields to `LayerItem` in `layer.ts`
- Add `item:set-fill` and `item:set-stroke` command types to `command.ts`
- Wire new commands in `commandStore.ts` (dispatch routing + undo support)
- Update `documentStore.ts` with `setItemFill(layerId, itemId, color)` and `setItemStroke(layerId, itemId, color)` actions
- Add unit tests: color type validation, store fill/stroke mutations, undo/redo for color commands

**Allowed files**:
- `packages/domain/src/color.ts` (NEW)
- `packages/domain/src/layer.ts`
- `packages/domain/src/command.ts`
- `packages/state/src/documentStore.ts`
- `packages/state/src/commandStore.ts`
- `packages/state/src/__tests__/documentStore.test.ts`
- `packages/state/src/__tests__/commandStore.test.ts`

**Forbidden files**:
- `packages/domain/src/index.ts` (barrel export — integrator only)
- `packages/state/src/index.ts` (barrel export — integrator only)
- All component files (`apps/desktop/src/components/*`)
- All CSS files
- `selectionStore.ts`, `viewportStore.ts`, `historyStore.ts`, `persistenceStore.ts`

**Success invariants**:
- `ColorValue` type is a simple hex string type
- `LayerItem.fill` and `LayerItem.stroke` are optional (backwards-compatible)
- `item:set-fill` and `item:set-stroke` commands are undoable
- Existing 209 tests remain green + new color tests added
- No component or CSS files touched

---

### Wave 2 — Parallel UI Packets (THE STRESS TEST)

#### 8B-102: Canvas Color Rendering
| Field | Value |
|---|---|
| Class | ui_interaction |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101 |

**Goal**: Render fill and stroke colors on canvas items.

**Work**:
- Modify `Canvas.tsx`: read `item.fill` and `item.stroke`, apply as inline styles on `.canvas-item` divs
- Update `makeDefaultItem()` to include default fill (`"#2a2a38"` — matches current bg) and no stroke
- Add CSS in workspace.css **Canvas section only** (lines 410-619 area): styles for `.canvas-item` with user-defined fill/stroke (border for stroke, background for fill)
- Add Canvas tests: items render with correct fill color, items render with stroke border, items without fill/stroke use defaults

**Allowed files**:
- `apps/desktop/src/components/Canvas.tsx`
- `apps/desktop/src/styles/workspace.css` — **Canvas section ONLY (lines 410-619 area)**
- `apps/desktop/src/components/__tests__/Canvas.test.tsx`

**Forbidden files**:
- `apps/desktop/src/components/Inspector.tsx`
- `apps/desktop/src/components/ColorPicker.tsx`
- `apps/desktop/src/styles/workspace.css` — **Inspector section (lines 620+)**
- All domain files (`packages/domain/src/*`)
- All store files (`packages/state/src/*`)
- All barrel exports

**CSS ownership rule**: You may ONLY add/modify rules in the Canvas section of
workspace.css (between the `/* Canvas */` and `/* Inspector Panel */` section headers).
Do not add rules after the Inspector header.

**Success invariants**:
- Canvas items display user fill color as background
- Canvas items display user stroke color as border
- Items without fill/stroke render with sensible defaults
- No CSS changes outside the Canvas section
- Existing Canvas tests remain green + new color tests added

---

#### 8B-103: Inspector Color Editor
| Field | Value |
|---|---|
| Class | ui_interaction |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101 |

**Goal**: Add color editing UI to inspector for single-item and multi-select.

**Work**:
- Create `apps/desktop/src/components/ColorPicker.tsx` — simple color input component (HTML `<input type="color">` wrapper with label + hex display)
- Modify `Inspector.tsx`:
  - Single-item view: show fill and stroke ColorPicker, dispatch `item:set-fill` / `item:set-stroke` on change
  - Multi-select view: show fill/stroke with "mixed" indicator when selected items have different colors
- Add CSS in workspace.css **Inspector section only** (lines 620+ area): styles for `.inspector-color-row`, `.color-picker-input`, `.color-mixed-indicator`
- Add Inspector tests: color pickers appear for selected item, color change dispatches command, multi-select shows "mixed" label

**Allowed files**:
- `apps/desktop/src/components/Inspector.tsx`
- `apps/desktop/src/components/ColorPicker.tsx` (NEW)
- `apps/desktop/src/styles/workspace.css` — **Inspector section ONLY (lines 620+)**
- `apps/desktop/src/components/__tests__/Inspector.test.tsx`

**Forbidden files**:
- `apps/desktop/src/components/Canvas.tsx`
- `apps/desktop/src/styles/workspace.css` — **Canvas section (lines 410-619)**
- All domain files (`packages/domain/src/*`)
- All store files (`packages/state/src/*`)
- All barrel exports

**CSS ownership rule**: You may ONLY add/modify rules in the Inspector section of
workspace.css (after the `/* Inspector Panel */` section header). Do not add rules
in the Canvas section.

**Success invariants**:
- ColorPicker component renders and emits color values
- Inspector shows fill/stroke editors for single selected item
- Inspector shows "mixed" indicator for multi-select with differing colors
- Color changes dispatch commands (undoable)
- No CSS changes outside the Inspector section
- Existing Inspector tests remain green + new color tests added

---

### Tail

#### 8B-201: Verifier Checklist
| Field | Value |
|---|---|
| Role | verifier |
| Depends on | 101, 102, 103 |

**Checklist**:
1. [ ] LayerItem.fill and .stroke are optional and backwards-compatible
2. [ ] Color commands are undoable (set-fill, set-stroke)
3. [ ] Canvas renders items with user-defined colors
4. [ ] Inspector shows color pickers for single selection
5. [ ] Inspector shows "mixed" for multi-select with different colors
6. [ ] ColorPicker component exists and functions
7. [ ] No packet exceeded its allowed file surface
8. [ ] CSS changes are in correct sections (Canvas vs Inspector)
9. [ ] No barrel export modifications (integrator's job)
10. [ ] Build passes: `npm run build` (or `npx tsc --noEmit`)
11. [ ] All tests pass (should be 209+ original + new)
12. [ ] No regressions in existing tests

---

#### 8B-301: Integrator
| Field | Value |
|---|---|
| Role | integrator |
| Depends on | 201 |

**Critical integration tasks**:
1. Merge all worktree branches into main
2. **workspace.css merge** — the key stress test: resolve any conflicts between Canvas and Inspector section changes
3. Update barrel exports: add `ColorValue` to `packages/domain/src/index.ts`
4. Update barrel exports: add new store actions to `packages/state/src/index.ts` if needed
5. Verify build + full test suite after merge
6. Record merge friction evidence (number of conflicts, resolution time, manual intervention needed)

---

#### 8B-401: Knowledge / Postmortem
| Field | Value |
|---|---|
| Role | knowledge |
| Depends on | 301 |

Record:
- Fitness score and grade
- Per-packet timing profile
- **Merge friction evidence** (the key 8B measurement)
- Operator overhead
- Single-Claude comparison judgment
- CSS section ownership verdict (did it work?)
- Doctrine deltas

---

## Scoring Expectations

| Bucket | Prediction | Reasoning |
|---|---|---|
| Quality (40) | 30-35 | UI work is harder to verify; color rendering may have edge cases |
| Lawfulness (25) | 20-23 | CSS section ownership is a new constraint; may see soft violations |
| Collaboration (20) | 14-18 | Merge friction is the trial's point — expect some, measure it |
| Velocity (15) | 10-12 | UI packets historically run longer; budget is generous |
| **Overall** | **74-88** | **Predicted: B+ to A-** |

### Grade criteria

**Call 8B an A only if**:
- Run score lands in A range (≥85)
- CSS merge resolves cleanly (section ownership works)
- No manual rescue in integration
- Operator overhead stays under 20 minutes
- All packets stay within ceiling

**Call it a B if**:
- CSS merge requires nontrivial manual resolution
- OR one packet exceeds ceiling
- OR integration needs barrel-export fixes beyond what was planned

**Call it a C or below if**:
- CSS merge is a mess (section ownership failed)
- OR multiple packets exceed ceiling
- OR manual rescue required for build/tests

## Single-Claude Comparison Rubric

Same as 8A — multi-claude win / neutral / loss with explicit criteria.

**The 8B-specific question**: Is the CSS merge friction overhead justified by
the parallel time savings? If a single Claude could have done all three packets
sequentially in 12-15 minutes with zero merge friction, multi-claude needs to
beat that on wall time even after merge overhead.

## Isolation Requirements (NON-NEGOTIABLE)

- [ ] CWD must be `F:\AI\studioflow` when launching agents
- [ ] Each agent must use `isolation: "worktree"`
- [ ] Each agent gets its own branch in `.claude/worktrees/`
- [ ] File changes must be contained in worktrees until integration
- [ ] Integrator must perform real branch merges
- [ ] Merge friction must be recorded (conflicts, resolution time)

If any of these fail, the trial is compromised (like 8A).

## Risk Register

| Risk | Mitigation |
|---|---|
| workspace.css merge conflict destroys both sections | CSS section ownership headers are clear; git can usually merge non-overlapping sections |
| Workers import from domain barrel export before integrator updates it | Workers import directly from source files, not barrel exports |
| ColorPicker component needs shared CSS that belongs to neither section | ColorPicker gets its own CSS section at the END of workspace.css, owned by 103 |
| makeDefaultItem needs color defaults but is in Canvas.tsx (102's territory) | 102 owns Canvas.tsx and updates makeDefaultItem |
| historyStore tests break because command shape changed | 101 owns commandStore tests and must maintain compatibility |
