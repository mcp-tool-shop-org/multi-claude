<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/multi-claude/readme.png" width="400" alt="Multi-Claude" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/actions"><img src="https://github.com/mcp-tool-shop-org/multi-claude/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mcp-tool-shop-org/multi-claude/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/multi-claude/"><img src="https://img.shields.io/badge/docs-landing%20page-blue" alt="Landing Page" /></a>
</p>

Lane-based parallel build system for [Claude Code](https://claude.ai/). Orchestrates multiple Claude sessions working on the same codebase — with dependency resolution, file ownership, operator intervention, and evidence-bound handoff.

## What It Does

Multi-Claude turns a single large task into a **packet graph** — small, independently claimable units of work with explicit file ownership and dependency edges. Multiple Claude Code sessions execute packets in parallel waves, while an operator observes, intervenes, and approves through a unified control plane.

**The operator loop:**

1. **Plan** — Assess fitness, generate blueprint, freeze contract
2. **Execute** — Workers claim packets, produce artifacts, verify output
3. **Observe** — Live 5-pane console shows run state, hooks, fitness
4. **Intervene** — Stop runs, retry packets, resolve hooks, approve gates
5. **Recover** — Guided recovery flows for 8 failure scenarios
6. **Close** — Outcome derivation, handoff evidence, promotion/approval

## Install

```bash
npm install -g @multi-claude/cli
```

Requires Node.js 20+ and [Claude Code](https://claude.ai/) CLI installed.

## Quick Start

```bash
# Assess whether a task fits multi-claude
multi-claude plan evaluate --work-class backend_law --packets 6 --coupling low

# Initialize a blueprint from a template
multi-claude blueprint init --template backend_law

# Validate and freeze the blueprint
multi-claude blueprint validate
multi-claude blueprint freeze

# Start a run
multi-claude run

# Watch execution in real-time
multi-claude console watch

# Check what to do next
multi-claude console next

# Generate handoff evidence when done
multi-claude console handoff

# Export for review
multi-claude console export handoff --format markdown
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `multi-claude plan evaluate` | Assess fitness from work class, packet count, coupling |
| `multi-claude blueprint init` | Generate packet graph from template |
| `multi-claude blueprint validate` | Check legality (file overlap, deps, gates) |
| `multi-claude blueprint freeze` | SHA-256 hash, immutable after freeze |
| `multi-claude run` | Start execution |
| `multi-claude resume` | Resume a stopped run |
| `multi-claude stop` | Stop a run |
| `multi-claude status` | Show run status |

### Console (18 sub-commands)

| Command | Description |
|---------|-------------|
| `console show` | Full 5-pane operator console |
| `console overview` | Run summary |
| `console packets` | Packet states and progress |
| `console workers` | Worker sessions |
| `console hooks` | Hook decision feed |
| `console fitness` | Run/packet maturation scores |
| `console next` | Next lawful action (10-level priority) |
| `console watch` | Auto-refresh at 2s intervals |
| `console actions` | Available operator actions |
| `console act` | Execute an operator action |
| `console audit` | Audit trail |
| `console recover` | Guided recovery flows |
| `console outcome` | Run outcome derivation |
| `console handoff` | Handoff evidence brief |
| `console promote-check` | Promotion eligibility |
| `console approve` | Record approval |
| `console reject` | Record rejection |
| `console approval` | Approval status |
| `console export` | Export handoff/approval/gate as markdown or JSON |

### Monitor (Control Plane UI)

```bash
multi-claude monitor --port 3100
```

Opens a React-based operator dashboard at `http://localhost:3100` with:
- **Overview** — system health, lane utilization, active trials
- **Queue** — sortable item list with inline actions
- **Item Detail** — situation banner (state/risk/next move), decision workbench, collapsible proof
- **Lane Health** — per-lane metrics, interventions, policy inputs
- **Activity** — real-time event timeline

## Architecture

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
│  Execution → Transfer → Decision → Triage →     │
│  Supervision → Routing → Flow → Intervention →  │
│  Governance → Outcome → Calibration → Promotion │
├─────────────────────────────────────────────────┤
│          SQLite Execution Database              │
│        (19+ tables, local .multi-claude/)       │
├─────────────────────────────────────────────────┤
│         Claude Agent SDK (worker sessions)       │
└─────────────────────────────────────────────────┘
```

## When to Use Multi-Claude

Multi-Claude works best when **packet count is high enough to amortize coordination overhead** and **file ownership is clean enough to keep semantic reconciliation bounded.**

| Work Class | Fit | Break-even |
|------------|-----|------------|
| Backend/state/domain | Strong | ~3 packets |
| UI/interaction/seam-heavy | Moderate | ~5 packets |
| Control-plane/infra | Moderate | ~5-6 packets |

**Use it when:** 5+ packets, clear file ownership, natural wave structure, independent verification matters.

**Stay single-Claude when:** Scaffold/unstable architecture, 2 or fewer packets, mostly sequential critical path, operator would become bottleneck.

See [WHEN-TO-USE-MULTI-CLAUDE.md](WHEN-TO-USE-MULTI-CLAUDE.md) for the full decision rubric with evidence from scored trials.

## Security

Multi-Claude is a **local-only CLI tool**. It orchestrates Claude Code sessions on a single developer machine.

- **Touches:** Local filesystem (working directory + `.multi-claude/`), SQLite database, Claude Code subprocesses, localhost (monitor only)
- **Does NOT touch:** Cloud APIs directly, no telemetry, no credential storage, no network egress beyond localhost
- **Permissions:** File operations constrained to project directory, monitor binds to localhost only, hook policies execute existing CLI commands only, operator actions go through canonical law modules

See [SECURITY.md](SECURITY.md) for the full security policy and vulnerability reporting.

## Testing

```bash
npm test          # 1600+ tests via Vitest
npm run typecheck # TypeScript strict mode
npm run verify    # typecheck + test + build
```

## Platforms

- **OS:** Windows, macOS, Linux
- **Runtime:** Node.js 20+
- **Dependencies:** Claude Code CLI, better-sqlite3, Commander, Express

## License

[MIT](LICENSE)

---

Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
