# 10C Synthesis — Trial Findings

## Trial Results Summary

| Trial | Repo | Coupling | Packets | Outcome | Verdict | Eligibility |
|-------|------|----------|---------|---------|---------|-------------|
| A | Claude Guardian | Low | 5 | clean_success | review_ready | promotable |
| B | StudioFlow | Medium | 6 | assisted_success | review_ready_with_notes | promotable_with_notes |
| C | Claude RPG | High | 8 | partial_success / stopped | not_review_ready / incomplete | not_promotable / ineligible |

## What Held

### 1. Promotion conservatism scales correctly with coupling
Low coupling → clean promotion. Medium coupling with retry → promotion with notes.
High coupling with failure → correctly blocked.

The system never over-promoted. It never marked a failed run as review-ready.
**This is the most important finding.**

### 2. Handoff completeness survives coupling pressure
All three trials produced contribution lists matching packet count.
Failed contributions are honestly flagged with `contributesToResult: false`.
Intervention digests scale linearly with actual intervention count (0 → 1 → 3+).

Reviewers do not need raw DB access. The handoff artifact contains the decision-relevant information.

### 3. Approval binding is trustworthy
Fingerprints are stable: same input always produces same fingerprint.
Different trials produce different fingerprints.
Non-material changes (generatedAt) do not change the fingerprint.
Material changes (outcome status, verdict, contribution counts) do change it.

Approval binds to specific evidence and does not silently float.

### 4. Invalidation fires proportionally
- Non-material change → valid (all trials)
- Outcome status change → invalidated (all trials)
- Verdict change → invalidated
- Post-approval intervention → invalidated
- New blocker → invalidated

No over-triggering on non-material changes. No under-triggering on material ones.

### 5. Recovery-to-approval path works
Medium-coupling run with retry + gate approval → promotable_with_notes.
The system correctly distinguishes "needed help but landed" from "failed."

High-coupling partial failure → correctly blocked from promotion.
Stopped run → correctly ineligible.

### 6. Rendering stability across coupling levels
All outcome, handoff, and promotion check renders produce stable output without errors across all trial variants. JSON roundtrips cleanly.

## What Needs Attention

### Contribution ambiguity in high-coupling runs
In Trial C, the director-render packet failed while touching shared state (game-state.ts).
The contribution summary correctly marks it as non-contributing, but the handoff does not
explicitly flag *which other packets' contributions may be affected* by the shared-state overlap.

**Recommendation:** Future phase could add a "semantic overlap risk" annotation to contributions
when packets share file ownership. Not blocking — the system correctly refuses promotion.

### Gate state and hook interaction
Trial C has a pending gate + pending hook. The system correctly identifies this as blocking,
but the outstanding issues list doesn't strongly differentiate "pending because of failure
upstream" vs "pending because it's the operator's turn."

**Recommendation:** Consider enriching OutstandingIssue with a `cause` field in a future phase.

### review_ready_with_notes policy
The current policy allows promotion_with_notes for any review_ready_with_notes handoff.
In Trial B, the notes correctly surface the retry and gate approval.

However, the system does not distinguish between "1 minor retry" and "5 retries + 3 gate approvals."
Both would get promotable_with_notes.

**Recommendation:** Consider a note-severity threshold in a future phase. Not critical now —
the notes themselves carry the information, and the human approver sees them.

## Doctrine Findings

### Confirmed Doctrine

| Rule | Status | Evidence |
|------|--------|----------|
| Multi-claude works best when packet count amortizes overhead | Confirmed | Trial A (5 packets, clean) vs Trial C (8 packets, still valuable despite failure) |
| Clean file ownership reduces intervention frequency | Confirmed | Trial A: 0 interventions. Trial C: 3+ interventions |
| Handoff must be stricter than outcome | Confirmed | assisted_success → review_ready_with_notes, not review_ready |
| Recovered ≠ resolved | Confirmed | Disjoint counting preserved across all trials |
| Approval must bind to frozen evidence | Confirmed | Fingerprint binding prevents silent floating |

### New Doctrine

| Rule | Source | Implication |
|------|--------|------------|
| Promotion conservatism should be proportional to coupling | Trial spread | The system already does this naturally via handoff verdicts |
| Non-material changes must never invalidate approval | All trials | generatedAt, rendering format, etc. are excluded from fingerprint — correct |
| A run that needed recovery can still be legitimately promoted | Trial B | recovery + success → promotable_with_notes, not blocked |
| High-coupling failure should be conservative, not blocked | Trial C | The system refuses promotion but provides actionable follow-up |

### No Doctrine Changes Required
The existing doctrine from Phases 8–10B held under all three coupling profiles.
No false positives, no false negatives in promotion or invalidation.

## Scores

### Trial A — Claude Guardian
| Metric | Score |
|--------|-------|
| Promotion correctness | pass |
| Approval binding | pass |
| Invalidation accuracy | pass |
| Handoff completeness | pass |
| Evidence grounding | pass |
| Recovery guidance | n/a (no recovery needed) |

### Trial B — StudioFlow
| Metric | Score |
|--------|-------|
| Promotion correctness | pass |
| Approval binding | pass |
| Invalidation accuracy | pass |
| Handoff completeness | pass |
| Evidence grounding | pass |
| Recovery guidance | pass |

### Trial C — Claude RPG
| Metric | Score |
|--------|-------|
| Promotion correctness | pass |
| Approval binding | pass |
| Invalidation accuracy | pass |
| Handoff completeness | pass (marginal on overlap annotation) |
| Evidence grounding | pass |
| Recovery guidance | pass |

### Friction Counts (across all trials)
| Metric | Count |
|--------|-------|
| Raw DB inspections needed | 0 |
| Refusal reasons not actionable | 0 |
| Invalidations too strict | 0 |
| Invalidations too weak | 0 |
| Contribution summaries ambiguous | 1 (Trial C shared-state overlap) |

## Conclusion

**10C passes all criteria.**

The full 9A–10B chain works across low, medium, and high coupling.
Promotion, handoff, and invalidation behave correctly under pressure.
No doctrine changes required — the existing law held.

Two minor improvement opportunities identified (overlap annotation, note severity threshold)
for future phases. Neither blocks the current product.

Control Plane v1 + Delivery Spine + Approval Gate is validated.
