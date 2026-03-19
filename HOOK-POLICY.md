# Hook Policy Engine

Turns the operating playbook into enforceable system behavior.
Hooks decide when multi-claude activates, what role spawns, and what context each worker sees.

**Core law:** Hooks may only call existing lawful commands. No direct DB writes. No hidden state transitions. No invisible approvals.

---

## 1. Events

The hook system listens to these state transitions:

| Event | Fires when | Source |
|-------|-----------|--------|
| `feature.approved` | Feature moves from proposed → approved | `multi-claude approve` |
| `packet.ready` | Packet moves from draft → ready | `multi-claude packet ready` |
| `packet.claimed` | Packet is claimed by a worker | `multi-claude claim` |
| `packet.verified` | Packet passes verification | `multi-claude verify` |
| `packet.failed` | Packet fails verification or submission | `multi-claude verify` / `multi-claude submit` |
| `wave.claimable` | All hard deps for a wave are satisfied, 1+ packets claimable | Derived from packet states |
| `wave.empty` | All packets in current wave are terminal but feature is incomplete | Derived from packet states |
| `integration.ready` | All merge-relevant packets are verified | Derived from packet states |
| `approval.recorded` | Human approval is recorded | `multi-claude approve` |
| `queue.stalled` | No packets have changed state for > threshold time | Timer / poll |

---

## 2. Conditions

Each policy rule evaluates conditions before acting.

### Parallelism conditions
| Condition | How to check |
|-----------|-------------|
| `claimable_count >= N` | Count packets in ready state with all hard deps merged |
| `no_file_overlap` | Compare allowed_files across claimable packets — no intersection |
| `no_protected_files` | None of the claimable packets touch protected files |
| `no_seam_files` | None of the claimable packets modify seam files |

### Phase shape conditions
| Condition | How to check |
|-----------|-------------|
| `critical_path_depth <= N` | Longest dependency chain in remaining packet graph |
| `phase_type == scaffold` | Feature has scaffold/foundation packets as root |
| `phase_type == subsystem` | Feature has independent leaf packets after contract layer |
| `phase_type == hardening` | Feature is remediation/audit/docs-heavy |
| `graph_depth >= 2` | At least 2 waves of work remain |

### Failure conditions
| Condition | How to check |
|-----------|-------------|
| `failure_class == deterministic` | Verification failed on a required check (typecheck, test, lint) |
| `failure_class == flaky` | Same check passed on prior attempt |
| `failure_class == scope_violation` | Forbidden/protected file touched |
| `failure_class == schema_mismatch` | Writeback or artifacts failed validation |
| `retry_count < max_retries` | Packet attempt count vs policy limit |

### Integration conditions
| Condition | How to check |
|-----------|-------------|
| `all_packets_verified` | Every merge-relevant packet is in verified state |
| `all_promotions_complete` | Every knowledge_writeback_required packet has a promotion |
| `merge_approval_exists` | Approval record exists for feature with type merge_approval |

---

## 3. Actions

Each policy rule produces exactly one action.

| Action | What it does |
|--------|-------------|
| `stay_single` | Do nothing. Operator continues in current session. |
| `launch_workers` | Claim + render + launch SDK worker sessions for specified packets |
| `launch_verifier` | Launch verifier-analysis worker for a failed packet |
| `launch_docs` | Launch knowledge/docs worker for verified packets |
| `retry_once` | Reclaim failed packet with fresh attempt, launch new worker |
| `pause_human_gate` | Set run to paused, surface gate to operator |
| `resume_integration` | Run prepare → execute → complete integration sequence |
| `surface_blocker` | Report the true blocker to operator (stall diagnosis) |
| `escalate` | Flag to operator that automatic resolution failed |

### Action output shape

Every action produces a structured decision:

```json
{
  "action": "launch_workers",
  "packets": ["feature--backend-commands", "feature--state-stores"],
  "role": "builder",
  "model": "claude-sonnet-4-6",
  "playbook_id": "builder-playbook",
  "reason": "2 claimable packets with no file overlap after contract packet merged",
  "requires_human_approval": false,
  "context_bundle": {
    "include": ["rendered_packet", "playbook", "allowed_files", "forbidden_files", "reference_files", "output_schema", "verification_requirements"],
    "exclude": ["full_repo_history", "phase_transcript", "operator_scratchpad", "other_worker_outputs"]
  }
}
```

---

## 4. Policy Modes

### Advisory mode
Hooks recommend actions. Operator confirms before execution.

```
[hook] feature.approved → recommends: launch_workers for 3 packets
[operator] confirm / reject / modify
```

Use advisory mode when:
- First run of a new phase type
- Policy rules are newly added or modified
- High-value / high-risk work
- Operator wants learning visibility

### Autonomous mode
Hooks act automatically. Only human gates pause execution.

```
[hook] packet.verified → auto-launches next wave workers
[hook] integration.ready → auto-pauses for merge_approval (human gate)
[operator] approves merge → hook resumes integration
```

Use autonomous mode when:
- Policy rules are proven on prior runs
- Phase shape is well-understood
- Packet contracts are clean
- Worker output schema is validated

### Mode selection
Default: **advisory** for new features, new phase types, first run of any hook.
Promote to **autonomous** after: hook has fired correctly 3+ times without operator override.

---

## 5. Context Bundle Law

**Each spawned worker sees only what it needs. Nothing more.**

### Mandatory context (always included)
- Rendered packet markdown (from `multi-claude render`)
- Role playbook
- Allowed files list
- Forbidden files list with rationale
- Reference files (read-only context)
- Output schema (artifacts.json + writeback.json format)
- Verification requirements

### Forbidden context (never included)
- Full repo history or git log
- Phase-level transcript or operator scratchpad
- Other workers' outputs or submissions
- Unrelated packet contents
- Pipeline state or queue position
- Other features' data
- Operator decision rationale beyond what's in the packet

### Optional context (included only when packet declares it)
- Specific file contents listed in `reference_files`
- Architecture doc sections relevant to the packet's layer
- Prior attempt output (only for retry actions)

### Why this matters
Without context limits:
- Workers waste tokens reading irrelevant code
- Operator context balloons with orchestration bookkeeping
- Workers make assumptions from context they shouldn't have seen

With context limits:
- Workers are sharp and focused
- Token cost is proportional to packet size
- Independence is real, not theatrical

---

## 6. Hard Stops

These rules cannot be overridden by any policy, hook, or mode.

### Never auto-launch
- Scaffold/foundation work → always operator/single-Claude
- Packets that require protected file authorship
- Packets with unresolved contradictions in allowed/forbidden files
- Work where the architecture is still being defined
- When packet graph depth is 1 (nothing to parallelize)

### Never bypass
- Human gate approvals (merge, protected-file, law amendments)
- CLI command contracts — hooks call commands, never raw DB
- Verification independence — same session cannot build and verify
- Integration atomicity — no partial merges

### Never hide
- Hook decisions must be logged with event + conditions + action + reason
- Failed hook evaluations must be surfaced, not silently swallowed
- Mode overrides must be recorded

---

## 7. Initial Policy Rules

These are the first rules to implement. Each has an event trigger, conditions, and action.

### Rule 1: Auto-launch parallel wave

```
event: packet.verified OR wave.claimable
conditions:
  - claimable_count >= 2
  - no_file_overlap == true
  - no_protected_files == true
  - phase_type != scaffold
  - graph_depth >= 2
action: launch_workers
mode: advisory (promote to autonomous after 3 clean runs)
```

### Rule 2: Stay single-Claude on foundation work

```
event: feature.approved
conditions:
  - phase_type == scaffold OR critical_path_depth <= 2
action: stay_single
mode: autonomous (always enforced)
reason: "Foundation work has weak parallelism and high coordination cost"
```

### Rule 3: Auto-launch docs/knowledge

```
event: packet.verified
conditions:
  - verified_count >= 3
  - no docs packet currently in_progress
  - feature has docs packet in ready state
action: launch_docs
mode: advisory
```

### Rule 4: Verifier-analysis on failure

```
event: packet.failed
conditions:
  - failure_class == deterministic
  - failure is NOT scope_violation or schema_mismatch
  - retry_count < 1
action: retry_once (fresh attempt, new worker)
mode: advisory
```

```
event: packet.failed
conditions:
  - failure_class == deterministic
  - retry_count >= 1
action: launch_verifier (verifier-analysis role, Sonnet model)
mode: advisory
```

### Rule 5: Integration pause

```
event: integration.ready
conditions:
  - all_packets_verified == true
  - all_promotions_complete == true
action: pause_human_gate (merge_approval)
mode: autonomous (always pauses, never auto-merges)
```

### Rule 6: Resume after approval

```
event: approval.recorded
conditions:
  - approval_type == merge_approval
  - run is paused with pause_gate_type == merge_approval
action: resume_integration
mode: autonomous
```

### Rule 7: Stall detection

```
event: queue.stalled (no state change for 10+ minutes)
conditions:
  - feature is in_progress
  - claimable_count == 0
  - active_workers == 0
  - feature is not complete
action: surface_blocker
mode: autonomous
reason: "Diagnose: circular dep, missing approval, or all packets blocked"
```

### Rule 8: Scope violation rejection

```
event: packet.failed
conditions:
  - failure_class == scope_violation
action: escalate
mode: autonomous
reason: "Scope violations indicate packet design error, not worker error. Do not retry."
```

---

## 8. Hook Decision Log

Every hook evaluation is recorded:

```json
{
  "timestamp": "2026-03-19T10:00:00Z",
  "event": "packet.verified",
  "event_entity": "phase2--backend-commands",
  "conditions_evaluated": {
    "claimable_count": 3,
    "no_file_overlap": true,
    "no_protected_files": true,
    "phase_type": "subsystem",
    "graph_depth": 3
  },
  "rule_matched": "rule_1_auto_launch_parallel_wave",
  "action": "launch_workers",
  "packets": ["phase2--state-stores", "phase2--ui-lifecycle", "phase2--docs"],
  "mode": "advisory",
  "operator_decision": "confirmed",
  "executed": true
}
```

This log is the audit trail for all automation decisions.

---

## 9. Applying to StudioFlow

### Phase 1 (Foundation Spine) — retrospective
Rule 2 would have fired: `phase_type == scaffold` → `stay_single`.
**Result:** No wasted multi-claude ceremony. Operator builds foundation alone.

### Phase 2 (Persistence) — retrospective
After contract types merged, Rule 1 would have fired: `claimable_count == 2` (Rust backend + state/UI), `no_file_overlap == true`.
**Result:** Correctly spawns 2 parallel workers. Matches what we actually did.

### Phase 3 (Command History) — retrospective
Rule 2 would have fired initially: `critical_path_depth <= 2`.
After engine landed, Rule 1 would fire for tests + UI workers.
**Result:** Operator builds engine, hooks spawn parallel tail work. Matches what we did.

### Phase 4+ (future)
Hooks will evaluate each phase's graph shape and decide automatically.
No more manual "should I use multi-claude here?" decisions.

---

## 10. Implementation Order

1. **Event emission** — Add hook event emission to existing CLI commands (claim, verify, submit, approve, integrate)
2. **Condition evaluator** — Function that reads DB state and computes all conditions
3. **Policy rules engine** — Matches events + conditions → actions
4. **Decision log** — Write every evaluation to `hook_decisions` table or log file
5. **Advisory mode UI** — Operator sees recommendations, confirms/rejects
6. **Autonomous mode** — After advisory proves stable, hooks act directly
7. **Context bundle renderer** — Generates minimal worker context from packet + policy

Start with advisory mode. Promote rules to autonomous one at a time after they prove correct.
