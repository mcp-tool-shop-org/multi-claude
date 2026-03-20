# 9D-000 — Canonical Control Contract — Contract Freeze

**Phase:** 9D
**Objective:** Eliminate repeated semantic drift by establishing one canonical type surface for statuses, actions, refusals, and role-model mappings.
**Class:** Backend/state (strongest fit)
**Predicted fit:** A-

## Audit Findings (14 total)

| # | Finding | Severity | Fix Wave |
|---|---------|----------|----------|
| 2A | No `RunStatus` type; ghost `'cancelled'` | fork | W1 |
| 2B | No `WorkerStatus` type | drift | W1 |
| 2F | render.ts uses `'completed'` (worker status) for packet blocker check | **bug** | W1 |
| 5 | Duplicate divergent role-to-model maps | fork | W1 |
| 7D | `RunOverview.status` typed as `string` not union | drift | W1 |
| 7E | Worker status bare strings | drift | W1 |
| 4 | Two action catalogs with zero name overlap | drift | W2 |
| 7B | `operatorDecision` union defined inline in 2 places | redundant | W2 |
| 1E | `HookEvent` name collision | drift | W2 |
| 1F | `HookDecisionLog` vs `HookEvent` parallel shapes | drift | W2 |
| 3 | 5 distinct refusal-reason shapes | drift | W2 |
| 2C | `stopReasonToOutcome` inline vocabulary | drift | W2 |
| 1H | `RunResult`/`StatusResult` local to auto.ts | redundant | tail |
| 6 | Two "next move" engines, no shared vocabulary | drift | tail (doc) |

## Packet Graph

### Wave 1 — Canonical Types + Bug Fix
| Packet | File | Responsibility |
|--------|------|----------------|
| 9D-101 | `src/types/statuses.ts` | Canonical RunStatus, WorkerStatus, OperatorDecision types + role-model map |
| 9D-102 | Multiple consumers | Migrate run-model, auto, action-availability, next-action, render to canonical types; fix render.ts bug |

### Wave 2 — Action Vocabulary + Decision Contract
| Packet | File | Responsibility |
|--------|------|----------------|
| 9D-201 | `src/types/actions.ts` | Canonical action catalog, refusal detail shape, outcome vocabulary |
| 9D-202 | Multiple consumers | Migrate action-availability, action-executor, hook-feed, next-action to canonical types; rename HookEvent collision |

### Tail
| Packet | Responsibility |
|--------|----------------|
| 9D-301 | Contract guard tests — fail when local redefinition appears |
| 9D-401 | Integrator — verify all consumers use canonical, run full suite |

## Critical Rule

No packet-local type definitions for concepts in the canonical contract. All consumers import from `src/types/`.

## Success Criteria

1. `RunStatus`, `WorkerStatus`, `OperatorDecision` are union types in `src/types/`
2. Single `ROLE_MODEL_MAP` in `src/types/` — auto.ts and actions.ts both import it
3. render.ts bug fixed (`'completed'` → correct packet status check)
4. Contract guard tests that fail if a new file redefines a canonical type
5. All 515+ tests pass, no regressions
6. Ghost status `'cancelled'` removed
