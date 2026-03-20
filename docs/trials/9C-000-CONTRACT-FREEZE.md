# 9C-000 — Run Intervention / Recovery Console — Contract Freeze

**Phase:** 9C
**Objective:** Give operators lawful, explicit control over active runs — stop, retry, resume, approve — with refusal reasons for every illegal action and an audit trail for every intervention.
**Class:** Backend/state (strongest fit)
**Predicted fit:** A- to A

## Critical Product Rule

Every operator action must:
1. Go through an existing lawful command (auto stop, auto resume, claim, approve, hooks resolve)
2. Check preconditions before executing — never attempt an illegal action
3. Explain why an action is disallowed, not just hide it
4. Record an audit entry (who, what, when, before-state, after-state, reason)

No new mutation paths. No bypass of the law engine. No freeform state edits.

## Action Catalog

| Action | Precondition | Delegates to | Refusal if |
|--------|-------------|--------------|-----------|
| stop_run | Run is running or paused | `auto stop --run <id>` | Run already terminal |
| retry_packet | Packet is failed, retry count < MAX_RETRIES | `claim` + `auto run` | Not failed, or retry exhausted |
| resume_run | Run is paused, required gate resolved | `auto resume --run <id>` | Not paused, or gate unresolved |
| approve_gate | Gate exists and is pending | `approve --scope-type ... --type ...` | Already resolved or no such gate |
| resolve_hook | Hook decision is pending | `hooks resolve --decision <id> --resolution ...` | Already resolved |

## Availability Model

For each action, the system computes:

```typescript
interface ActionAvailability {
  action: string;           // e.g. 'stop_run'
  available: boolean;
  reason: string;           // why available or why not
  command: string | null;   // CLI command if available
  preconditions: Array<{
    check: string;          // human-readable check description
    met: boolean;
    detail: string;         // what was checked
  }>;
}
```

The operator sees all actions with their availability status. Unavailable actions show exact precondition failures.

## Audit Trail

Every operator intervention records:

```typescript
interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  targetType: string;       // 'run' | 'packet' | 'gate' | 'hook_decision'
  targetId: string;
  beforeState: string;
  afterState: string;
  reason: string;
  success: boolean;
  error: string | null;
}
```

Stored in a new `operator_audit_log` table. This is the one new table 9C creates — justified because audit trail is genuinely new truth not covered by existing tables.

## Packet Graph

### Wave 1 — Action Law
| Packet | File | Responsibility |
|--------|------|----------------|
| 9C-101 | `src/console/action-availability.ts` | Compute which actions are legal, with preconditions and refusal reasons |
| 9C-102 | `src/console/audit-trail.ts` | Record and query operator interventions |

### Wave 2 — Action Execution + CLI
| Packet | File | Responsibility |
|--------|------|----------------|
| 9C-201 | `src/console/action-executor.ts` | Execute lawful actions by delegating to existing commands |
| 9C-202 | `src/commands/console-actions.ts` | CLI: `multi-claude console act` + action sub-commands |

### Tail
| Packet | Responsibility |
|--------|----------------|
| 9C-301 | Verifier — precondition correctness, audit completeness |
| 9C-401 | Integrator — wire into CLI, end-to-end test |

## File Ownership

| Packet | Owns | References (read-only) |
|--------|------|----------------------|
| 9C-101 | `src/console/action-availability.ts`, `test/console/action-availability.test.ts` | run-model.ts, hook-feed.ts |
| 9C-102 | `src/console/audit-trail.ts`, `test/console/audit-trail.test.ts` | db/connection.ts |
| 9C-201 | `src/console/action-executor.ts`, `test/console/action-executor.test.ts` | action-availability.ts, audit-trail.ts, existing commands |
| 9C-202 | `src/commands/console-actions.ts`, `test/commands/console-actions.test.ts` | action-executor.ts, console.ts |

## What NOT to Build

- Generic admin shell
- Freeform state mutation
- "Convenience" actions that bypass law
- Broad TUI framework
- Historical audit analytics (future phase)
- Undo/rollback mechanics

## Success Criteria

1. All 5 actions have availability checks with preconditions
2. Every refusal explains exactly why (not just "disallowed")
3. Every successful intervention creates an audit entry
4. `multi-claude console actions` shows all actions with availability
5. `multi-claude console act <action>` refuses illegal actions cleanly
6. All tests pass, total > 475
