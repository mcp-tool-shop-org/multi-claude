---
title: Getting Started
description: Install Multi-Claude and run your first parallel build.
sidebar:
  order: 1
---

## Prerequisites

- **Node.js 20+** — Multi-Claude uses ES modules and modern Node APIs
- **Claude Code CLI** — Workers are Claude Code sessions, so the CLI must be installed and authenticated
- **A stable codebase** — The repo floor should be stable (build/test passing, deps resolved)

## Install

```bash
npm install -g @multi-claude/cli
```

Verify the installation:

```bash
multi-claude --version
multi-claude --help
```

## Your First Run

### 1. Assess fitness

Before committing to a parallel run, check whether the work fits:

```bash
multi-claude plan evaluate \
  --work-class backend_law \
  --packets 6 \
  --coupling low
```

The fitness engine uses evidence from scored trials to recommend whether multi-claude is appropriate. A "strong fit" at 3+ packets for backend work means go. A "moderate fit" at 5+ packets for UI work means proceed with caution.

### 2. Create and freeze a blueprint

```bash
multi-claude blueprint init --template backend_law
multi-claude blueprint validate
multi-claude blueprint freeze
```

The blueprint defines the packet graph: which packets exist, their file ownership, dependency edges, wave structure, and verification gates. Once frozen (SHA-256 hashed), it's immutable.

### 3. Start the run

```bash
multi-claude run
```

Workers claim packets and begin execution. Watch progress in real-time:

```bash
multi-claude console watch
```

### 4. Check next action

```bash
multi-claude console next
```

The next-action engine computes the highest-priority operator action from a 10-level priority cascade. It might tell you to approve a gate, resolve a hook, or just wait.

### 5. Generate handoff evidence

When the run completes:

```bash
multi-claude console outcome
multi-claude console handoff
multi-claude console export handoff --format markdown
```

This produces a review-ready brief with verdict, contributions, interventions, outstanding issues, and evidence references.

## What's Next

- [Planning](/mcf/handbook/planning/) — Deep dive into fitness assessment and blueprint design
- [Console Reference](/mcf/handbook/console/) — All 18 console sub-commands explained
