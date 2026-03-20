---
title: Security
description: Threat model, permissions, and security posture.
sidebar:
  order: 5
---

## Threat Model

Multi-Claude is a **local-only CLI tool** that orchestrates parallel Claude Code sessions on a single developer machine. It has no cloud backend, no telemetry, and no network egress beyond localhost.

### What It Touches

| Resource | Access | Notes |
|----------|--------|-------|
| Local filesystem | Read/write | Working directory + `.multi-claude/` data folder |
| SQLite database | Read/write | Execution state in `.multi-claude/runs.db` |
| Claude Code CLI | Subprocess | Spawns `claude` sessions — inherits user's auth |
| Localhost network | Listen | Monitor server binds to `127.0.0.1` only |

### What It Does NOT Touch

- No cloud APIs called directly — Claude API access is through Claude Code, not this tool
- No telemetry, analytics, or phone-home behavior
- No credential storage — authentication is delegated entirely to Claude Code
- No network egress beyond localhost
- No access to files outside the working directory unless explicitly configured

### Permissions Model

- **File operations** are constrained to the project directory and `.multi-claude/` data directory
- **Monitor server** binds to localhost only — not exposed to the network by default
- **Hook policies** execute existing CLI commands only — no arbitrary shell execution
- **Operator actions** go through canonical law modules — no direct database mutations from the UI
- **Approvals** are fingerprint-locked to specific evidence versions — cannot be silently reused after changes

## Reporting Vulnerabilities

Report security issues to: `64996768+mcp-tool-shop@users.noreply.github.com`

- Acknowledgment: within 48 hours
- Assessment: within 7 days
- Fix (if confirmed): within 30 days

See [SECURITY.md](https://github.com/mcp-tool-shop-org/multi-claude/blob/main/SECURITY.md) for the full policy.
