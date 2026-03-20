# Run-Class Fit Map

> Multi-claude works best when packet count is high enough to amortize coordination
> overhead and file ownership is clean enough to keep semantic reconciliation bounded.

This document records where multi-claude wins, where it is neutral, and where it
should stay off. Every judgment is backed by a scored trial with real code shipped.

---

## Fit Map Table

| Work Class | Trial | Grade | Speed vs Single-Claude | Quality Delta | Confidence | Recommendation |
|---|---|---|---|---|---|---|
| Backend / state / domain | 8A | B (capped) | **Win** (~7 min parallel savings, low merge friction) | Neutral (same correctness either way) | Qualified — no worktree isolation | **Use multi-claude.** Sweet spot. Clean ownership, natural wave structure. |
| UI / interaction / seam-heavy | 8B | A- | **Neutral-to-slight-win** (~3.5 min parallel, ~7.5 min overhead) | Slight win (independent verification catches semantic drift) | Valid — full worktree isolation | **Use with caution.** Only worth it at 5+ packets with CSS/file section ownership. |
| Control-plane / infra | 8C | B+ | **Neutral** (~7 min parallel, ~9 min overhead) | Slight win (verifier caught a real bug integrator missed) | Valid — full worktree isolation | **Use with caution.** Quality gains are real but speed is break-even on 4-packet coupled work. |

---

## Confidence Levels

| Level | Meaning | Trials |
|---|---|---|
| **Valid** | Worktree isolation, real merges, measured friction | 8B, 8C |
| **Qualified** | Good product outcome, methodology compromised (no isolation) | 8A |

8A is not valid for merge friction, integration burden, or operator overhead comparisons.
It IS valid for backend packet-shape lessons and correctness outcomes.

---

## Judgment Details

### Backend / State / Domain — STRONG FIT

**Why it works:**
- File ownership is naturally clean (one module per packet, no shared seam files)
- Wave structure maps directly to domain layers: core → boundary → tests → integration
- Merge friction is textual (file-level), not semantic (API-assumption-level)
- Workers don't need to understand other workers' architectural intent

**Evidence:**
- 8A: 4 builder packets, all under budget, zero file overlap
- 54 new tests, 349/349 green, real invariant hardening
- Packet boundaries held perfectly — zero "while here" drift

**Speed signal:** Multi-claude would likely win by 3-5 minutes on 4-packet backend work.
Single-Claude estimate: 12-15 min. Multi-claude estimate: 8-12 min including overhead.

**Caveat:** 8A lacked isolation, so merge friction is extrapolated from packet design, not measured.

---

### UI / Interaction / Seam-Heavy — MODERATE FIT

**Why it's viable but narrow:**
- CSS section ownership works (git auto-merges non-overlapping sections)
- Domain floor must be serial (Wave 1) before UI packets parallelize (Wave 2)
- The real cost is not git conflicts — it's **semantic reconciliation**
- Workers make independent API assumptions that diverge (nested vs flat, wrong command names)

**Evidence:**
- 8B: 3 builder packets, all under budget, zero textual merge conflicts
- 11 semantic fix sites across 3 files (wrong property paths, wrong command types)
- CSS section ownership held — the central hypothesis validated
- 228/228 tests green, 19 new

**Speed signal:** Multi-claude saves ~3.5 min on Wave 2 parallelism but adds ~7.5 min of
overhead. Net: ~5 min slower for 3-packet UI work. Break-even at 5+ packets.

**Key lesson:** Semantic mismatch is the primary integration cost for UI work, not git conflicts.
The integrator role is essential — even with clean merges, API shape reconciliation is real work.

---

### Control-plane / Infra — MODERATE FIT

**Why it's at break-even:**
- Internal coupling creates invisible type-level dependencies between packets
- Workers must understand architectural intent, not just API surfaces
- Type casts (`as X`) bypass the compiler but create runtime mismatches
- The coupling guard (law vs wire separation) is essential but adds design overhead

**Evidence:**
- 8C: 4 builder packets, all under budget, zero textual merge conflicts
- 2 semantic issues: `escalate_human` vs `escalate` type mismatch (caught by verifier, not integrator),
  `retry_once` partially wired (documented gap)
- Coupling guard held perfectly — no packet both defined and wired
- 225/225 tests green, 42 new

**Speed signal:** Multi-claude saves ~7 min of builder time but adds ~9 min of overhead.
Net: ~7 min slower for 4-packet coupled infra work. Break-even at 5-6+ packets.

**Key lesson:** Verifier catches what integrator misses on coupled code. Quality win is real.
Speed win requires more packets than UI or backend work to amortize the coupling tax.

---

## Decision Rubric

### Use multi-claude when:
- **5+ packets** with clear file ownership
- Work has natural wave structure (foundation → parallel leaves)
- Verifier/integrator add real value (cross-packet validation, semantic reconciliation)
- The work class is backend/state/domain (strong fit at any reasonable packet count)

### Be cautious when:
- **3-4 packets** on UI-heavy work (coordination overhead may erase parallel savings)
- **3-4 packets** on internally coupled infra (coupling tax is real)
- Shared CSS or shared seam files exist (section ownership helps but isn't free)

### Stay single-Claude when:
- Work is scaffold, unstable architecture, or tightly coupled small changes
- Packet count is 2 or fewer (coordination overhead dominates)
- The critical path is mostly sequential
- The operator would become the bottleneck

---

## The Scaling Law

Multi-claude's value = f(packet_count, ownership_clarity, coupling_inverse)

- **Packet count up → value up** (parallelism amortizes fixed coordination overhead)
- **Ownership clarity up → value up** (fewer semantic mismatches to reconcile)
- **Internal coupling up → value down** (more type-level assumptions, more drift)

The break-even packet count varies by work class:
- Backend: ~3 packets (low coupling, clean ownership)
- UI: ~5 packets (moderate coupling, section ownership required)
- Infra: ~5-6 packets (high coupling, law/wire separation required)

---

## Trial References

| Trial | Postmortem | Contract Freeze |
|---|---|---|
| 8A | `docs/trials/8A-401-POSTMORTEM.md` | `docs/trials/8A-000-CONTRACT-FREEZE.md` |
| 8B | `docs/trials/8B-401-POSTMORTEM.md` | `docs/trials/8B-000-CONTRACT-FREEZE.md` |
| 8C | `docs/trials/8C-401-POSTMORTEM.md` | `docs/trials/8C-000-CONTRACT-FREEZE.md` |
