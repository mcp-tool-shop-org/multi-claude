---
title: For Beginners
description: New to Multi-Claude? Start here for a gentle introduction.
sidebar:
  order: 99
---

New to parallel build systems or orchestrating multiple AI sessions? This page explains everything from scratch.

## What is this tool?

**Multi-Claude** is a command-line tool that lets you split a large coding task into smaller pieces and have multiple Claude Code sessions work on them simultaneously. Instead of one Claude handling everything sequentially, you get parallel execution with coordination — like having multiple developers working on different parts of the same project at the same time.

The tool manages who works on what files, tracks dependencies between tasks, and gives you a live console to monitor progress and intervene when needed.

## Who is this for?

- **Developers** who use Claude Code and have tasks large enough to benefit from parallel execution
- **Technical leads** who need to coordinate multi-part changes across a codebase
- **Power users** who want structured, evidence-based handoff for complex builds

You should already be comfortable with Claude Code and have experience using a terminal. Multi-Claude is an advanced orchestration tool, not an introduction to AI-assisted development.

## Prerequisites

Before you start, you need:

- **Node.js 20+** — the runtime for the CLI
- **Claude Code CLI** — installed and working (`claude` command available in your terminal)
- **npm** — for installing the package globally
- **A codebase** — you need a project to run multi-claude against
- **Basic terminal skills** — you'll be running CLI commands and reading console output

Verify your setup:

```bash
node --version     # Should show v20.x or later
claude --version   # Should show Claude Code version
```

## Your First 5 Minutes

### 1. Install Multi-Claude

```bash
npm install -g @multi-claude/cli
```

### 2. Check if your task is a good fit

Not every task benefits from parallel execution. Run the fitness evaluator:

```bash
multi-claude plan evaluate --work-class backend_law --packets 6 --coupling low
```

This tells you whether the overhead of coordination is worth it. Tasks with 5+ independent units and clear file ownership work best.

### 3. Create a blueprint

```bash
multi-claude blueprint init --template backend_law
```

This generates a packet graph — a plan showing what work each Claude session will do, which files it owns, and what depends on what.

### 4. Validate and freeze

```bash
multi-claude blueprint validate
multi-claude blueprint freeze
```

Validation checks for illegal file overlaps and broken dependencies. Freezing locks the blueprint with a SHA-256 hash so it can't change during execution.

### 5. Start the run

```bash
multi-claude run
multi-claude console watch
```

Workers claim packets and start executing. The console shows live progress across all sessions.

## Common Mistakes

### 1. Using multi-claude for small tasks
If your task has fewer than 3 packets or is mostly sequential, single-Claude is faster. The coordination overhead only pays off when there's real parallelism to exploit.

### 2. Overlapping file ownership
Each file should belong to exactly one packet. If two workers edit the same file, you get merge conflicts and semantic reconciliation headaches. The validator catches this — pay attention to its warnings.

### 3. Ignoring the console
Multi-Claude is operator-driven, not fully autonomous. Check `console next` regularly to see what needs your attention. Hooks, gate approvals, and recovery flows all need human judgment.

### 4. Skipping blueprint freeze
Running without a frozen blueprint means the contract can shift during execution. Always freeze before running — it ensures everyone works against the same agreed plan.

### 5. Not checking fitness first
The `plan evaluate` command exists for a reason. It uses evidence from scored trials to predict whether your task will benefit from parallel execution. Skipping this step leads to wasted coordination effort on tasks that don't fit.

## Next Steps

- Follow [Getting Started](../getting-started/) for detailed install and first-run instructions
- Read [Planning](../planning/) to understand fitness assessment and blueprint creation
- Check the [Console Reference](../console/) for all 18 sub-commands
- Review [Architecture](../architecture/) to understand the 12-law handoff spine

## Glossary

| Term | Definition |
|---|---|
| **Packet** | A small, independently claimable unit of work with explicit file ownership and dependencies |
| **Blueprint** | A packet graph describing the full plan — what work, which files, what order |
| **Freeze** | Locking a blueprint with a SHA-256 hash so it cannot change during execution |
| **Worker** | A Claude Code session that claims and executes packets |
| **Lane** | A parallel execution slot — each lane runs one worker at a time |
| **Wave** | A set of packets that can execute in parallel (all dependencies satisfied) |
| **Hook** | A decision point that requires operator judgment before execution continues |
| **Gate** | A quality checkpoint that must be approved before promoting results |
| **Fitness** | A score predicting whether a task will benefit from multi-claude parallelism |
| **Handoff** | Evidence-bound transfer of completed work, including audit trail and verification results |
| **Operator** | The human running multi-claude — you observe, intervene, and approve |
| **Console** | The CLI interface for monitoring and controlling a running build |
