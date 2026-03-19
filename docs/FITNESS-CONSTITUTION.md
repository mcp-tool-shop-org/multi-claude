# Factory Fitness Constitution

**Frozen: Phase 7-000**

This document is the scoring law. All fitness computation must derive from this constitution.
Changes require a law amendment with version bump.

## Scoring Philosophy

Reward work for surviving verification and integration cleanly, not for being produced quickly.

The primary scored unit is the **run** (team score), not the individual worker.
Role contributions and packet fitness are diagnostics, not competitive rankings.

## Score Buckets

| Bucket | Weight | What it measures |
|---|---|---|
| Quality | 40 | Did the work survive scrutiny and integration? |
| Lawfulness | 25 | Did the factory behave correctly? |
| Collaboration | 20 | Did the team work well together? |
| Velocity | 15 | Was time used efficiently? |

**Total: 100 points per run.**

Each bucket is computed as a percentage of its cap (e.g., Quality 36/40 = 90% quality).

## Point Maturation

Points unlock in stages. This is the anti-rush mechanism.

| Stage | Credit share | When |
|---|---|---|
| Submit | 20% | Packet submitted with valid artifacts |
| Verify | 30% | Packet passes independent verification |
| Integrate | 50% | Packet survives integration and lands in merged state |

A packet that submits fast but fails verification earns only 20% of its potential.
A packet that submits, verifies, and integrates cleanly earns 100%.

### Clawback rules
- Reopen after verification: lose verify credit, must re-earn
- Reopen after integration: lose integrate + verify credit
- Build/CI failure at integration: hard penalty on top of lost credit

## Packet Classes

Packets are normalized by class. A UI interaction packet is not judged by state/domain timing expectations.

| Class | ID | Duration budget | Duration ceiling |
|---|---|---|---|
| State/Domain | `state_domain` | 2-5 min | 6 min |
| Backend/Runtime | `backend` | 2-6 min | 8 min |
| UI Component | `ui_component` | 3-6 min | 8 min |
| UI Interaction | `ui_interaction` | 3-8 min | 10 min |
| Verification | `verification` | 5-10 min | 12 min |
| Integration | `integration` | 5-10 min | 12 min |
| Docs/Knowledge | `docs_knowledge` | 2-5 min | 6 min |
| Proof/Control | `proof_control` | 1-5 min | 8 min |

Duration score = 1.0 if within budget, linear decay to 0.0 at 2x ceiling, 0.0 beyond.

## Penalties

### Hard penalties (large deductions)

| Penalty | Points | Source |
|---|---|---|
| Build/CI failure at integration | -8 | integration_runs |
| Forbidden file touch | -6 | reconciliation |
| Undeclared file touch | -4 | reconciliation |
| Invalid artifact schema | -3 | submission validation |
| Failed reconciliation | -5 | reconciliation |
| Unlawful state transition | -4 | state_transition_log |
| Orphaned worktree | -2 | cleanup audit |
| Broken stop/retry path | -3 | runtime envelope |

### Soft penalties (smaller deductions)

| Penalty | Points | Source |
|---|---|---|
| Amendment required | -1 | packet_amendments |
| Reopen required | -2 | packet state transitions |
| Manual operator rescue | -2 | operator intervention log |
| Seam fix in integration | -1 | integrator notes |
| Oversized packet (> ceiling) | -1 | runtime duration |
| Weak writeback | -1 | knowledge promotion quality |
| Excessive operator intervention | -1 per event | manual intervention count |

## Quality Metrics (40 points)

| Metric | Weight | Formula | Source |
|---|---|---|---|
| Verified completion rate | 12 | verified_packets / total_packets | packet status |
| Integration success rate | 10 | integrated_packets / verified_packets | integration_runs |
| Build/test pass rate | 8 | passing_builds / total_builds | verification results |
| Reopen rate | 5 | 1 - (reopened / total) | state transitions |
| Reconciliation pass rate | 5 | clean_reconcile / total_reconcile | reconciliation verdicts |

## Lawfulness Metrics (25 points)

| Metric | Weight | Formula | Source |
|---|---|---|---|
| Transition compliance | 8 | lawful_transitions / total_transitions | state_transition_log |
| Envelope completeness | 6 | complete_envelopes / total_sessions | runtime_envelopes |
| Stop/retry correctness | 4 | correct_stops / total_stops | runtime envelopes |
| Hook logging coverage | 4 | logged_decisions / expected_decisions | hook_decisions |
| Artifact validity | 3 | valid_artifacts / total_submissions | submission validation |

## Collaboration Metrics (20 points)

| Metric | Weight | Formula | Source |
|---|---|---|---|
| Manual rescue rate | 6 | 1 - (rescues / total_packets) | operator interventions |
| Merge friction | 5 | 1 - (conflicts / total_packets) | integration notes |
| Downstream success | 4 | clean_handoffs / total_handoffs | packet dependency chains |
| Verifier useful-find rate | 3 | real_finds / total_checks | verification results |
| Knowledge reuse | 2 | promotions_reused / promotions_made | knowledge_promotions |

## Velocity Metrics (15 points)

| Metric | Weight | Formula | Source |
|---|---|---|---|
| Duration vs budget | 6 | avg(class_normalized_duration_score) | runtime envelopes |
| Time to verified | 4 | 1 - (avg_verify_time / max_expected) | timestamps |
| Time to integrated | 3 | 1 - (avg_integrate_time / max_expected) | timestamps |
| Queue latency | 2 | 1 - (avg_wait_time / max_expected) | claim timestamps |

## Run Grade Scale

| Grade | Score range |
|---|---|
| A | 85-100 |
| B | 70-84 |
| C | 55-69 |
| D | 40-54 |
| F | 0-39 |

## Anti-Gaming Rules

1. **No public individual leaderboard.** Team/run score is the primary display.
2. **Speed alone cannot earn most points.** Integration survival unlocks 50% of credit.
3. **Packet classes are normalized.** UI and state packets have different budgets.
4. **Rescue is not heroism.** Preventing chaos scores better than cleaning it up.
5. **Scores must be explainable.** Every score has an evidence trail via `fitness explain`.
6. **Rolling averages, not single-run spikes.** Trends matter more than peaks.
7. **Mature points after soak.** Most credit unlocks at integration, not submission.

## Explainability Requirement

Every score output must support:
- `fitness explain <run-id>` — shows bucket breakdown, metric values, penalties, evidence refs
- `fitness explain <packet-id>` — shows maturation stage, class-normalized duration, penalties

If a score cannot be explained by evidence, it is a bug.

## Constitution Version

**v1.0.0** — Frozen at Phase 7-000.

Changes require:
- Human proposal
- Version bump
- Documented rationale
