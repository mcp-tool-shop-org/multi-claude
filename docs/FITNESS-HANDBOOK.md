# Factory Fitness Handbook

## What this system measures

Factory fitness scores **runs** (team outcome), not individual workers.
The goal is to measure whether the factory produces durable, integrated progress — not whether anyone was fast.

## Score breakdown

Every run is scored out of 100 across four buckets:

| Bucket | Weight | What it rewards |
|---|---|---|
| **Quality** | 40 | Work that survives verification and integration |
| **Lawfulness** | 25 | Correct transitions, envelopes, artifacts |
| **Collaboration** | 20 | Low rescue, clean merges, useful handoffs |
| **Velocity** | 15 | Efficient use of time (normalized by packet class) |

## Grade scale

| Grade | Score |
|---|---|
| A | 85-100 |
| B | 70-84 |
| C | 55-69 |
| D | 40-54 |
| F | 0-39 |

## Why velocity is only 15%

Speed is the smallest bucket because fast sloppy work is worse than slower clean work.
A packet that submits in 2 minutes but fails verification and requires reopening will score worse than a packet that takes 6 minutes but integrates cleanly.

## Point maturation (anti-rush)

Points unlock in stages:

| Stage | Credit | When |
|---|---|---|
| Submit | 20% | Artifacts produced |
| Verify | 30% | Independent verification passes |
| Integrate | 50% | Work survives integration |

This means:
- A packet that only submits earns 20 points
- A packet that submits and verifies earns 50 points
- A packet that submits, verifies, and integrates earns 100 points

**Rushing to submit earns almost nothing. Surviving integration earns everything.**

## Packet classes

Packets are judged against their class budget, not a universal standard:

| Class | Budget | Ceiling |
|---|---|---|
| state/domain | 2-5 min | 6 min |
| backend | 2-6 min | 8 min |
| UI component | 3-6 min | 8 min |
| UI interaction | 3-8 min | 10 min |
| verification | 5-10 min | 12 min |
| integration | 5-10 min | 12 min |
| docs/knowledge | 2-5 min | 6 min |

A UI packet that takes 7 minutes is fine. A state packet that takes 7 minutes is over budget.

## Penalties

### Hard penalties (large deductions)
- Build/CI failure at integration: -8
- Forbidden file touch: -6
- Failed reconciliation: -5
- Undeclared file touch: -4
- Unlawful state transition: -4
- Invalid artifact schema: -3
- Broken stop/retry path: -3
- Orphaned worktree: -2

### Soft penalties (smaller deductions)
- Reopen required: -2
- Manual operator rescue: -2
- Amendment required: -1
- Seam fix in integration: -1
- Oversized packet: -1
- Weak writeback: -1

## How to interpret scores

### `multi-claude fitness score --run <id> --feature <id>`
Shows the run score with grade, bucket breakdown, and packet list.

### `multi-claude fitness explain --run <id>`
Shows the full evidence trail: how each bucket was computed, what penalties applied, and per-packet maturation stages.

### `multi-claude fitness metrics`
Shows all 19 registered metrics with their weights, formulas, and gaming risks.

## What behaviors are rewarded

1. **Clean verification** — packets that pass on first try
2. **Clean integration** — no seam conflicts, no manual rescue
3. **Correct artifacts** — valid schema, honest file declarations
4. **Useful writebacks** — knowledge that helps future runs
5. **Appropriate sizing** — packets within class budget

## What behaviors are penalized

1. **Rushing without quality** — fast submission with verification failure
2. **Scope violations** — touching forbidden or undeclared files
3. **Operator dependency** — requiring manual rescue or intervention
4. **Merge friction** — creating conflicts that integrator must resolve
5. **Oversized packets** — exceeding class duration ceiling

## What this system does NOT do

- No individual worker leaderboard
- No reward for raw packet count
- No reward for "looking busy"
- No reward for heroic last-minute saves
- No speed-only optimization

The system rewards the team for producing work that survives contact with reality.
