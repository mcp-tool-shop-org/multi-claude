---
title: Multi-Claude Handbook
description: Operator handbook for the Multi-Claude parallel build system.
sidebar:
  order: 0
---

Multi-Claude is a lane-based parallel build system for Claude Code. It turns large tasks into **packet graphs** — small, independently claimable units of work with explicit file ownership and dependency edges.

This handbook covers everything an operator needs to plan, execute, observe, and close parallel runs.

## Who This Is For

You're an operator managing parallel Claude Code sessions across a codebase. You need to know:

- When multi-claude is the right tool (and when it isn't)
- How to plan and freeze a blueprint
- How to monitor execution and intervene when things go wrong
- How to close a run and generate evidence for review

## The Operator Loop

Every run follows the same six-step loop:

1. **Plan** — Assess fitness, generate a blueprint, freeze the contract
2. **Execute** — Workers claim packets and produce artifacts
3. **Observe** — Watch the live console for state, hooks, and fitness
4. **Intervene** — Stop, retry, resolve, or approve as needed
5. **Recover** — Use guided flows for the 8 known failure scenarios
6. **Close** — Derive outcome, generate handoff evidence, promote or reject

## Quick Links

- [Getting Started](/multi-claude/handbook/getting-started/) — Install and run your first build
- [Planning](/multi-claude/handbook/planning/) — Fitness assessment and blueprint creation
- [Console Reference](/multi-claude/handbook/console/) — All 18 console sub-commands
- [Architecture](/multi-claude/handbook/architecture/) — System design and the 12-law handoff spine
- [Security](/multi-claude/handbook/security/) — Threat model and permissions
