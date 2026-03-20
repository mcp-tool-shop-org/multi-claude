# When to Use Multi-Claude

Operating doctrine for mode selection. Updated from principle to evidence after
Phase 8 scored trials (8A backend, 8B UI, 8C infra).

> Multi-claude works best when packet count is high enough to amortize coordination
> overhead and file ownership is clean enough to keep semantic reconciliation bounded.

---

## Decision Rubric

### Use multi-claude when:
- **5+ packets** with clear file ownership and real verifier/integrator value
- Work has natural wave structure (foundation → parallel leaves → integration)
- The work class is backend/state/domain (strong fit at 3+ packets)
- Independent verification materially matters (compliance, production-critical)

### Be cautious when:
- Work is **UI-heavy with only 3-4 packets** — coordination overhead likely erases parallel savings. Semantic reconciliation (wrong API assumptions) is the real cost, not git conflicts.
- Work is **internally coupled infra with 3-4 packets** — coupling tax is real. Quality gains exist (verifier catches what integrator misses) but speed is break-even.
- Shared CSS or seam files exist without declared section ownership

### Stay single-Claude when:
- Scaffold, unstable architecture, or tightly coupled small changes
- Packet count is 2 or fewer (coordination overhead dominates)
- The critical path is mostly sequential (`A → B → C → D`)
- The operator would become the bottleneck
- The repo floor is not stable (build/test broken, deps missing)

---

## Evidence Summary

| Work Class | Trial | Grade | Speed | Quality | Break-even |
|---|---|---|---|---|---|
| Backend/state | 8A | B (capped) | Win | Neutral | ~3 packets |
| UI/interaction | 8B | A- | Neutral | Slight win | ~5 packets |
| Control-plane | 8C | B+ | Neutral | Slight win | ~5-6 packets |

Full evidence: `docs/RUN-CLASS-FIT-MAP.md`

---

## Mode Selection

### Use 1 Claude when:
- The work is still defining the foundation
- The architecture is still moving
- One model can hold the whole problem cleanly
- Integration cost will outweigh parallel gain
- The main path is mostly sequential
- The repo floor is not stable yet

### Use Operator + Multi-Claude when:
- The floor is stable
- The architecture is defined enough to packetize
- There are multiple real leaves that can move in parallel
- File ownership can be stated cleanly per packet
- Merge law is in place (worktree isolation, section ownership)
- The work benefits from independent critique or verification

### Use Full Automated Multi-Claude when:
- Packets are lawful and stable
- Worker output schema is canonical
- Integration is automated or nearly automated
- Human gates are explicit
- Retries are controlled
- The system has already survived manual/semi-manual live runs

---

## Hard Mode Selection Rules

### Pick 1 Claude if ANY of these are true:
- Repo does not exist yet
- Package/workspace/test config is not settled
- Dependencies are not installed and verified
- The product thesis is still changing
- Protected/seam manifests are not defined
- The phase depends on one dominant critical path
- More than 50% of the work is "figure out what this repo should be"

**That means:** repo bootstrap, first scaffold, workspace config, alias/test/env setup,
architecture spine definition, initial protected/seam file declaration — these are NOT
worker packets.

### Pick Operator + Multi-Claude if ALL of these are true:
- Repo floor is stable
- Build/test commands already work
- Domain contracts exist
- Packet boundaries can be stated cleanly
- There are at least 3 meaningful packets that can run in parallel (evidence: 2 is rarely enough)
- Workers can stay inside allowed files
- Operator does not need to hand-edit every merge

**Right mode for:** subsystem buildout, command families, persistence + UI in parallel,
hardening passes, test harness expansion.

### Pick Full Automated only if ALL of these are true:
- Canonical packet/output schemas exist
- Worker prompts are generated from the same contract validators use
- Worktree isolation is real
- Submit/verify/promote/integrate all work cleanly
- Human pause gates are defined
- Retry policy is defined
- At least one live multi-session run already succeeded

---

## Operator-Only Work

These should almost always be done by Operator Claude, not builders:
- Repo creation
- Workspace/package topology
- Dependency installation
- TypeScript/Vitest/Vite aliasing
- Rust crate/setup wiring
- CI baseline
- Protected file declaration
- Seam file declaration
- Verification profile declaration
- Phase planning
- Packet graph decomposition
- Merge/integration policy changes
- Any fix to the factory itself
- Contract freeze authoring

**If builders are discovering missing installs, broken aliases, or contradictory manifests,
you are wasting worker lanes.**

---

## Packet Sizing Law

**Ideal:** 3-5 minutes of real worker time. Up to 6 minutes for dense but lawful packets.

**Too small:** Function-level micro packets. More orchestration than work.

**Too large:** 7+ minute packets, 50+ tool use packets, packets touching many unrelated
files, packets that must invent architecture while implementing.

**Rule:** If a packet includes layout + wiring + tests + mocks + config changes + seam
file changes + docs changes all in one, it is too big.

**Break-even counts by work class:**
- Backend: ~3 packets (low coupling, clean ownership)
- UI: ~5 packets (moderate coupling, section ownership required)
- Infra: ~5-6 packets (high coupling, law/wire separation required)

---

## Critical Path Rule

Before using Multi-Claude, identify the critical path.

- If the phase looks like `A → B → C → D` — parallelism is weak. Use 1 Claude.
- If the phase looks like `A → (B, C, D parallel) → E` — Multi-Claude can pay off.
- If the phase looks like `A → (B, C parallel) → (D, E parallel) → F` — sweet spot.

---

## Merge Tax Rule

Multi-Claude loses when merge is manual and expensive.

**Two kinds of merge friction (from Phase 8 evidence):**
1. **Textual** — git conflicts from overlapping file edits. Prevented by clean file ownership and section declarations.
2. **Semantic** — API shape mismatches, wrong property paths, type-cast bypasses. This is the real cost. Prevented by stable domain floor (serial Wave 1) and explicit integrator budget.

**Use Multi-Claude only when:**
- Worktree isolation is real (non-negotiable — 8A proved this)
- Seam files have declared section ownership
- Integration is a real packet with budgeted semantic reconciliation time

---

## Readiness Checklist Before Multi-Claude

Only use Multi-Claude on a phase if these are ALL true:
- [ ] Repo builds
- [ ] Test harness exists
- [ ] Dependencies installed
- [ ] Manifests/config are stable
- [ ] Protected files declared
- [ ] Seam files declared with section ownership
- [ ] Packet graph exists with allowed/forbidden file lists
- [ ] Worktree isolation works (smoke check)
- [ ] At least 3 independent packets exist
- [ ] Pre-Wave-2 hard gate is defined

If not, use 1 Claude / Operator Claude first.

---

## Performance Diagnosis

When Multi-Claude is slower than 1 Claude, ask:
1. Was the packet count too low for the work class? (Below break-even)
2. Was the work mostly sequential?
3. Were shared files missing section ownership? (Semantic mismatch)
4. Did workers use type casts (`as X`) to bypass missing types? (Coupling leak)
5. Were packets too large?
6. Was merge too manual?
7. Were packet contracts contradictory?
8. Did the operator become the bottleneck?

If yes, the lesson is not "factory is bad." The lesson is "wrong phase shape or
insufficient packet discipline for this work class."

---

## Final Law

Do not use Multi-Claude to make work feel more impressive. Use it only when:
- The work is truly parallelizable
- The floor is stable
- The packet count justifies the coordination overhead for this work class
- File ownership is clean enough to keep semantic reconciliation bounded
- The operator is not the bottleneck

Otherwise, one Claude is better. And that is not a failure. That is disciplined
use of the right tool for the work class.
