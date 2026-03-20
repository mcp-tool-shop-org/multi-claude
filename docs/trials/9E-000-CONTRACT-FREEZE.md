# Phase 9E — Guided Recovery Flows

## Contract Freeze

**Frozen**: 2026-03-19
**Thesis**: Turn refusal, blockage, and partial failure into a lawful recovery path the operator can follow.

## Scope

Recovery is a **derived guidance layer** built from existing truth. It produces a `RecoveryPlan` for a run, packet, or worker target. It does not execute actions, store mutable recovery state, or create alternate execution paths.

## What 9E adds

- Canonical recovery types (`src/types/recovery.ts`)
- Finite scenario catalog mapping system states to recovery patterns
- Derivation engine that consumes control truth and produces `RecoveryPlan`
- Operator-grade rendering of recovery plans
- CLI surface: `console recover [--json] [--target <id>]`
- Contract guard tests for recovery completeness

## What 9E does not add

- No new DB tables
- No auto-healing or silent execution
- No recovery-only executor (reuses existing `console act`)
- No "smart" retries bypassing preconditions
- No mutable recovery state

## Packet Graph

### Wave 1 — Meaning (parallel)

| Packet | File | Delivers |
|--------|------|----------|
| 9E-101 | `src/types/recovery.ts` | RecoveryPlan, RecoveryStep, RecoveryScenario, RecoveryBlocker, enums |
| 9E-102 | `src/console/recovery-catalog.ts` | Finite scenario catalog, state → scenario mapping |
| 9E-103 | `src/console/recovery-plan.ts` | Derivation engine: truth → RecoveryPlan |

### Wave 2 — Surface (parallel, depends on W1)

| Packet | File | Delivers |
|--------|------|----------|
| 9E-201 | `src/console/recovery-render.ts` | Terminal rendering for recovery plans |
| 9E-202 | `src/commands/console-recover.ts` | CLI wiring + integration with parent console command |
| 9E-203 | `test/types/recovery-guard.test.ts` + `test/console/recovery-plan.test.ts` | Contract guards + scenario tests |

### Tail

| Packet | Delivers |
|--------|----------|
| 9E-401 | Integrator: full suite pass, no regressions |

## Recovery Scenarios (v1 catalog)

1. `failed_packet_retryable` — packet failed, retry legal
2. `failed_packet_exhausted` — packet failed, retry limit reached
3. `run_blocked_dependencies` — packets blocked on unresolved prerequisites
4. `resume_blocked_by_gate` — resume illegal due to unresolved approval gate
5. `resume_blocked_by_failure` — resume illegal due to outstanding failed packets
6. `hook_pending_approval` — hook decision awaiting operator resolution
7. `no_legal_action` — system waiting on external/worker condition
8. `multi_issue_triage` — multiple blockers, needs dominant blocker selection

## Key Rules

1. One dominant blocker per plan
2. Every step must unlock something
3. Refusal converts to direction
4. Manual steps labeled honestly
5. No new truth unless truly new truth appears
