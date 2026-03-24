# Workflow: Protect Lane Isolation

## Use when

A proposed change touches any of these paths:
- `src/commands/claim.ts` — claim atomicity, lease management, dependency checks
- `src/commands/submit.ts` — output submission, reconciliation trigger
- `src/commands/verify.ts` — verification gate
- `src/commands/auto.ts` — wave dispatch, worktree creation, result collection
- `src/runtime/reconcile.ts` — declared vs actual diff, scope checking, forbidden patterns
- `src/runtime/sdk-runtime.ts` — worker session launch, output classification
- `src/runtime/session-registry.ts` — live session tracking
- `src/lib/conflicts.ts` — role conflict matrix
- `src/lib/db.ts` — database schema, indexes, constraints
- `src/handoff/routing/` — lane resolution, routing actions

## Required chain

1. **Backend Engineer** — implements the change
2. **Test Engineer** — verifies claim atomicity, isolation boundaries, reconciliation truthfulness
3. **Critic Reviewer** — reviews against reject criteria below

Add **Security Reviewer** if the change affects file scope enforcement, forbidden patterns, or worktree isolation.

## Required review checks

The Critic must verify ALL of the following against evidence (not impression):

- [ ] Claim remains fully atomic: all checks + mutations in single `db.transaction()`
- [ ] `idx_claims_active_packet` UNIQUE partial index still enforces one active claim per packet
- [ ] Worktree isolation: each packet gets its own branch + worktree directory
- [ ] Reconciliation still compares declared manifest against actual `git diff`
- [ ] Role conflict matrix still prevents integrator building in same feature + verifier building same packet
- [ ] `classifyOutput()` stop reasons still reflect output state, not worker exit
- [ ] Verification gate still required between submitted and merged
- [ ] Filtered reconciliation patterns are documented (not silently expanded)
- [ ] `npm test` passes all 1600+ tests
- [ ] `npm run build` succeeds

## Reject criteria — automatic reject

A change is **automatically rejected** if it:

1. **Breaks claim atomicity.** Any change that moves checks or mutations outside the `db.transaction()` boundary in `runClaim()`. If claim verification and claim recording can happen non-atomically, double-claims become possible.

2. **Weakens the one-active-claim invariant.** Any change that removes, modifies, or conditionally bypasses `idx_claims_active_packet`. If two workers can claim the same packet simultaneously, worktree isolation is meaningless.

3. **Allows file scope leakage.** Any change that weakens reconciliation scope checking, removes forbidden-file enforcement, or silently expands filtered patterns without documenting the expansion.

4. **Hides lane failures.** Any change that maps a failed/malformed/timed_out stop reason to `completed`, suppresses reconciliation errors in submit output, or allows unverified packets to advance past the verification gate.

5. **Conflates stop reason with verification verdict.** `completed` means valid JSON artifacts exist — NOT that reconciliation passed or verification succeeded. Any change that makes `completed` imply broader success is a truth regression.

6. **Removes role conflict enforcement.** Any change that weakens or bypasses the integrator/verifier conflict matrix without replacing it with equivalent or stronger enforcement.

7. **Makes reconciliation filtered patterns configurable without audit.** Adding patterns to the ignore list is a security decision. If a new pattern is added, the proving packet must be updated to document why that path is safe to ignore.

8. **Bypasses the verification gate.** Any change that allows packets to reach `merged` status without passing through `verifying` → `verified`. No "fast merge" shortcut.

9. **Makes human-facing reassurance stronger while leaving isolation semantics unchanged.** A change that rewrites docs to sound more isolated while the actual transaction boundaries, reconciliation filters, or conflict checks haven't improved.

10. **Reduces effective isolation or recovery truth while preserving the same outward success language.** The inverse of #9 and the most dangerous liar-path for this repo: behavior gets weaker (transaction boundary narrows, reconciliation filter expands, conflict check loosens) but the product still talks like the guarantees are unchanged. If isolation semantics change, the language must change with them.

## Doctrine references

- Claim atomicity: `src/commands/claim.ts:runClaim()` (single transaction)
- Unique claim index: `src/lib/db.ts` (idx_claims_active_packet)
- Role conflicts: `src/lib/conflicts.ts:checkRoleConflict()`
- Output classification: `src/runtime/sdk-runtime.ts:classifyOutput()`
- Reconciliation: `src/runtime/reconcile.ts:reconcileOutput()`
- Lane routing: `src/handoff/routing/routing-actions.ts:resolveLane()`
- Lockdown doctrine: `role-os-rollout/DOCTRINE.md`
