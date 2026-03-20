# 9B-000 — Live Run Console — Contract Freeze

**Phase:** 9B
**Objective:** Make an active run legible in real time without creating any new execution truth outside the CLI/DB law engine.
**Class:** Backend/state (strongest fit)
**Predicted fit:** A- to A

## Critical Product Rule

9B is a **window into law, not a second control plane.**

The console reads from existing DB truth. It does not:
- Create new state tables
- Store console-specific metadata
- Bypass the law engine for any operation
- Duplicate truth from existing tables

## Read Model Sources

| Source | Tables | What it provides |
|--------|--------|-----------------|
| Run state | `auto_runs`, `auto_run_workers`, `features` | Run/wave/worker status |
| Packet graph | `packets`, `packet_dependencies` | Node/edge structure, blocked/runnable |
| Sessions | `packet_attempts`, `claims` | Active workers, elapsed time, retries |
| Hook decisions | `hook_decisions` | Event stream, rule matches, approvals |
| Fitness | `run_scores`, `packet_scores` | Live scoring, maturation, penalties |
| Evidence | `verification_results`, `packet_submissions`, `integration_runs` | Verdicts, reports, reconcile |
| State history | `state_transition_log` | Full transition audit trail |
| Plans | `run_plans`, `run_blueprints` | Predicted fit, template selection |

## Panes

### Pane A — Run Overview
- Run ID, repo, work class, predicted fit, current grade trajectory
- Active wave / total waves
- **Next lawful action** (the single most important field)
- Packets: total / merged / failed / blocked / in-progress

### Pane B — Packet Graph
- Nodes by wave with status indicators
- Dependency edges (hard/soft)
- Current owner/role per packet
- Verifier/integrator tail status
- Gate markers (human gates pending)

### Pane C — Worker Sessions
- Active and recent sessions with elapsed time
- Worktree path, branch name
- Model/tool profile
- Stop/retry state, attempt number
- Envelope summary (if available)

### Pane D — Hooks + Gates
- Recent hook events (newest first)
- Decision: rule matched, action, mode (advisory/autonomous)
- Human approvals waiting (operator_decision = 'pending')
- Unresolved decisions count

### Pane E — Fitness + Evidence
- Live run score (quality/lawfulness/collaboration/velocity)
- Packet maturation (submitted → verified → integrated)
- Penalties applied
- Verifier/integrator findings
- Reconciliation verdicts

## Allowed Actions (Law-Preserving Only)

If exposed, actions must call existing lawful commands:
- `auto stop` → stop run
- `claim` → retry packet
- `approve` → approve gate
- `hooks resolve` → resolve hook decision

No direct state mutation. No shadow controls.

## Packet Graph

### Wave 1 — Read Model Spine
| Packet | File | Responsibility |
|--------|------|----------------|
| 9B-101 | `src/console/run-model.ts` | Aggregate run/packet/session/gate state |
| 9B-102 | `src/console/hook-feed.ts` | Queryable event stream for hook decisions |
| 9B-103 | `src/console/fitness-view.ts` | Surface run/packet maturation for active runs |

### Wave 2 — Console Rendering + CLI
| Packet | File | Responsibility |
|--------|------|----------------|
| 9B-201 | `src/console/render.ts` | Terminal-formatted rendering for all panes |
| 9B-202 | `src/console/next-action.ts` | "Next lawful action" computation |
| 9B-203 | `src/commands/console.ts` | CLI surface: `multi-claude console` |

### Tail
| Packet | Responsibility |
|--------|----------------|
| 9B-301 | Verifier — cross-pane consistency, data freshness |
| 9B-401 | Integrator — wire into bin/multi-claude.ts, test end-to-end |

## File Ownership

| Packet | Owns | References (read-only) |
|--------|------|----------------------|
| 9B-101 | `src/console/run-model.ts`, `test/console/run-model.test.ts` | `src/db/`, schema.sql |
| 9B-102 | `src/console/hook-feed.ts`, `test/console/hook-feed.test.ts` | `src/hooks/engine.ts` |
| 9B-103 | `src/console/fitness-view.ts`, `test/console/fitness-view.test.ts` | `src/fitness/` |
| 9B-201 | `src/console/render.ts`, `test/console/render.test.ts` | 101, 102, 103 outputs |
| 9B-202 | `src/console/next-action.ts`, `test/console/next-action.test.ts` | 101, 102 outputs |
| 9B-203 | `src/commands/console.ts`, `test/commands/console.test.ts` | 201, 202 |

Zero file overlap between packets.

## What "Live" Means

- `multi-claude console` renders current DB state once and exits
- `multi-claude console --watch` polls at 2-second intervals
- No WebSocket, no streaming, no daemon
- Freshness = DB write latency (milliseconds)

## What NOT to Build

- Dashboard cosmetics or charts
- Analytics theater
- A second orchestration engine
- Freeform packet editing mid-run
- "Chat with the run" features
- Deep historical reporting (that's a future phase)

## Success Criteria

1. `multi-claude console --run <id>` shows all 5 panes from DB truth
2. "Next lawful action" field is always correct
3. 0 new DB tables — pure read aggregation
4. All tests pass, total > 350
5. `--watch` mode refreshes without flicker
