# Strict Operating Playbook

When to use 1 Claude vs Operator + Multi-Claude vs Full Automated Multi-Claude.

**Core law:** Do not pay coordination tax unless the work can return more than it costs.

---

## Mode Selection

### Use 1 Claude when:
- The work is still defining the foundation
- The architecture is still moving
- One model can hold the whole problem cleanly
- Integration cost will outweigh parallel gain
- The main path is mostly sequential
- The repo floor is not stable yet

### Use Operator Claude + Multi-Claude when:
- The floor is stable
- The architecture is already defined enough to packetize
- There are multiple real leaves that can move in parallel
- The operator can manage the board without becoming the bottleneck
- Merge law is already in place
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

**That means:** repo bootstrap, first scaffold, workspace config, alias/test/env setup, architecture spine definition, initial protected/seam file declaration — these are NOT worker packets.

### Pick Operator + Multi-Claude if ALL of these are true:
- Repo floor is stable
- Build/test commands already work
- Domain contracts exist
- Packet boundaries can be stated cleanly
- There are at least 2 meaningful packets that can run in parallel
- Workers can stay inside allowed files
- Operator does not need to hand-edit every merge

**Right mode for:** subsystem buildout, command families, persistence + UI in parallel, background jobs + logs UI in parallel, export backend + export UI + docs in parallel, docs/audit/hardening passes.

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

**If builders are discovering missing installs, broken aliases, or contradictory manifests, you are wasting worker lanes.**

---

## Builder-Appropriate Work

### Good builder packets:
- One backend command family
- One state/store slice
- One UI panel family
- One export adapter
- One persistence adapter
- One test packet tied to a subsystem
- One docs packet based on completed code

### Bad builder packets:
- "Set up the entire repo"
- "Wire the whole app"
- "Make the architecture"
- "Fix whatever is needed"
- "Build all UI and tests"
- "Make the state system and also connect backend and also fix config"

---

## Packet Sizing Law

**Ideal:** 3–5 minutes of real worker time. Up to ~6 minutes for dense but lawful packets.

**Too small:** Function-level micro packets. More orchestration than work.

**Too large:** 7+ minute Sonnet packets, 50+ tool use packets, packets touching many unrelated files, packets that must invent architecture while implementing.

**Rule:** If a packet includes layout + wiring + tests + mocks + config changes + seam file changes + docs changes all in one, it is too big.

---

## Critical Path Rule

Before using Multi-Claude, identify the critical path.

- If the phase looks like `A → B → C → D` — parallelism is weak. Use 1 Claude.
- If the phase looks like `A → (B, C, D parallel) → E → (F, G parallel)` — Multi-Claude can pay off.

---

## Merge Tax Rule

Multi-Claude loses when merge is manual and expensive.

If merge requires repeated copy/inspect/add/commit/push/hand-merge/repair, then operator time will eat the gain.

**Use Multi-Claude only when:**
- Merge is automated or near-automated
- Seam files are limited
- Integration is a real packet, not operator improvisation

---

## Contradiction Rule

Never launch workers with contradictory packet law.

Examples:
- "Do not touch lib.rs" but also "register commands there"
- "Do not modify App.tsx" but also "wire the app there"

**When a packet contradicts itself:** do not launch it. Amend the packet first, or split the integration step cleanly.

---

## Readiness Checklist Before Multi-Claude

Only use Multi-Claude on a phase if these are ALL true:
- [ ] Repo builds
- [ ] Test harness exists
- [ ] Dependencies installed
- [ ] Manifests/config are stable
- [ ] Protected files declared
- [ ] Seam files declared
- [ ] Verification profiles declared
- [ ] Packet graph exists
- [ ] Packet output schema is canonical
- [ ] Submit validator matches worker contract
- [ ] Merge path is lawful
- [ ] At least two independent packets exist

If not, use 1 Claude / Operator Claude first.

---

## Mode Selection by Phase Type

| Phase Type | Mode | Why |
|------------|------|-----|
| Repo birth / foundation spine | 1 Claude | Too much global context, setup deps, critical path |
| New subsystem with stable foundation | Operator + Multi-Claude | Sweet spot for parallel leaves |
| Hardening / audit / remediation | Full or semi-automated Multi-Claude | Factory systems shine here |
| Cross-cutting refactor (uncertain) | 1 Claude | Architecture still uncertain, many shared files |
| Cross-cutting refactor (plan locked) | Operator + Multi-Claude | Packets split by subsystem, integrator reconciles |

---

## Anti-Patterns

Stop if you see these:
1. Using builders for scaffold — wrong, operator work
2. Sending unstable env/config to workers — stabilize floor first
3. Giant UI packet — split layout from wiring/tests
4. Manual merge after every packet — automation gap, fix the system
5. Using Multi-Claude because it "sounds more advanced" — wrong metric
6. One orchestrator doing every role and calling it independent — not the real thing
7. Keeping packet contradictions and hoping workers infer intent — fix the packet

---

## Performance Diagnosis

When Multi-Claude is slower than 1 Claude, ask:
1. Was the work mostly sequential?
2. Was scaffold/operator work mistakenly given to workers?
3. Were packets too large?
4. Was merge too manual?
5. Were there environment/setup misses?
6. Were packet contracts contradictory?
7. Did the operator become the bottleneck?

If yes, the lesson is not "factory is bad." The lesson is "wrong phase shape and too much coordination tax."

---

## Default Operating Pattern

**Step 1:** Use 1 Claude / Operator Claude to scaffold repo, install deps, fix config, set up tests, lock architecture spine, declare protected/seam files.

**Step 2:** Switch to Multi-Claude when contracts exist, at least 2 good parallel packets exist, and merge law is stable.

**Step 3:** Use full automated Multi-Claude only after manual and semi-manual runs have proven the path.

---

## Final Law

Do not use Multi-Claude to make work feel more impressive. Use it only when:
- The work is truly parallelizable
- The floor is stable
- The operator is not the bottleneck
- The merge path is not manual sludge

Otherwise, one Claude is better. And that is not a failure. That is disciplined use of the right tool for the phase.
