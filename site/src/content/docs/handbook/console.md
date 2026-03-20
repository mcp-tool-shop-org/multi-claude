---
title: Console Reference
description: All 18 console sub-commands for observing, intervening, and closing runs.
sidebar:
  order: 3
---

The console is your window into a running (or completed) multi-claude execution. All commands read from the SQLite execution database — they never mutate state unless explicitly designed to (actions, approve/reject).

## Observation Commands

### `console show`
Full 5-pane operator console in a single view: overview, packets, workers, hooks, fitness.

### `console overview`
Run summary: status, packet counts, worker counts, elapsed time.

### `console packets`
Per-packet state: status, assigned worker, dependencies, verification result.

### `console workers`
Worker sessions: status, claimed packet, session duration, output.

### `console hooks`
Hook decision feed: event type, policy rule matched, action taken, timestamp. Supports filtering by event type and time range.

### `console fitness`
Run and per-packet maturation scores. Shows evidence from 3 sources (output, verification, timing), stale detection, and overall fitness grade.

### `console next`
**Next lawful action** — the single most important thing the operator should do. Computed from a 10-level priority cascade:

1. Critical failure requiring immediate stop
2. Hook requiring manual resolution
3. Gate requiring approval
4. Packet ready for retry after failure
5. Worker idle with claimable packets
6. Stalled packet detection
7. Wave completion checkpoint
8. Fitness degradation warning
9. Run completion actions
10. Nothing — wait

```bash
multi-claude console next --json
```

### `console watch`
Auto-refreshing console at 2-second intervals. Shows the 5-pane view with live updates.

## Intervention Commands

### `console actions`
Lists all available operator actions for the current run state, with precondition checks showing which are possible and why others are blocked.

### `console act`
Executes an operator action. Available actions:

- **stop_run** — Gracefully stop the run
- **retry_packet** — Retry a failed packet
- **resume_run** — Resume a stopped run
- **approve_gate** — Approve a verification gate
- **resolve_hook** — Manually resolve a pending hook

Every action checks preconditions, executes the mutation, and records an audit entry.

### `console audit`
Full audit trail: every operator action with timestamp, actor, action, target, and result.

### `console recover`
Guided recovery flows for 8 known failure scenarios. Analyzes current run state, identifies the applicable recovery scenario, and provides ordered steps with legality checks.

## Closure Commands

### `console outcome`
Derives the run outcome from execution truth:

- **clean_success** — All packets resolved, no interventions
- **assisted_success** — All resolved, but interventions occurred
- **partial_success** — Some packets resolved, some failed
- **terminal_failure** — Critical failure, run cannot continue
- **stopped** — Operator stopped the run
- **in_progress** — Run still active

### `console handoff`
10-section operator handoff brief: verdict, run context, objective, outcome, contributions, interventions, issues, follow-ups, review readiness, evidence trail.

### `console promote-check`
Checks promotion eligibility based on handoff verdict and evidence state.

### `console approve` / `console reject`
Records approval or rejection. Approvals are fingerprint-locked — they bind to a specific version of the handoff evidence (SHA-256). If the evidence changes after approval, the approval is automatically invalidated.

### `console approval`
Shows current approval status, including invalidation state.

### `console export`
Exports artifacts in markdown or JSON:

```bash
multi-claude console export handoff --format markdown
multi-claude console export approval --format json
multi-claude console export gate
```

The gate export produces a CI-consumable JSON with stable machine fields (`schemaVersion: 1`).
