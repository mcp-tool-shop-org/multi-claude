# Repo Map — @mcptoolshop/multi-claude

## Stack

- Runtime: Node.js >= 20.0.0 (TypeScript, ESM)
- Build: tsc
- Test framework: Vitest (1600+ tests)
- Database: SQLite (better-sqlite3, WAL mode, foreign keys ON)
- Worker executor: @anthropic-ai/claude-agent-sdk
- CLI: Commander
- Monitor: Express (control plane server)

## Structure

```
src/
  commands/              # CLI command implementations
    auto.ts              # Wave-based parallel execution orchestrator
    claim.ts             # Atomic packet claim with lease
    progress.ts          # Claim → in_progress transition
    submit.ts            # Output submission with reconciliation
    verify.ts            # Verification gate
    promote.ts           # Status promotion (verified → integrating → merged)
    status.ts            # Database state query
    plan.ts              # Feature decomposition planning
  runtime/
    sdk-runtime.ts       # Claude Agent SDK worker session launcher
    session-registry.ts  # In-memory live session tracking
    reconcile.ts         # Declared vs actual diff reconciliation
    types.ts             # Runtime type definitions
  handoff/
    routing/             # Handoff Spine lane routing
      routing-actions.ts # Lane resolution (worker/reviewer/approver/recovery)
  lib/
    db.ts                # SQLite database initialization + schema
    conflicts.ts         # Role conflict matrix (builder/verifier/integrator)
    errors.ts            # Error codes enum
  ...
```

## Build commands

| Command | What it does |
|---------|-------------|
| `npm test` | Vitest (1600+ tests) |
| `npm run build` | `tsc` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | typecheck + test + build |

## Primary seam: Lane isolation + dispatch truthfulness

This is the highest-risk seam. If lane isolation leaks, workers modify each other's files. If dispatch is untruthful, work gets assigned to the wrong owner or state is misreported. If reconciliation filters hide real changes, unverified modifications slip through.

**Isolation layers (from strongest to weakest):**

| Layer | Mechanism | Strength | Known gap |
|-------|-----------|----------|-----------|
| Claim ownership | SQLite transaction + UNIQUE index | Strong | Worktree creation is outside the transaction |
| File isolation | Per-packet git worktree | Strong | Worktree cleanup on crash is manual |
| Output reconciliation | Declared manifest vs actual git diff | Strong | Build artifacts filtered by hardcoded patterns |
| Role conflict | Builder/verifier/integrator matrix in DB | Moderate | Session-level conflicts not enforced in DB |
| Session tracking | In-memory Map | Weak | Lost on crash, no persistence |

**Dispatch truthfulness chain:**

```
Plan (feature → packets with deps)
  → Claim (atomic: verify ready + deps met + no conflict + create attempt)
  → Worktree (per-packet branch, outside transaction)
  → Launch (Claude Agent SDK, isolated cwd, scoped tools)
  → Collect (Promise.allSettled, results indexed by launch order)
  → Classify (ERROR file → failed, missing JSON → malformed, valid → completed)
  → Reconcile (declared vs actual diff, scope check, forbidden check)
  → Submit (atomic: record artifacts + release claim + advance status)
  → Verify (gate: checks passed → verified, checks failed → rejected)
```

Every step in this chain has a truthfulness contract. The weakest link is the worktree creation gap — it happens after the claim transaction succeeds but before the worker starts. A crash here leaves an orphaned claim.

## Key invariants

| Component | Invariant |
|-----------|-----------|
| `commands/claim.ts` | Claim is fully atomic: status check + dep check + conflict check + attempt creation + claim insertion + status update — all in one `db.transaction()`. |
| `lib/conflicts.ts` | Integrator must not have built any packet in the same feature. Verifier must not have built the same packet. |
| `runtime/reconcile.ts` | Undeclared file modifications are caught. Forbidden file patterns are rejected. Scope violations are errors. |
| `runtime/sdk-runtime.ts:classifyOutput()` | `completed` means valid artifacts.json + writeback.json exist. NOT that reconciliation passed. |
| `commands/auto.ts` | Waves execute serially. Packets within a wave execute in parallel (Promise.allSettled). Results are collected in launch order. |
| SQLite schema | `UNIQUE INDEX idx_claims_active_packet ON claims(packet_id) WHERE is_active = 1` — prevents double-claim. |

## Secondary seams

### 1. Worktree creation outside transaction (auto.ts)
Claim transaction completes → packet is 'claimed'. Worktree creation happens next. If crash occurs between these two, packet is claimed but no worktree exists. Lease expires in 2 hours. Manual release required.

### 2. In-memory session registry (session-registry.ts)
Maps (runId, packetId) → handle. Lost on process crash. No persistence. Double-register overwrites silently.

### 3. Reconciliation filter patterns (reconcile.ts)
Hardcoded: node_modules, dist, target, .tsbuildinfo, pnpm-lock.yaml, Cargo.lock, .multi-claude. Changes in these paths are invisible to reconciliation. If a worker modifies `.multi-claude/` evidence, it's silently ignored.

### 4. Stop reason vs reconciliation verdict mismatch
`classifyOutput()` returns `completed` based on JSON validity. Reconciliation can still fail after classify says completed. The final truth is in the submit/verify results, not the stop reason.

## Validation law

- `npm test` runs 1600+ tests covering claim atomicity, role conflicts, e2e flows, routing
- `npm run build` compiles TypeScript
- CI matrix: Node 20 + 22
- All validation is terminal-based
