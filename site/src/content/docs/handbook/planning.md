---
title: Planning
description: Fitness assessment, blueprint creation, and the freeze contract.
sidebar:
  order: 2
---

Planning is the first step of the operator loop. A good plan means the difference between a clean parallel run and a coordination mess.

## Fitness Assessment

Multi-Claude uses evidence from three scored trials to assess fitness:

| Work Class | Grade | Speed | Break-even |
|------------|-------|-------|------------|
| Backend/state/domain | B (strong) | Win | ~3 packets |
| UI/interaction/seam-heavy | A- (moderate) | Neutral | ~5 packets |
| Control-plane/infra | B+ (moderate) | Neutral | ~5-6 packets |

```bash
multi-claude plan evaluate \
  --work-class backend_law \
  --packets 6 \
  --coupling low \
  --ownership clean
```

The engine produces:
- **Fit assessment** — strong, moderate, or weak
- **Anti-pattern detection** — 8 known failure shapes
- **Recommendation** — go, caution, or single-claude

### Anti-Patterns

The doctrine engine detects these failure shapes before you start:

1. **Too few packets** — Coordination overhead dominates
2. **High coupling** — Semantic reconciliation unbounded
3. **Shared file ownership** — Merge conflicts guaranteed
4. **Sequential critical path** — Parallelism impossible
5. **Unstable floor** — Build/test broken before you begin
6. **Operator bottleneck** — Too many gates for one human
7. **Missing verifier** — No independent check on worker output
8. **Seam file collision** — Shared CSS/config without section ownership

## Blueprints

A blueprint defines the packet graph:

```bash
multi-claude blueprint init --template backend_law
```

Templates provide starting structures for common work classes. Each blueprint contains:

- **Packets** — Named units of work with descriptions
- **File ownership** — Which files each packet may touch (exclusive)
- **Dependencies** — Edges between packets (hard deps = must complete first)
- **Waves** — Parallel execution groups derived from dependency order
- **Gates** — Verification checkpoints between waves

### Validation

```bash
multi-claude blueprint validate
```

Checks:
- No file overlap between packets in the same wave
- All dependency edges point to existing packets
- No circular dependencies
- Gates reference valid packets
- Guard conditions are satisfiable

### Freeze

```bash
multi-claude blueprint freeze
```

Computes a SHA-256 hash of the material blueprint fields. After freeze, the blueprint is immutable — no edits allowed. This is the contract workers execute against.

```bash
multi-claude blueprint render
```

Generates a markdown contract document from the frozen blueprint, replacing hand-authored planning docs.
