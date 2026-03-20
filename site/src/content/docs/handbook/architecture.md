---
title: Architecture
description: System design, the 12-law handoff spine, and the Control Plane Monitor.
sidebar:
  order: 4
---

## System Layers

```
┌─────────────────────────────────────────────────┐
│                   CLI (Commander)                │
├─────────────────────────────────────────────────┤
│  Planner    │  Console     │  Monitor (Express)  │
│  - rules    │  - run-model │  - queries          │
│  - blueprint│  - hook-feed │  - commands          │
│  - freeze   │  - fitness   │  - policies          │
│  - templates│  - next-act  │  - React UI          │
├─────────────────────────────────────────────────┤
│             Handoff Spine (12 Laws)             │
├─────────────────────────────────────────────────┤
│          SQLite Execution Database              │
│        (19+ tables, local .multi-claude/)       │
├─────────────────────────────────────────────────┤
│         Claude Agent SDK (worker sessions)       │
└─────────────────────────────────────────────────┘
```

### CLI Layer
Commander-based CLI with 26+ commands. Entry point for all operator interaction. Commands issue intents — they never mutate the database directly.

### Planner
Fitness assessment engine with doctrine from scored trials. Blueprint creation, validation, and freeze. Template registry for common work classes.

### Console
Read models that project execution truth into operator-facing views. 18 sub-commands covering observation, intervention, and closure. The next-action engine is the core decision support tool.

### Monitor
Express server serving a React 19 + Tailwind UI. Read-only queries project SQLite truth into 5 screens. Command endpoints accept operator intents and delegate to canonical law modules.

### Handoff Spine
The core subsystem. 12 laws govern the full lifecycle from execution through promotion.

### Execution Database
SQLite via better-sqlite3. 19+ tables covering runs, packets, workers, sessions, hooks, gates, approvals, audit entries, and the full handoff/decision/routing/supervision stack.

## The 12 Laws

The handoff spine implements 12 laws, each governing a specific domain of truth:

| # | Law | Domain |
|---|-----|--------|
| 1 | Execution | Run and packet lifecycle, worker assignment |
| 2 | Transfer | Handoff creation, evidence packaging, delivery |
| 3 | Decision | Brief rendering, decision actions, affordance gating |
| 4 | Triage | Priority classification, queue ordering |
| 5 | Supervision | Claim lifecycle, lease management, expiry |
| 6 | Routing | Lane assignment, target selection, route history |
| 7 | Flow | WIP caps, overflow detection, starvation monitoring |
| 8 | Intervention | Automated responses to health breaches |
| 9 | Governance | Policy sets, version management, activation |
| 10 | Outcome | Decision outcome recording, status derivation |
| 11 | Calibration | Quality scoring, metric collection |
| 12 | Promotion | Trial runs, A/B comparison, rollout/rollback |

Each law owns its own database tables and exposes a canonical API. Laws may read from other laws' tables but never write to them — all mutations go through the owning law.

## Control Plane Monitor

The monitor is a React-based operator UI served by Express:

```bash
multi-claude monitor --port 3100
```

### Screens

- **Overview** — System counts, lane health summary, active trials, recent activity
- **Queue** — Sortable item list with inline action menus (claim, release, defer, requeue, escalate)
- **Item Detail** — Situation banner (state/risk/next move), decision workbench, action panel, collapsible proof sections
- **Lane Health** — Per-lane metrics, WIP utilization, breach codes, interventions, policy inputs
- **Activity** — Real-time event timeline with source filtering

### Design Principles

The monitor follows an **operator-first** design:
1. What's happening now (situation, status)
2. Why it matters / what's blocked (risks, blockers)
3. What I can do next (actions, decisions)
4. What changed (timeline)
5. Proof behind the fold (IDs, routing, policy — collapsed by default)

Record-first surfaces (leading with IDs, lineage, tables) are explicitly excluded. The monitor serves a human running the system, not an auditor browsing records.
