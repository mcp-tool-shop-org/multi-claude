# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-03-25

### Fixed
- CLI `--version` was hardcoded to 0.1.0 — now reads dynamically from package.json

## [1.0.0] - 2026-03-20

### Added

- **Control Plane v1** (Phases 9A-9F): Full operator loop — plan, execute, observe, intervene, recover, close
  - Run Planner with fitness assessment and blueprint freeze (9A)
  - Live 5-pane operator console with auto-refresh (9B)
  - Operator intervention with audit trail and lawful refusal (9C)
  - Canonical control contract with 116 guard tests (9D)
  - Guided recovery flows with 8 scenarios (9E)
  - Run closure and outcome spine with acceptability derivation (9F)
- **Delivery and Promotion** (Phases 10A-10D): Evidence-bound handoff and approval
  - Handoff spine with review-readiness rules (10A)
  - Promotion/approval gate with fingerprint-locked bindings (10B)
  - Live promotion trials across 3 coupling profiles (10C)
  - Export spine — markdown, JSON, CI gate verdict (10D)
- **Handoff Spine** (Phases 11-12): 12 laws governing the full chain from execution to promotion
- **Control Plane Monitor** (Phase 13A-13C): React operator UI
  - Read-only dashboard with overview, queue, item detail, lane health, activity (13A)
  - Lawful operator actions — claim, release, defer, requeue, escalate (13B)
  - Review workbench with decision affordance — approve, reject, request-recovery, needs-review (13C)
- **Hook Policy Engine**: Event-driven automation with retry/recovery
- **Fitness Scoring**: Deterministic fit assessment from work class, packet count, coupling, ownership
- **Phase 8 Doctrine**: Scored trials, run-class fit map, anti-patterns, packet templates

### Foundation (pre-1.0)

- Lane-based parallel execution model
- Packet graph with dependency resolution
- Worker lifecycle management via Claude Agent SDK
- SQLite execution database (19+ tables)
- 26+ CLI commands including 18 console sub-commands
- 1500+ tests across 72 test files
