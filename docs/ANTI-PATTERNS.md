# Anti-Patterns

Failure shapes observed in Phase 8 scored trials. Each pattern is documented with
the trial that proved it, the damage it causes, and how to prevent it.

> These are not theoretical risks. Every pattern below caused real friction,
> wasted time, or compromised trial methodology in at least one scored run.

---

## 1. No Worktree Isolation

**Trial:** 8A (ConsensusOS)
**Damage:** Trial methodology compromised. Merge friction, integrator value, and operator
overhead could not be measured. Grade capped at B despite A-quality code.

**What happens:**
- Workers write to the same repo simultaneously
- Workers see each other's in-progress changes
- Integrator has nothing to integrate (no branches to merge)
- Merge friction reads as zero, but that's because it was never tested

**Prevention:**
- `isolation: "worktree"` is non-negotiable for every worker agent
- CWD must be inside the target git repo when launching agents
- Smoke check before every trial: verify distinct worktree path, distinct branch, no leak to main
- If smoke check fails, stop. Do not proceed "close enough."

---

## 2. Giant UI Packets

**Trial:** Phase 5 postmortem (StudioFlow), confirmed in 8B contract design
**Damage:** 16+ minute packets, 60+ tool uses, merge friction from oversized ownership surfaces.

**What happens:**
- One packet owns too many files (component + CSS + tests + state + config)
- Worker exceeds budget trying to hold too much context
- Merge surface grows with packet size — more files = more conflict opportunity
- Packet can't be reviewed or verified in isolation

**Prevention:**
- Budget: 3-6 min per packet, ceiling 8 min for UI
- Split: component A and component B into separate packets with declared CSS sections
- Domain/state is always its own packet (serial Wave 1), never bundled with UI

---

## 3. Semantic Ownership Ambiguity Hidden Behind Zero Git Conflicts

**Trial:** 8B (StudioFlow — 11 semantic fix sites, zero git conflicts)
**Damage:** Clean merges that hide real integration debt. Runtime bugs that only surface
after deployment.

**What happens:**
- Git reports "no conflicts" because workers modified different lines
- But workers made incompatible API assumptions:
  - Nested `item.data.fill` vs flat `item.fill` (wrong property path)
  - Generic `item:update` vs specific `item:set-fill` (wrong command type)
  - Type casts `(item as any).fill` to work around missing types
- The code compiles (sometimes) but doesn't work correctly

**Why this is dangerous:**
- Zero git conflicts creates false confidence
- Without an explicit integrator role, the semantic mismatches ship
- CI may pass (wrong values, not wrong types) — bugs surface at runtime

**Prevention:**
- Integrator role is mandatory for UI work (budget 4-6 min for semantic reconciliation)
- Domain floor must be serial (Wave 1) so UI packets have real types
- Contract freeze must specify property access patterns, not just file ownership
- Verifier must check runtime behavior, not just compilation

---

## 4. Law and Wiring Mixed in One Packet

**Trial:** 8C (multi-claude — coupling guard prevented this, but the risk was explicit)
**Damage:** Semantic drift between law definition and law consumption. Workers redefine
behavior they should only consume.

**What happens:**
- A packet both defines retry policy AND wires the orchestrator to use it
- When that packet's assumptions change, there's no second pair of eyes
- The definition and consumption are tightly coupled in the same commit
- Integration becomes impossible because the boundary doesn't exist

**Prevention:**
- **Hard rule:** No packet may both define law and wire orchestration behavior
- Law packets define rules, policies, state transitions in their own files
- Wiring packets import and call — they do not redefine
- If a wiring packet needs a different function signature, it documents the mismatch (doesn't fix upstream)
- The integrator reconciles mismatches

---

## 5. Type-Cast Bypasses (`as X`)

**Trial:** 8C (multi-claude — `'escalate_human' as HookAction` caused runtime mismatch)
**Damage:** The compiler stops checking. Mismatches become invisible until runtime.

**What happens:**
- Worker needs a value that isn't in the type union
- Instead of fixing the type, worker casts: `'escalate_human' as HookAction`
- TypeScript accepts it. The code compiles. Tests pass (they check the casted value).
- Another worker checks against the real type union (`'escalate'`). Mismatch at runtime.

**Why this is especially dangerous in multi-claude:**
- Workers can't see each other's casts (worktree isolation)
- The integrator may fix one side but not the other
- Only the verifier (checking runtime paths) catches the full mismatch
- 8C required two fix passes: integrator caught the type issue, verifier caught the runtime split

**Prevention:**
- Contract freeze should flag `as` casts as a risk in allowed files
- If a worker needs a value not in a type union, the type union must be updated (law packet)
- Wiring packets must never cast — they consume canonical types only
- Verifier checklist must include runtime path verification, not just "does it compile"

---

## 6. Using Multi-Claude on 3-4 Tightly Coupled Packets Expecting Speed Wins

**Trial:** 8B (3 packets, neutral speed), 8C (4 packets, neutral speed)
**Damage:** No speed gain. Coordination overhead ≈ parallelism savings. Operator time wasted.

**What happens:**
- 3-4 packets run in ~3-4 min parallel
- But operator gates, integration, verification, and mismatch fixes add ~7-9 min
- Net wall time: same as or worse than single-Claude doing it sequentially
- The trial still has quality value (independent verification) but speed expectations are unmet

**The math:**
- Multi-claude fixed overhead: ~5 min (smoke check, gates, verification)
- Multi-claude variable overhead: ~2-5 min per wave (integration, semantic fixes)
- Single-Claude: just does the work. No overhead.
- Break-even requires enough parallel savings to exceed the overhead

**Prevention:**
- Know the break-even for your work class:
  - Backend: ~3 packets (low overhead, clean ownership)
  - UI: ~5 packets (moderate overhead, semantic reconciliation)
  - Infra: ~5-6 packets (high overhead, coupling tax)
- If you're below break-even, use single-Claude unless quality assurance (independent verification) is the primary goal
- Don't use multi-claude for speed on small coupled tasks. Use it for quality on complex tasks.

---

## 7. Letting "Documented Gap" Become Permanent Drift

**Trial:** 8C (multi-claude — `retry_once` logged but not fully wired)
**Damage:** A partial implementation documented as "complex, deferred" that never gets finished.

**What happens:**
- A wiring packet can't fully implement a feature (e.g., re-launching a worker on retry)
- It logs the hook action and adds a comment: "full retry re-launch is complex"
- This is honest and acceptable in the trial — the gap is visible
- But if nobody returns to finish it, the documented gap becomes permanent dead code
- Future developers see the comment, assume it's intentional, and build around the gap

**Prevention:**
- Every "documented gap" must have an explicit follow-up item (issue, ticket, or next-trial entry)
- Postmortem must record documented gaps as unfinished work, not as design decisions
- Next trial or sprint must either complete the gap or explicitly decide not to
- A documented gap older than 2 sprints is a bug, not a backlog item

---

## 8. Skipping the Pre-Wave-2 Hard Gate

**Not observed in Phase 8** (all three trials enforced the gate), but the risk is real.

**What would happen:**
- Wave 2 launches before Wave 1 is verified and merged
- Wave 2 workers branch from pre-Wave-1 base (missing domain types, new exports, etc.)
- Workers invent workarounds: type casts, dummy types, wrong import paths
- Integration becomes a mess of reconciling workarounds against real implementations
- This is worse than the semantic mismatch problem because the entire type floor is wrong

**Prevention:**
- Pre-Wave-2 gate is a hard gate, not a courtesy
- Verify: Wave 1 scope compliance, coupling guard, tests pass on merged main
- Only then launch Wave 2
- If any check fails, fix before proceeding. There is no "mostly proceed."

---

## Summary Table

| # | Anti-Pattern | Worst Trial | Primary Damage | Key Prevention |
|---|---|---|---|---|
| 1 | No worktree isolation | 8A | Methodology compromised | Smoke check before every trial |
| 2 | Giant UI packets | Phase 5 | Budget blown, merge friction | 3-6 min budget, split components |
| 3 | Semantic ambiguity behind clean merges | 8B | Runtime bugs ship undetected | Mandatory integrator + verifier |
| 4 | Law + wiring in one packet | 8C (prevented) | Semantic drift, no boundary | Hard coupling guard rule |
| 5 | Type-cast bypasses | 8C | Invisible runtime mismatch | Ban `as` casts, verify runtime |
| 6 | Small coupled work expecting speed | 8B, 8C | No speed gain | Know break-even by work class |
| 7 | Documented gap → permanent drift | 8C | Partial implementation rots | Explicit follow-up required |
| 8 | Skipping pre-Wave-2 gate | (prevented) | Wrong type floor for Wave 2 | Hard gate, no exceptions |
