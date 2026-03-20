# Phase 9F — Run Closure / Outcome Spine

## Contract Freeze

**Frozen**: 2026-03-19
**Thesis**: Make "done" as lawful and inspectable as "running."

## Scope

A derived run-level outcome model that answers:
- Did the run succeed cleanly, succeed with intervention, partially succeed, fail terminally, or stop resumably?
- What completed, what failed, what was recovered, what remains unresolved?
- Is the outcome acceptable?
- What is the next lawful follow-up?

## What 9F adds

- Canonical outcome types (`src/types/outcome.ts`)
- Outcome derivation engine (`src/console/run-outcome.ts`)
- Operator-grade outcome rendering (`src/console/outcome-render.ts`)
- CLI surface: `console outcome [--json] [--run <id>]`
- Contract guard tests

## What 9F does not add

- No new DB tables (outcome is derived, not stored)
- No new executor
- No vague "success" label hiding nuance
- No conflation of "all packets ended" with "run is acceptable"

## Packet Graph

### Wave 1 — Meaning (parallel)

| Packet | File | Delivers |
|--------|------|----------|
| 9F-101 | `src/types/outcome.ts` | RunOutcome, RunOutcomeStatus, PacketOutcome, FollowUp, UnresolvedItem |
| 9F-102 | `src/console/run-outcome.ts` | Derivation engine: DB truth → RunOutcome |

### Wave 2 — Surface (depends on W1)

| Packet | File | Delivers |
|--------|------|----------|
| 9F-201 | `src/console/outcome-render.ts` | Terminal rendering for outcomes |
| 9F-202 | `src/commands/console-outcome.ts` | CLI wiring + parent console integration |
| 9F-203 | test files | Contract guards + derivation tests |

### Tail

| Packet | Delivers |
|--------|----------|
| 9F-401 | Integrator: full suite pass |

## Outcome Status Taxonomy

| Status | Meaning |
|--------|---------|
| `clean_success` | All packets resolved, no intervention needed |
| `assisted_success` | All packets resolved, but operator intervention was required |
| `partial_success` | Some packets resolved, some failed/unresolved |
| `terminal_failure` | Run failed — unrecoverable without re-planning |
| `stopped` | Run stopped by operator — may be resumable |
| `in_progress` | Run not yet concluded |

## Key Rules

1. Outcome is derived, not stored — recomputed from current DB truth
2. "All packets ended" ≠ "run is acceptable"
3. Unresolved items are explicit, not hidden
4. Follow-ups link to existing console commands (recover, act)
5. Intervention history from audit trail informs outcome classification
