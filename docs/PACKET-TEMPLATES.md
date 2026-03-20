# Packet Templates

Reusable packet shapes derived from Phase 8 trials. Use these as starting points
when decomposing work into packets. Each template encodes lessons learned from
real scored runs.

> Multi-claude works best when packet count is high enough to amortize coordination
> overhead and file ownership is clean enough to keep semantic reconciliation bounded.

---

## Template 1: Backend Law

**Source trial:** 8A (ConsensusOS governor hardening)
**Fit:** Strong
**When to use:** State mutations, domain invariants, API hardening, module internals

### Wave Structure

```
Wave 1 (parallel):
  ├── Invariant / Core packet     — state transitions, type changes, core logic
  └── Boundary / Guardrails packet — input validation, error paths, edge cases

Wave 2 (parallel, depends on Wave 1):
  ├── Adversarial tests packet    — race conditions, resource exhaustion, idempotence
  └── Integration / Plugin packet — wire into host system, lifecycle integration

Tail:
  ├── Verifier
  ├── Integrator
  └── Postmortem
```

### Packet Sizing
- Budget: 3-6 min per packet
- Ceiling: 8 min
- Ideal count: 4 builder packets + tail

### Ownership Rules
- Each packet owns specific source files (module-level granularity)
- Test files follow their source files (if you own `foo.ts`, you own `foo.test.ts`)
- Barrel exports (`index.ts`) are integrator-only
- No packet touches another packet's source files

### What works
- Zero file overlap between Wave 1 packets (natural module boundaries)
- Wave 2 packets consume Wave 1 output (tests assert, integration wires)
- Low merge friction (file-level, not semantic)

### Watch for
- Test files that assert old API behavior must be in the packet that changes the API
- "While here" drift — if a packet touches files outside its boundary, the packet is too broad

---

## Template 2: UI Seam

**Source trial:** 8B (StudioFlow fill/stroke color properties)
**Fit:** Moderate (5+ packets to justify)
**When to use:** UI features touching multiple components and shared stylesheets

### Wave Structure

```
Wave 1 (serial — domain floor):
  └── Domain / State packet       — types, store actions, commands, undo support

Wave 2 (parallel, depends on Wave 1):
  ├── Component A packet          — e.g., Canvas rendering
  └── Component B packet          — e.g., Inspector editing

Tail:
  ├── Verifier
  ├── Integrator (MANDATORY — semantic reconciliation expected)
  └── Postmortem
```

### Packet Sizing
- Domain packet: 3-5 min (foundation, must be solid)
- UI packets: 4-6 min each (component + CSS + tests)
- Ceiling: 8 min per UI packet
- Ideal count: 1 domain + 2-4 UI packets + tail

### Ownership Rules
- Domain packet owns type definitions and store mutations exclusively
- Each UI packet owns its component file(s) and a declared CSS section
- CSS section ownership uses header comments as boundaries (e.g., `/* Canvas */`, `/* Inspector Panel */`)
- Shared CSS that belongs to neither section gets its own section, owned by a specific packet
- Barrel exports are integrator-only
- No UI packet touches domain files or another UI packet's component files

### CSS Section Ownership Protocol
1. Identify section headers in the shared stylesheet
2. Assign each section to exactly one packet in the contract freeze
3. Line ranges are approximate — the header comment is the real boundary
4. Workers may only add/modify rules within their assigned section
5. If a new section is needed, assign it to a specific packet in the contract

### What works
- CSS section ownership prevents textual merge conflicts (git auto-merges non-overlapping regions)
- Domain-first serial wave gives UI packets a stable type floor
- Independent components naturally parallelize (Canvas ‖ Inspector, Panel A ‖ Panel B)

### Watch for — THE MAIN RISK
**Semantic mismatch is the primary integration cost, not git conflicts.**

Workers that have the types still make wrong API assumptions:
- Nested `item.data.fill` vs flat `item.fill` (wrong property path)
- Generic `item:update` vs specific `item:set-fill` (wrong command type)
- Type casts `(item as any).fill` to work around missing types in worktree

The integrator MUST check:
1. Property access paths match the actual domain types
2. Command/action names match the actual command union
3. Type casts are removed after merge gives real types
4. Test assertions use correct property paths and command names

Budget 3-5 minutes of integrator time specifically for semantic reconciliation.

---

## Template 3: Control-Plane

**Source trial:** 8C (multi-claude retry/recovery hardening)
**Fit:** Moderate (5-6+ packets to justify)
**When to use:** Infra, orchestration, runtime systems with internal coupling

### Wave Structure

```
Wave 1 (parallel — law packets):
  ├── Law A packet               — define rules, policies, state transitions
  └── Law B packet               — define cleanup, lifecycle, resource management

Wave 2 (parallel, depends on Wave 1):
  ├── Wiring packet              — wire law into orchestrator (CONSUME only)
  └── Test harness packet        — end-to-end tests proving law + wiring

Tail:
  ├── Verifier
  ├── Integrator
  └── Postmortem
```

### Packet Sizing
- Law packets: 4-6 min (define, don't wire)
- Wiring packet: 5-7 min (import and call, don't redefine)
- Test harness: 5-7 min (comprehensive scenarios)
- Ceiling: 10 min for Wave 2 packets
- Ideal count: 2 law + 2 consuming + tail

### Ownership Rules — THE COUPLING GUARD

**Hard rule: No packet may both define law and wire orchestration behavior.**

- Law packets own policy/rule files and their direct dependencies
- Wiring packet owns the orchestrator file ONLY
- Test harness owns new test files ONLY (read-only access to src/)
- The wiring packet CONSUMES functions from law packets — it does not redefine them
- If a function signature doesn't match what the wiring packet needs, it documents the mismatch (doesn't fix upstream)

### What works
- Law/wire separation prevents semantic drift between definition and consumption
- Wave 1 parallelism on independent law domains (retry ‖ cleanup)
- Wave 2 parallelism on independent consumption (wiring ‖ tests)

### Watch for — THE MAIN RISK
**Type casts and invisible coupling are the primary integration cost.**

- `as X` casts bypass the type system and hide mismatches until runtime
- Contract freeze should flag or ban `as` casts in allowed files
- Workers make assumptions about function names, parameter order, return types
- The integrator must verify that wiring calls match actual law exports (name, signature, semantics)
- The verifier must verify that the integrated result actually works at runtime (not just compiles)

Budget integrator time for signature reconciliation. Budget verifier time for runtime path verification.

---

## Cross-Template Rules

### Pre-Wave-2 Hard Gate (all templates)
Before launching Wave 2, verify:
1. All Wave 1 packets stayed within allowed file surfaces
2. No coupling guard violations
3. Wave 1 merged to main cleanly
4. Tests pass on merged main
5. CSS section ownership ranges intact (UI template only)

Do not proceed "close enough." If any check fails, fix before Wave 2.

### Integrator Budget (all templates)
| Work class | Expected integrator time | Primary task |
|---|---|---|
| Backend | 2-3 min | Barrel exports, import wiring |
| UI | 4-6 min | Semantic reconciliation (property paths, command names) |
| Control-plane | 3-5 min | Signature verification, type-cast cleanup |

### Verifier Value (all templates)
The verifier is not ceremony. Evidence from trials:
- 8A: Caught one scope violation (test file touching)
- 8B: Confirmed 12/12 checklist items (no additional findings)
- 8C: Caught a runtime type mismatch that the integrator missed

**Rule:** If the verifier finds nothing, that's a good sign. If you skip the verifier,
you lose the safety net that catches what the integrator misses.
