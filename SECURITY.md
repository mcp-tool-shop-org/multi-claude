# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a Vulnerability

Report security issues to: 64996768+mcp-tool-shop@users.noreply.github.com

**Response timeline:**
- Acknowledgment: within 48 hours
- Assessment: within 7 days
- Fix (if confirmed): within 30 days

## Security Posture

Multi-Claude is a **local-only CLI tool** that orchestrates parallel Claude Code sessions on a single developer machine.

### What it touches
- **Local filesystem:** Reads and writes within the working directory and its `.multi-claude/` data folder
- **SQLite database:** Execution state stored in a local `.multi-claude/runs.db` file
- **Claude Code CLI:** Spawns `claude` subprocesses — inherits the user's existing Claude Code authentication
- **Local network (monitor only):** The Control Plane Monitor binds to `localhost` for the operator UI

### What it does NOT touch
- No cloud APIs called directly (Claude API access is through Claude Code, not this tool)
- No telemetry, analytics, or phone-home behavior
- No credential storage — authentication is delegated to Claude Code
- No network egress beyond localhost (monitor server binds to 127.0.0.1 by default)
- No access to files outside the working directory unless explicitly configured

### Permissions model
- All file operations are constrained to the project directory and `.multi-claude/` data directory
- The monitor server binds to localhost only — not exposed to the network
- Hook policies execute existing CLI commands — no arbitrary shell execution
- Operator actions go through canonical law modules — no direct database mutations from the UI
