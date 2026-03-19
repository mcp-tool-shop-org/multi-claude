# Trial [A/B/C] — [Repo Name]

## Pre-Trial Framing

| Field | Value |
|-------|-------|
| Repo | |
| GitHub | |
| Task type | |
| Why chosen | |
| Coupling class | |
| Expected packets | |
| Expected review complexity | |

## Fitness Assessment

```
multi-claude plan evaluate --work-class <class> --packet-count <n> --coupling <level> --ownership <level>
```

**Result:** [fit / marginal / unfit]
**Anti-patterns detected:** [list or none]

## Blueprint

| Field | Value |
|-------|-------|
| Template | |
| Packets | |
| Waves | |
| Gates | |
| Blueprint hash | |

## Run Execution

### Run Summary
| Field | Value |
|-------|-------|
| Run ID | |
| Duration | |
| Final status | |
| Interventions | |

### Packet Outcomes
| Packet | Role | Status | Retried | Contributed |
|--------|------|--------|---------|-------------|

### Interventions (if any)
| Action | Target | Reason | Result |
|--------|--------|--------|--------|

### Recovery (if needed)
| Scenario | Severity | Steps taken | Unlocked |
|----------|----------|-------------|----------|

## Outcome

```
multi-claude console outcome --json
```

| Field | Value |
|-------|-------|
| Status | |
| Acceptable | |
| Resolved | |
| Failed | |
| Recovered | |
| Unresolved | |

## Handoff

```
multi-claude console handoff --json
```

| Field | Value |
|-------|-------|
| Verdict | |
| Review readiness | |
| Landed contributions | |
| Outstanding issues | |
| Follow-up | |
| Has change evidence | |

## Promotion Check

```
multi-claude console promote-check --json
```

| Field | Value |
|-------|-------|
| Eligibility | |
| Blockers | |
| Notes | |
| Fingerprint | |

## Approval Decision

| Field | Value |
|-------|-------|
| Decision | |
| Approver | |
| Reason | |
| Binding fingerprint | |

## Post-Approval Mutation

### Change Introduced
[Describe the follow-on change]

### Invalidation Check
| Field | Value |
|-------|-------|
| Still valid? | |
| Invalidation reasons | |
| Expected behavior | |
| Actual behavior | |
| Correct? | |

### Re-Promotion (if applicable)
| Field | Value |
|-------|-------|
| New eligibility | |
| New fingerprint | |
| Outcome | |

## Findings

### Where the law helped
-

### Where the law was too strict
-

### Where the law was too weak
-

### Where reviewers needed extra context
-

### Approval/invalidation accuracy
-

## Scores

| Metric | Score | Notes |
|--------|-------|-------|
| Promotion correctness | pass / marginal / fail | |
| Approval binding | pass / marginal / fail | |
| Invalidation accuracy | pass / marginal / fail | |
| Handoff completeness | pass / marginal / fail | |
| Evidence grounding | pass / marginal / fail | |
| Recovery guidance | pass / marginal / fail | |

### Friction Counts
| Metric | Count |
|--------|-------|
| Raw DB inspections needed | |
| Refusal reasons not actionable | |
| Invalidations too strict | |
| Invalidations too weak | |
| Contribution summaries ambiguous | |
