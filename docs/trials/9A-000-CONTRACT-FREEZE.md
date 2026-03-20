# 9A-000 Contract Freeze — Run Planner + Packet Graph Freeze Surface

## Trial Identity

| Field | Value |
|---|---|
| Phase | 9A: Operator Product Surface |
| Work Class | backend / state / domain |
| Repo | multi-claude (`F:\AI\multi-claude`) |
| Feature | Run Planner + Packet Graph Freeze |
| Frozen by | Operator (single-Claude) |
| Frozen at | 2026-03-19 |
| Isolation | **Worktree — mandatory** |

## Objective

Turn Phase 8 doctrine into product behavior. Two durable artifacts:

1. **RunPlan** — Given a proposed run, decide whether multi-claude should be used at all.
2. **RunBlueprint** — If yes, generate and freeze a lawful packet graph before launch.

This is the pre-run decision and freeze layer. Not a dashboard, not a live console.

## Architecture

### Three Layers

**Layer 1 — Doctrine Engine** (9A-101)
Pure decision logic. Inputs: work class, packet count, coupling, ownership, stability.
Outputs: recommendation, fit prediction, break-even analysis, anti-pattern warnings.
Source of truth: Phase 8 fit map evidence.

**Layer 2 — Blueprint Engine** (9A-102 schema + 9A-103 templates → 9A-202 builder)
Turns doctrine into: packet graph, ownership allocations, gates, verifier scaffold, freeze artifact.
The freeze builder is a legality check, not a form generator.

**Layer 3 — Thin Operator Surface** (9A-203)
CLI commands that collect inputs, show recommendations, let operator edit/freeze, render output.
Stays thin. Value is in Layers 1 and 2.

## Core Product Rule

The law engine remains the source of truth. 9A generates lawful artifacts that the CLI/DB
can consume, validate, and record. No direct DB bypass, no launch without frozen blueprint,
no recommendation logic hidden in prompts. Everything deterministic, inspectable, versioned.

---

## Packet Graph

### Wave 1 — Parallel Domain Spine

#### 9A-101: Planner Rule Engine
| Field | Value |
|---|---|
| Class | state_domain |
| Budget | 3-5 min |
| Ceiling | 6 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Pure decision logic for run fitness assessment.

**Work**:
- Create `src/planner/rules.ts`:
  - `WorkClass` type: `'backend_state' | 'ui_interaction' | 'control_plane'`
  - `CouplingLevel` type: `'low' | 'moderate' | 'high'`
  - `OwnershipClarity` type: `'clear' | 'mixed' | 'unclear'`
  - `RepoStability` type: `'stable' | 'settling' | 'unstable'`
  - `ObjectivePriority` type: `'speed' | 'quality' | 'balanced'`
  - `FitLevel` type: `'strong' | 'moderate' | 'weak'`
  - `ModeRecommendation` type: `'single_claude' | 'multi_claude' | 'multi_claude_cautious'`
  - `BREAK_EVEN` constant: `{ backend_state: 3, ui_interaction: 5, control_plane: 5 }`
  - `assessFit(input: PlannerInput): FitAssessment` — the core decision function
  - `detectAntiPatterns(input: PlannerInput): AntiPatternWarning[]` — check inputs against known failure shapes
  - `explainRecommendation(assessment: FitAssessment): string[]` — generate plain-language reasons
- Create `src/planner/types.ts`:
  - `PlannerInput` interface (workClass, packetCount, couplingLevel, ownershipClarity, repoStability, objectivePriority, seamDensity?)
  - `FitAssessment` interface (mode, fitLevel, predictedGradeRange, breakEvenEstimate, reasons, warnings, suggestedTemplate)
  - `AntiPatternWarning` interface (id, severity, description, evidence)
- Add unit tests in `test/planner/rules.test.ts` (NEW):
  - Backend + 5 packets + clear ownership → multi_claude + strong fit
  - UI + 3 packets + high coupling → single_claude + weak fit with warning
  - Control-plane + 6 packets + moderate coupling → multi_claude_cautious + moderate fit
  - Anti-pattern detection: low packet count, unclear ownership, unstable repo
  - Break-even edge cases
  - Explanation generation

**Allowed files**:
- `src/planner/rules.ts` (NEW)
- `src/planner/types.ts` (NEW)
- `test/planner/rules.test.ts` (NEW)

**Forbidden files**:
- All existing `src/` files
- All existing test files
- `src/planner/templates.ts` (103's territory)
- `src/planner/blueprint.ts` (202's territory)

**Success invariants**:
- `assessFit()` returns deterministic results for the same inputs
- All Phase 8 trial scenarios produce correct recommendations
- Anti-pattern detection covers all 8 known anti-patterns
- Explanations are human-readable
- Existing 225 tests remain green + new planner tests added

---

#### 9A-102: Blueprint Schema + Validation
| Field | Value |
|---|---|
| Class | state_domain |
| Budget | 3-5 min |
| Ceiling | 6 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Type definitions and validation for RunPlan and RunBlueprint artifacts.

**Work**:
- Create `src/planner/schema.ts`:
  - `RunPlan` interface:
    - id, createdAt, version
    - input: PlannerInput (from types.ts — import the type)
    - assessment: FitAssessment
    - overrideRationale?: string (if operator overrides recommendation)
    - frozen: boolean
  - `RunBlueprint` interface:
    - id, planId, createdAt, version
    - templateId: string
    - workClass, repoRoot
    - waves: WaveDefinition[] (each with wave number + packet definitions)
    - couplingGuards: CouplingGuard[]
    - verifierChecklist: ChecklistItem[]
    - humanGates: HumanGate[]
    - readinessResult: ReadinessResult
    - frozen: boolean, frozenAt?: string, frozenHash?: string
  - `PacketDefinition` interface:
    - packetId, label, role, packetClass
    - allowedFiles: string[], forbiddenFiles: string[]
    - budgetMinutes: [number, number]
    - ceilingMinutes: number
    - dependsOn: string[]
  - `WaveDefinition` interface: { wave: number, packets: PacketDefinition[] }
  - `CouplingGuard` interface: { rule: string, enforcedBy: 'verifier' | 'integrator' | 'both' }
  - `ChecklistItem` interface: { id: string, description: string, required: boolean }
  - `HumanGate` interface: { afterWave: number, gateType: string, description: string }
  - `ReadinessResult` interface: { ready: boolean, failures: string[], warnings: string[] }
  - `validateRunPlan(plan: unknown): { valid: boolean, errors: string[] }` — schema validation
  - `validateRunBlueprint(blueprint: unknown): { valid: boolean, errors: string[] }` — comprehensive validation:
    - No illegal file overlap between packets in same wave
    - Wave structure consistent (dependencies resolved before dependents)
    - Verifier checklist present
    - Human gates present
    - Coupling guards present
    - All packets have allowed/forbidden files
    - Timing budgets assigned
  - `computeFreezeHash(blueprint: RunBlueprint): string` — deterministic hash for versioning
- Add unit tests in `test/planner/schema.test.ts` (NEW):
  - Valid RunPlan passes validation
  - Valid RunBlueprint passes validation
  - Blueprint with overlapping files fails
  - Blueprint with missing gates fails
  - Blueprint with broken dependencies fails
  - Freeze hash is deterministic

**Allowed files**:
- `src/planner/schema.ts` (NEW)
- `test/planner/schema.test.ts` (NEW)

**Forbidden files**:
- All existing `src/` files
- All existing test files
- `src/planner/rules.ts` (101's territory)
- `src/planner/templates.ts` (103's territory)

**Note**: 102 may import types from `src/planner/types.ts` (101's file) since both depend
on the shared PlannerInput/FitAssessment types. If 101's types aren't available in the
worktree, define local stubs and document the mismatch for the integrator.

**Success invariants**:
- RunPlan and RunBlueprint are fully typed
- Validation catches illegal file overlap, broken dependencies, missing gates
- Freeze hash is deterministic (same blueprint → same hash)
- Existing 225 tests remain green + new schema tests added

---

#### 9A-103: Template Registry
| Field | Value |
|---|---|
| Class | state_domain |
| Budget | 3-5 min |
| Ceiling | 6 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Encode the three proven packet templates as structured data.

**Work**:
- Create `src/planner/templates.ts`:
  - `PacketTemplate` interface:
    - id: string (e.g., 'backend_law', 'ui_seam', 'control_plane')
    - name: string
    - workClass: string
    - description: string
    - waveStructure: TemplateWave[] (wave number, packet stubs with roles/classes/budgets)
    - couplingGuards: string[] (rules that must hold)
    - requiredGates: string[] (human gates required)
    - readinessChecks: string[] (pre-launch checks)
    - crossTemplateRules: string[]
  - `TemplateWave` interface: { wave: number, packets: TemplatePacketStub[], parallel: boolean }
  - `TemplatePacketStub` interface: { label: string, role: string, packetClass: string, budgetMinutes: [number, number], ceilingMinutes: number, description: string }
  - `BACKEND_LAW_TEMPLATE`: Backend Law template from 8A
    - Wave 1: invariant/core ‖ boundary/guardrails
    - Wave 2: adversarial tests ‖ integration/plugin
    - Gates: pre-Wave-2 check
    - Guards: no barrel exports by builders
  - `UI_SEAM_TEMPLATE`: UI Seam template from 8B
    - Wave 1: domain/state floor (serial)
    - Wave 2: component A ‖ component B (with CSS section ownership)
    - Gates: pre-Wave-2 check, mandatory integrator
    - Guards: CSS section ownership, no domain files in UI packets
  - `CONTROL_PLANE_TEMPLATE`: Control-Plane template from 8C
    - Wave 1: law A ‖ law B
    - Wave 2: wiring ‖ test harness
    - Gates: pre-Wave-2 check
    - Guards: no packet both defines law and wires orchestration
  - `TEMPLATE_REGISTRY`: Map<string, PacketTemplate> of all three
  - `getTemplate(id: string): PacketTemplate | undefined`
  - `suggestTemplate(workClass: string): PacketTemplate | undefined` — simple lookup by work class
  - `validateTemplateMatch(template: PacketTemplate, packetCount: number): { valid: boolean, warnings: string[] }` — check if packet count fits template structure
- Add unit tests in `test/planner/templates.test.ts` (NEW):
  - All three templates are in the registry
  - getTemplate returns correct template by ID
  - suggestTemplate maps work class to template
  - validateTemplateMatch warns when packet count is below template minimum
  - Each template has required gates and guards

**Allowed files**:
- `src/planner/templates.ts` (NEW)
- `test/planner/templates.test.ts` (NEW)

**Forbidden files**:
- All existing `src/` files
- All existing test files
- `src/planner/rules.ts` (101's territory)
- `src/planner/schema.ts` (102's territory)

**Success invariants**:
- Three templates match Phase 8 evidence exactly
- Registry is complete and queryable
- Template validation catches packet count mismatches
- Existing 225 tests remain green + new template tests added

---

### Wave 2 — Parallel Productization

#### 9A-201: Planner Service
| Field | Value |
|---|---|
| Class | backend |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101, 102, 103 |

**Goal**: Compose rules + schema + templates into a planner service.

**Work**:
- Create `src/planner/service.ts`:
  - `evaluateRun(input: PlannerInput): RunPlan` — orchestrate: assess fit, detect anti-patterns, suggest template, assemble RunPlan
  - `overridePlan(plan: RunPlan, rationale: string): RunPlan` — mark plan as overridden with rationale
  - `freezePlan(plan: RunPlan): RunPlan` — set frozen=true, immutable after this
- Add tests in `test/planner/service.test.ts` (NEW):
  - evaluateRun for each work class produces valid RunPlan
  - Override adds rationale
  - Freeze makes plan immutable
  - Anti-pattern warnings surface in plan

**Allowed files**:
- `src/planner/service.ts` (NEW)
- `test/planner/service.test.ts` (NEW)

**Forbidden files**: All existing files, all Wave 1 planner files (read-only import)

---

#### 9A-202: Freeze Builder
| Field | Value |
|---|---|
| Class | backend |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101, 102, 103 |

**Goal**: Generate and validate RunBlueprint from template + operator inputs.

**Work**:
- Create `src/planner/freeze.ts`:
  - `initBlueprint(plan: RunPlan, repoRoot: string, packetOverrides?: Partial<PacketDefinition>[]): RunBlueprint` — generate blueprint from template, apply overrides
  - `validateBlueprint(blueprint: RunBlueprint): ReadinessResult` — comprehensive legality check (file overlap, dependency order, gates, guards, budgets)
  - `freezeBlueprint(blueprint: RunBlueprint): RunBlueprint` — compute hash, set frozen=true, frozenAt
  - `renderContractFreeze(blueprint: RunBlueprint): string` — generate markdown freeze doc (replaces hand-authored 000 docs)
- Add tests in `test/planner/freeze.test.ts` (NEW):
  - initBlueprint from each template produces valid blueprint
  - validateBlueprint catches file overlap
  - validateBlueprint catches missing gates
  - freezeBlueprint sets hash and timestamp
  - renderContractFreeze produces readable markdown

**Allowed files**:
- `src/planner/freeze.ts` (NEW)
- `test/planner/freeze.test.ts` (NEW)

**Forbidden files**: All existing files, all Wave 1 planner files (read-only import)

---

#### 9A-203: CLI Commands (Thin Operator Surface)
| Field | Value |
|---|---|
| Class | backend |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101, 102, 103 |

**Goal**: CLI commands for plan + freeze workflow.

**Work**:
- Create `src/commands/plan.ts`:
  - `multi-claude plan evaluate` — collect inputs via flags, run evaluateRun, print RunPlan as JSON
  - `multi-claude plan override --plan <id> --rationale <text>` — mark override
  - `multi-claude plan freeze --plan <id>` — freeze plan
- Create `src/commands/blueprint.ts`:
  - `multi-claude blueprint init --plan <id> --repo <path>` — generate RunBlueprint from plan
  - `multi-claude blueprint validate --blueprint <id>` — run legality checks
  - `multi-claude blueprint freeze --blueprint <id>` — freeze and hash
  - `multi-claude blueprint render --blueprint <id>` — output markdown freeze doc
- Add DB persistence: `run_plans` and `run_blueprints` tables in schema
- Register commands in `bin/multi-claude.ts`

**Allowed files**:
- `src/commands/plan.ts` (NEW)
- `src/commands/blueprint.ts` (NEW)
- `src/db/schema.sql` (add tables — append only, no existing table modification)
- `bin/multi-claude.ts` (add command registration — import + addCommand lines only)

**Forbidden files**: All Wave 1/2 planner files (read-only import), all existing command files, all test files

---

### Tail

#### 9A-301: Verifier
| Field | Value |
|---|---|
| Role | verifier |
| Depends on | 201, 202, 203 |

**Checklist**:
1. [ ] assessFit produces correct recommendations for all three work classes
2. [ ] Anti-pattern detection covers all 8 known anti-patterns
3. [ ] Break-even constants match Phase 8 evidence
4. [ ] RunPlan and RunBlueprint types are complete and validated
5. [ ] Blueprint validation catches: file overlap, broken deps, missing gates
6. [ ] Three templates match Phase 8 packet shapes exactly
7. [ ] Template registry is complete and queryable
8. [ ] Planner service composes rules + schema + templates correctly
9. [ ] Freeze builder produces valid blueprints from each template
10. [ ] renderContractFreeze produces markdown comparable to hand-authored 000 docs
11. [ ] CLI commands work end-to-end (evaluate → init → validate → freeze → render)
12. [ ] DB tables created (run_plans, run_blueprints)
13. [ ] No packet exceeded allowed file surface
14. [ ] Build passes
15. [ ] All tests pass (225+ original + new)
16. [ ] No regressions

---

#### 9A-401: Integrator
| Field | Value |
|---|---|
| Role | integrator |
| Depends on | 301 |

**Critical tasks**:
1. Merge all worktree branches into main
2. Resolve import mismatches (Wave 2 imports from Wave 1 exports)
3. Wire CLI commands into bin/multi-claude.ts if not done
4. Verify build + full test suite
5. Record merge friction

---

## Scoring Expectations

| Bucket | Prediction | Reasoning |
|---|---|---|
| Quality (40) | 33-37 | Clean domain work, typed schemas, comprehensive validation |
| Lawfulness (25) | 20-23 | 6 packets, clear ownership, new directory (src/planner/) isolates naturally |
| Collaboration (20) | 16-18 | Low coupling between Wave 1 packets; Wave 2 imports from Wave 1 |
| Velocity (15) | 11-13 | Backend class, all packets should be under budget |
| **Overall** | **80-91** | **Predicted: B+ to A** |

This is 8A-class work (backend/state/domain) with 6 builder packets — well above the
break-even of 3. File ownership is clean (all new files in `src/planner/`). This should
be the strongest multi-claude run in Phase 8-9.

## Isolation Requirements (NON-NEGOTIABLE)

- [ ] CWD must be `F:\AI\multi-claude` when launching agents
- [ ] Each agent must use `isolation: "worktree"`
- [ ] Pre-Wave-2 hard gate before launching 201/202/203
- [ ] Integrator performs real branch merges
