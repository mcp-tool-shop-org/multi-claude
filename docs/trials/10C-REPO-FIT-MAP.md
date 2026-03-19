# 10C-102 — Repo Fit Map

## Selection Criteria

Repos chosen to differ on:
- **Ownership clarity**: clean module boundaries → shared mutable state
- **File coupling**: independent modules → cross-cutting concerns
- **Semantic coupling**: type-level only → runtime state weaving
- **Review complexity**: mechanical → judgment-heavy
- **Post-approval change likelihood**: low → high

## Trial A — Claude Guardian (Low Coupling)

| Axis | Rating | Evidence |
|------|--------|----------|
| Ownership clarity | High | 19 modules, each owns one concern |
| File coupling | Low | Type-based imports only, no circular deps |
| Semantic coupling | Low | MCP tools are independent endpoints |
| Review complexity | Low | Additive changes, behavior preserved |
| Post-approval change risk | Low | Stable, recently shipped v1.2.0 |

**Repo:** mcp-tool-shop-org/claude-guardian
**Local:** F:\AI\claude-guardian
**Stack:** TypeScript, MCP server, 203 tests
**Version:** 1.2.0

**Trial task:** Enhanced Logging & Observability
- Add structured logging abstraction + wire through 7 command handlers
- 4-5 packets: core logger, CLI handler wiring, daemon integration, MCP/budget integration, docs
- All can parallelize after core logger stabilizes

**Why this repo:**
- Confirms happy-path pipeline works end-to-end
- Low risk of contribution ambiguity
- If multi-claude can't handle this cleanly, something is fundamentally wrong

**Expected pressure points:** Minimal. This is the control trial.

## Trial B — StudioFlow (Medium Coupling)

| Axis | Rating | Evidence |
|------|--------|----------|
| Ownership clarity | Medium | domain/state/ui layers clear, but canvas/inspector share workspace |
| File coupling | Medium | Uni-directional (domain→state→ui) but UI packets share CSS/canvas |
| Semantic coupling | Medium | State command names must match UI assumptions |
| Review complexity | Medium | Type freeze must precede UI work; naming mismatches likely |
| Post-approval change risk | Medium | Active development, domain shapes evolving |

**Repo:** mcp-tool-shop-org/studioflow
**Local:** F:\AI\studioflow
**Stack:** Tauri v2 + React 18 + Zustand, pnpm monorepo, 228 tests
**Version:** 0.1.0

**Trial task:** Gradient + Stroke Styling (Phase 7)
- Extend styling from solid fills to gradients + stroke properties
- 5-6 packets: domain types, state/commands, canvas rendering, inspector UI, verifier, integrator
- Wave 1 (domain, state) → Wave 2 (canvas, inspector) → verification + integration

**Why this repo:**
- Cross-language boundary (Rust + TS) forces clean packet seams
- Monorepo structure tests contribution attribution across packages
- Known friction point: workspace.css shared between canvas and inspector
- Phase 5/6 history provides baseline for what multi-claude coordination looks like here

**Expected pressure points:**
- State field naming mismatches between canvas and inspector packets
- Barrel export synchronization
- CSS merge conflicts in shared workspace file

## Trial C — Claude RPG (High Coupling)

| Axis | Rating | Evidence |
|------|--------|----------|
| Ownership clarity | Low | game-state.ts (885 lines) is mutation epicenter for all subsystems |
| File coupling | High | 5+ subsystems all import from game state, session, and turn loop |
| Semantic coupling | High | Runtime state weaving: equipment → reputation → dialogue → audio |
| Review complexity | High | Understanding requires tracing state flow across 6+ files |
| Post-approval change risk | High | Active development, frequent state schema evolution |

**Repo:** mcp-tool-shop-org/claude-rpg
**Local:** F:\AI\claude-rpg
**Stack:** TypeScript, terminal game engine, 192 tests
**Version:** 1.4.0

**Trial task:** Equipment Relic Companion Bonuses
- Relic achievement triggers companion morale boost + special dialogue + audio cues
- 7-8 packets: chronicle schema, profile milestones, dialogue context, immersion hooks, director rendering, session serialization, turn loop integration, narration plumbing
- Touches: game-state.ts, session.ts, immersion-runtime.ts, dialogue-mind.ts, turn-loop.ts

**Why this repo:**
- Forces doctrine into the place where it either holds or breaks
- Shared mutable game state means contribution boundaries blur
- Every packet reads/writes overlapping truth
- If promotion and handoff stay trustworthy here, they work everywhere

**Expected pressure points:**
- Contribution ambiguity: which packet "owns" a change to game-state.ts?
- Semantic reconciliation: conflicting mutations to the same state object
- Recovery frequency: higher intervention likelihood
- Review readiness: should be conservative — handoff must honestly flag coupling risk
- Invalidation: post-approval changes to shared state should trigger invalidation

## Trial Spread Summary

| Trial | Coupling | Packets | Key Question |
|-------|----------|---------|-------------|
| A | Low | 4-5 | Does the happy path work end-to-end? |
| B | Medium | 5-6 | Does contribution clarity survive shared seams? |
| C | High | 7-8 | Does the law still tell the truth under real pressure? |

Total packets across trials: 16-19
Expected total interventions: 0 (A), 1-2 (B), 3+ (C)
