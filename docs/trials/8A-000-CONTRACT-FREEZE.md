# 8A-000 Contract Freeze — Governor Protocol Hardening

## Trial Identity

| Field | Value |
|---|---|
| Trial ID | 8A |
| Phase | 8: Repeatability & Fit Map |
| Work Class | State/backend/domain |
| Repo | ConsensusOS (`F:\AI\ConsensusOS`) |
| Seam | Token-driven task execution (governor module) |
| Frozen by | Operator (single-Claude) |
| Frozen at | 2026-03-19 |

## Operative Framing

> ConsensusOS Trial 8A is a bounded protocol-hardening run designed to measure
> multi-claude's fit for backend law work. It will harden one protocol seam only,
> using four lawful packets with clean ownership: core invariants, boundary
> guardrails, adversarial tests, and runtime integration.

## Trial Thesis

**Does multi-claude clearly outperform single-Claude on bounded backend law work
with strong tests, low seam friction, and honest parallel leaves?**

## Target Seam: Governor Token-Task Execution

### Why This Seam

- **Bounded**: 5 production files, ~800 LOC, all in `src/modules/governor/`
- **Real invariant gaps**: consume has no guards, validate mutates state, token-task lifecycle has race conditions
- **Strong safety net**: 68 existing tests across 5 test files (749 LOC)
- **Low shared-seam count**: governor module is self-contained, no cross-module ownership conflicts
- **Meaningful outcome**: hardening makes ConsensusOS genuinely more correct

### Identified Invariant Gaps

| # | Gap | Severity | File |
|---|---|---|---|
| 1 | `consume()` accepts revoked tokens | High | token-issuer.ts:89-96 |
| 2 | `consume()` allows double-consume | High | token-issuer.ts:89-96 |
| 3 | `validate()` mutates state (auto-revokes expired tokens) | Medium | token-issuer.ts:99-110 |
| 4 | Token can expire mid-execution, task completes, consume hits auto-revoked token | High | build-queue.ts:107-125 |
| 5 | `active()` silently filters expired tokens without audit trail | Medium | token-issuer.ts:124-130 |
| 6 | `clear()` on TokenIssuer/AuditLog has no audit record | Low | token-issuer.ts:153, audit-log.ts:66 |
| 7 | No formal consumed+revoked mutual exclusion invariant | Medium | types.ts (ExecutionToken) |
| 8 | Same-priority FIFO ordering untested | Low | build-queue.ts:64-70 |

## Packet Graph

### Wave 1 — Parallel Core Packets

#### 8A-101: Invariant Kernel
| Field | Value |
|---|---|
| Class | state/domain |
| Budget | 4-6 min |
| Ceiling | 6 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Harden token state machine and task lifecycle invariants.

**Work**:
- Add consume guards: reject revoked tokens, reject double-consume
- Separate `validate()` read path from `autoExpire()` mutation path
- Add token state invariant: `consumed && revoked` must be impossible
- Handle token expiration during task execution (build-queue processNext)
- Add audit entries for silent expiration in `active()` filter
- Add/update unit tests proving each invariant holds

**Allowed files**:
- `src/modules/governor/token-issuer.ts`
- `src/modules/governor/build-queue.ts`
- `src/modules/governor/types.ts` (type changes only if needed for invariant)
- `tests/token-issuer.test.ts`
- `tests/build-queue.test.ts`

**Forbidden files**:
- `src/modules/governor/policy-engine.ts`
- `src/modules/governor/audit-log.ts`
- `src/modules/governor/governor-plugin.ts`
- `src/core/*`
- `src/adapters/*`
- `src/modules/sandbox/*`
- `src/modules/health/*`
- `src/modules/verifier/*`
- `src/modules/config/*`
- `src/state/*`
- `src/plugins/*`
- `src/sdk/*`
- `src/cli/*`

**Success invariants**:
- `consume()` throws on revoked token
- `consume()` throws on already-consumed token
- `validate()` is a pure read (no state mutation)
- Separate `autoExpire()` method handles expiration with audit
- Token expiration during execution is handled gracefully
- All new invariants have corresponding test assertions
- Existing 30 tests (token-issuer + build-queue) remain green

---

#### 8A-102: Boundary Guardrails
| Field | Value |
|---|---|
| Class | backend |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 000 |

**Goal**: Harden policy evaluation and audit completeness at protocol boundaries.

**Work**:
- Add audit completeness verification: every state transition must have a corresponding audit entry
- Add audit immutability assertion: returned entries are deep copies
- Tighten policy-engine edge cases: empty rules return allow, all-throttle scenario, conflicting priorities
- Add boundary validation: reject malformed TokenRequest fields (negative CPU, zero memory, NaN priority)
- Add audit log helper: `verifyCompleteness(entityId)` — checks every expected action is present

**Allowed files**:
- `src/modules/governor/policy-engine.ts`
- `src/modules/governor/audit-log.ts`
- `src/modules/governor/types.ts` (type additions only)
- `tests/policy-engine.test.ts`
- `tests/audit-log.test.ts`

**Forbidden files**:
- `src/modules/governor/token-issuer.ts`
- `src/modules/governor/build-queue.ts`
- `src/modules/governor/governor-plugin.ts`
- `src/core/*`
- `src/adapters/*`
- All other `src/modules/*`
- `src/state/*`
- `src/plugins/*`
- `src/sdk/*`
- `src/cli/*`

**Success invariants**:
- Boundary validation rejects all malformed inputs
- Audit completeness helper verifies full lifecycle coverage
- Policy edge cases are tested and documented
- Audit entries returned by query methods are deep copies (not mutable references)
- Existing 12 tests (policy-engine + audit-log) remain green

---

### Wave 2 — Parallel Follow-Through

#### 8A-103: Adversarial Test Harness
| Field | Value |
|---|---|
| Class | verification |
| Budget | 5-8 min |
| Ceiling | 12 min |
| Role | builder |
| Depends on | 101, 102 |

**Goal**: Add adversarial/stress/property tests for the hardened seam.

**Work**:
- Token expiration race: issue token with 1ms TTL, submit task, verify graceful handling
- Resource exhaustion boundary: issue tokens consuming exactly max CPU, then attempt +1
- Priority inversion stress: fill queue with low-priority, submit high-priority, verify ordering
- Concurrent token operations: consume + revoke same token simultaneously
- Audit completeness check: full lifecycle (issue → submit → start → complete) has matching audit entries
- Replay determinism: same token+task sequence produces identical audit trail

**Allowed files**:
- `tests/governor-adversarial.test.ts` (new file)
- Read-only access to all `src/modules/governor/*.ts` (for type imports only)

**Forbidden files**:
- ALL production source files (no modifications)
- `tests/token-issuer.test.ts` (owned by 101)
- `tests/build-queue.test.ts` (owned by 101)
- `tests/policy-engine.test.ts` (owned by 102)
- `tests/audit-log.test.ts` (owned by 102)
- `tests/security-audit.test.ts` (existing, do not modify)

**Success invariants**:
- All adversarial tests pass against the hardened code from 101+102
- No test requires modification of production code
- At least 10 adversarial test cases
- Tests cover all 8 identified invariant gaps

---

#### 8A-104: Runtime Integration
| Field | Value |
|---|---|
| Class | backend |
| Budget | 4-6 min |
| Ceiling | 8 min |
| Role | builder |
| Depends on | 101, 102 |

**Goal**: Wire hardened invariants into the governor plugin and add integration tests.

**Work**:
- Register new invariant in governor-plugin.ts: `governor.token-state-consistency` (consumed ∧ revoked ⟹ false)
- Wire `autoExpire()` into plugin lifecycle (if 101 separated it from validate)
- Add integration tests: full plugin lifecycle with token → task → complete → audit verification
- Add integration test: token expiration during execution with graceful degradation
- Verify all registered invariants pass after full lifecycle

**Allowed files**:
- `src/modules/governor/governor-plugin.ts`
- `tests/governor-integration.test.ts` (new file)

**Forbidden files**:
- `src/modules/governor/token-issuer.ts` (owned by 101)
- `src/modules/governor/build-queue.ts` (owned by 101)
- `src/modules/governor/policy-engine.ts` (owned by 102)
- `src/modules/governor/audit-log.ts` (owned by 102)
- `src/core/*`
- `src/adapters/*`
- All other `src/modules/*`

**Success invariants**:
- New invariant `governor.token-state-consistency` registered and passes
- Integration tests cover full lifecycle (init → token → task → complete → destroy)
- No existing integration paths are broken
- Build and all tests remain green

---

### Tail

#### 8A-201: Verifier Checklist
| Field | Value |
|---|---|
| Role | verifier |
| Depends on | 101, 102, 103, 104 |

**Checklist**:
1. [ ] Invariant behavior matches this frozen contract
2. [ ] Boundary validation is stricter, not just different
3. [ ] Adversarial tests exist and pass (≥10 cases)
4. [ ] Integration tests cover the hardened seam
5. [ ] No packet exceeded its allowed file surface
6. [ ] No undeclared files were touched
7. [ ] No reopen/amend churn unless lawfully recorded
8. [ ] Build passes: `npm run build`
9. [ ] All tests pass: `npm test`
10. [ ] Existing 295 tests remain green (no regressions)
11. [ ] Packet durations stayed within or near class budgets
12. [ ] Fitness score computed successfully

---

#### 8A-301: Integrator
| Field | Value |
|---|---|
| Role | integrator |
| Depends on | 201 |

Merge all packet branches, resolve any conflicts, verify build + full test suite.

---

#### 8A-401: Knowledge / Postmortem
| Field | Value |
|---|---|
| Role | knowledge |
| Depends on | 301 |

Record:
- Fitness score and grade
- Per-packet timing profile
- Operator overhead (time spent on gates, merges, decisions)
- Merge friction (conflicts, manual interventions)
- Single-Claude comparison judgment
- Doctrine deltas for Phase 8D

---

## Scoring Expectations

| Bucket | Prediction | Reasoning |
|---|---|---|
| Quality (40) | 35-38 | Clean parallel leaves, strong safety net, real but bounded work |
| Lawfulness (25) | 22-25 | No shared seam files, clean ownership, lawful transitions |
| Collaboration (20) | 16-18 | Low rescue expected, clean merges, useful writebacks |
| Velocity (15) | 10-13 | Budget packets, normalized by class |
| **Overall** | **83-94** | **Predicted: A (borderline B+)** |

### Grade criteria (explicit)

**Call 8A an A only if**:
- Run score lands in A range (≥85)
- No manual merge surgery needed
- Operator overhead stays under 15 minutes
- Wave 1 and Wave 2 packets stay within or near budget
- Single-Claude comparison is honestly "multi-claude wins"

**Call it a B if**:
- Ships cleanly but needs noticeable operator glue
- OR one packet significantly exceeds budget
- OR merge requires nontrivial intervention

**Call it a C or below if**:
- Multiple packets exceed ceiling
- OR manual rescue required
- OR verifier finds scope violations

---

## Single-Claude Comparison Rubric

**Multi-claude win if**:
- Parallel wall-time savings exceed operator overhead by a meaningful margin
- Verifier/integrator independence adds real value (catches something a single session would miss)
- Merge friction stays low
- Packet scores mature cleanly

**Neutral if**:
- Work ships cleanly but coordination roughly cancels the time gain

**Loss if**:
- A single Claude likely would have completed faster with less ceremony and no reduction in quality risk

---

## Forbidden Cross-Ownership Rule

**No packet may own both core law and shared integration seams.**

Specifically:
- 101 owns token-issuer + build-queue (core law) — forbidden from governor-plugin (integration)
- 102 owns policy-engine + audit-log (boundary law) — forbidden from governor-plugin (integration)
- 103 owns ONLY test files — forbidden from ALL production code
- 104 owns governor-plugin (integration) — forbidden from core law files

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Seam too narrow, packets finish in 2 min and velocity looks suspiciously fast | Accept honest fast completion — this is backend law work, not UI |
| 101 changes types.ts in a way that breaks 102 | types.ts changes are type-only; 102 uses type additions, not modifications |
| 103 adversarial tests reveal bugs in 101/102 code | This is the POINT — verifier should catch, reopen is lawful |
| Governor-plugin wiring in 104 depends on 101's exact API | 104 depends on 101+102, waits for Wave 1 |
| Operator distracted during merge gate | Keep operator overhead log, accept the time cost honestly |
