# Orchestrator Experience Report — multi-claude

**Role:** Orchestrator (auto.ts / wave engine)
**System:** multi-claude — lane-based parallel build system
**Date:** 2026-03-19

---

## 1. What Was Hardest About Orchestrating Parallel Claude Sessions

The hardest thing was not concurrency. The wave model handles concurrency cleanly: compute the topological sort, launch the wave, wait on Promise.allSettled. SQLite with WAL gives enough isolation that parallel DB writers don't fight each other. None of that was the problem.

The hardest thing was the gap between "launch a worker" and "trust the worker's output." The orchestrator's contract with a worker is entirely mediated by three files on disk: artifacts.json, writeback.json, and a COMPLETE sentinel. That's it. There's no return value, no typed interface, no exception to catch. If a worker silently does the wrong thing — produces a malformed JSON, writes to the wrong directory, completes the session without writing anything — the orchestrator finds out at submit time, not at session time. The error is always downstream of the cause.

This made the failure loop long. Worker runs for several minutes, session completes, orchestrator checks for COMPLETE, submits, validator rejects, packet goes to failed. To debug you're reading output.log, a text file, looking for clues about what the worker misunderstood. That's a painful cycle for a class of errors that was entirely preventable if the schema contract had been established before the first worker ran.

The second hardest thing: worktree lifecycle on Windows. `git worktree add` and `git worktree remove` have enough platform-specific friction that the first few attempts required explicit force flags and try/catch around every cleanup. A worktree that doesn't get cleaned up quietly poisons subsequent runs for the same packet ID. The cleanup code in `createWorktree` is defensive for this reason — it always removes and recreates — but that means any state the worker left in the worktree between retries is also destroyed, which matters if you're trying to inspect what went wrong.

---

## 2. The Subprocess vs SDK Decision

Six attempts at subprocess (`claude -p`) before switching. The failures were not subtle:

**Attempt 1:** Nested session detection. Claude CLI refused to launch a child session from inside a Claude session. This is a hard block, not a flag you can set.

**Attempt 2–3:** Shell escaping. The packet markdown contains backticks, angle brackets, file paths with backslashes, JSON fragments. Getting that through a subprocess argument string on Windows without mangling it requires escaping that compounds across shell layers. Every attempt introduced a different corruption.

**Attempt 4:** ENOENT. The `claude` binary wasn't on PATH in the subprocess environment even though it was available in the shell that launched the orchestrator. Windows subprocess PATH inheritance is not reliable.

**Attempt 5:** Prompt truncation. Long packet prompts got silently truncated when passed via stdin. The worker would start, produce partial output, and write COMPLETE as if it had succeeded.

**Attempt 6:** Output buffering. Subprocess stdout was line-buffered in ways that made real-time progress monitoring unreliable and the final output inconsistent.

Switching to `@anthropic-ai/claude-agent-sdk` with `query()` fixed all of these immediately. The SDK runs in-process. There's no shell, no PATH problem, no escaping, no truncation. The prompt goes in as a string; the session runs; the result comes back as an async iterator. The first SDK-launched worker completed cleanly. The failure mode that took six subprocess attempts to diagnose took zero SDK attempts to trigger.

The cost: the SDK is a dynamic import (`await import('@anthropic-ai/claude-agent-sdk')`), so if it's not installed the failure is a runtime error, not a build error. That's a rough edge worth fixing — it should be a peer dependency that fails at startup, not mid-run. But that's a packaging problem, not a design problem.

The SDK also gives you `maxBudgetUsd` and `maxTurns` as guardrails, which subprocess gives you nothing equivalent to. A runaway worker can't burn indefinitely.

**Verdict:** subprocess was the wrong tool. The SDK was the right tool. The six-attempt path exists because subprocess seemed like the simpler path — no new dependency, no API surface to learn — and it wasn't. The lesson is that the "simpler" option that requires shell escaping is never simpler.

---

## 3. Schema Drift Between Prompt and Validator

The drift happened because the prompt and the validator were written independently and never compared against each other.

The prompt told workers to produce a writeback.json with a flat structure. Something like:

```json
{
  "module": "...",
  "what_changed": "...",
  "summary": "..."
}
```

The validator expected the nested structure that was already codified in the TypeScript interfaces:

```json
{
  "writeback": {
    "module": "...",
    "summary": "...",
    "prose": {
      "what_changed": "..."
    }
  }
}
```

These are not close. A worker following the prompt exactly produces JSON that fails validation at the first check: `Missing top-level "writeback" key`. The error message is clear once you see it, but you only see it after a full worker session has run.

What made this easy to miss during development: both were reasonable shapes for the same data. The flat structure is simpler. The nested structure is what the DB stores. Someone wrote the prompt imagining the flat shape, someone else wrote the validator against the stored shape, and there was no contract test to catch the mismatch before a real worker ran.

The fix was `src/schema/submission.ts` — a single file that is the canonical source of truth for everything related to submission output. It exports:

- The TypeScript interfaces (`WritebackPayload`, `WritebackProse`, `WritebackStructured`)
- The example JSON strings used in prompts (`WRITEBACK_EXAMPLE`, `ARTIFACT_MANIFEST_EXAMPLE`)
- The complete prompt instructions (`WORKER_OUTPUT_INSTRUCTIONS`)
- The validation functions (`validateWriteback`, `validateArtifactManifest`)

If you change the schema, you change one file, and all four consumers (validator, prompt builder, SDK session builder, contract tests) update automatically. The drift cannot recur without someone actively circumventing the import.

The lesson is simple and costs nothing to follow: every interface between the orchestrator and a worker is a protocol. Protocols need a single canonical definition. Define it once, import it everywhere, test that the prompt and validator agree before running a live worker. The contract harness tests that verify this agreement exist now. They didn't at the start.

---

## 4. State Machine Management

The packet lifecycle has 13 states:

`draft → ready → claimed → in_progress → submitted → verifying → verified → integrating → merged`

Plus the sideways states: `blocked`, `failed`, `abandoned`, `superseded`.

Is this too many? No, but it's at the edge of what you can hold in your head. Each state is genuinely distinct and exists because a real thing happens at each transition:

- `claimed` and `in_progress` are separate because claim is an atomic lease acquisition and progress is the worker signaling it has started. These are different operations with different failure modes.
- `submitted` and `verifying` are separate because submission is data receipt and verification is active checking. They could fail independently.
- `verified` and `integrating` are separate because verification is per-packet and integration is cross-packet.
- `failed` is a useful state to land in without going to `abandoned` because it's recoverable — a failed packet can go back to `ready`.

The states I'd scrutinize are `integrating` and `merged`. In the current implementation, `runVerify` produces `verified` but the orchestrator's `executeAutoRun` calls it "merged" when it increments `packetsMerged`. The actual `integrating → merged` transition, including the `integrate` command and the integration run table, isn't wired into the auto path yet. The state machine is correct on paper; the auto runner slightly short-circuits it in practice. That gap will show up when you try to do a real integration run with merge approval.

The `transitions.ts` file is clean and well-typed. The `isValidPacketTransition` function is called at the boundaries. The transition log in the DB means you always know how a packet reached its current state. These are the right decisions.

What the state machine is missing: a way for the orchestrator to inspect all packets that are stuck. If a packet is `in_progress` but its worker session ended without writing COMPLETE, the packet is orphaned in `in_progress` forever until something expires the claim. The `expire` command exists but isn't called from `executeAutoRun`. That's a gap in the auto path, not a gap in the state machine design.

---

## 5. What I Would Redesign If Starting Over

**Stop first. Write the protocol contract before writing any code.**

The single biggest source of wasted time was building the validator and the prompt separately without a shared contract. Before writing `submit.ts`, before writing `render.ts`, write `submission.ts` with the interfaces and the example JSON and the validation functions. Every subsequent piece of code imports from it. This is obvious in retrospect and completely non-obvious in the moment because you're thinking about the command, not the protocol.

**Make the output contract testable locally by the worker.**

The worker is told to write specific JSON shapes. There's no way for the worker to verify its own output before signaling COMPLETE. A local validation step — even just `multi-claude validate-output ./output-dir/` — would let workers self-check and produce much better error signals. Right now the first feedback the worker gets is a failed submission, which the worker doesn't see because it's a completed session by then.

**Consolidate the DB open/close pattern.**

`executeAutoRun` opens and closes separate `db`, `db2`, `db3`, `db4`, `db5`, `db6` handles as it proceeds through each wave. This is a consequence of the function being async while the DB connections are synchronous. It works, but it's messy. The cleaner approach is a command handler pattern where each logical operation opens a connection, does its work, and closes it — and the orchestrator calls those handlers rather than reaching into the DB directly. `submitWorkerOutput` and `verifyWorkerOutput` show what this looks like. The wave loop should look the same.

**Make worktree cleanup explicit and tracked.**

When a packet goes to `failed`, the worktree stays on disk. The current code has a `cleanupWorktree` function that's marked unused with a comment. This means failed worktrees accumulate. Add an explicit cleanup step in the failure path, or track worktree presence in the DB and clean them up at run start.

**The COMPLETE sentinel is the right idea, done wrong.**

Writing "done" to a file called COMPLETE is polling-friendly and works. But it's fragile to whitespace differences and a worker that crashes mid-write could produce a partial file. A better design: poll for `writeback.json` being present, non-empty, and valid JSON rather than polling for a separate sentinel. The JSON output is the actual evidence. The sentinel is a redundant layer that only exists because the orchestrator can't parse the JSON in-flight.

**Retry is missing from the auto path.**

When a worker fails, the packet goes to `failed` and the run stops. The state machine allows `failed → ready` which would support retry. The auto runner doesn't use this. A single failed packet in wave 3 aborts all subsequent waves even if the failure was transient. At minimum, retry once before halting.

---

## 6. Minimum Viable Orchestrator That Preserves the Guarantees

The current orchestrator has: wave computation, worktree management, SDK session launch, output collection, submit, verify, knowledge promotion, run tracking in the DB, status/stop commands, model routing by role.

That's 200+ lines of meaningful logic in `executeAutoRun`. Some of it is essential. Some is bookkeeping that could be deferred.

The minimum viable version that preserves the core guarantees:

**Keep:**
- Topological sort to compute waves (without this, dependencies break)
- claim → in_progress state transitions (without these, two runners can take the same packet)
- SDK session launch with the canonical prompt (without this, schema drift)
- Validation at submit time against the canonical schema (without this, bad data reaches the DB)
- Verified → merged gate (without this, unverified work merges)

**Defer:**
- Knowledge promotion (it's useful but not correctness-critical)
- Run tracking tables (auto_runs, auto_run_workers) — useful for status/resume but not for a single-run system
- Worktree creation — workers can run in a scratch directory if you're not doing git integration
- Model routing by role — a flat "use sonnet" is fine for getting started
- Amendment handling — handle it manually until you know the frequency

The three-line core of the orchestrator: compute waves, execute each wave in parallel with SDK sessions, validate outputs before the state machine advances. Everything else is observability, recovery, and hygiene. The guarantees come from the three-line core. The rest makes it operable.

The constraint that is non-negotiable: the canonical submission schema must exist before the first worker runs. Everything else can be added incrementally. Schema drift cannot be fixed incrementally — it requires re-running workers that have already completed.

---

## Summary

The orchestrator works. One packet completed the full pipeline — claim, progress, SDK session, complete, submit, verify, knowledge promotion — with zero failures once the schema contract was established. The investment required to get there was: six failed subprocess attempts, one schema drift bug, and one canonical schema file that should have existed from day one.

The state machine is sound. The wave model is correct. The SDK is the right execution mechanism. The canonical schema is the right fix for schema drift. The gaps — worktree cleanup, retry logic, the integrate/merge gap in the auto path — are gaps in the implementation, not the design.

The experience report from the Builder side documented this from the worker's perspective. This report documents it from the orchestrator's. The system works. It's not effortless. Build the contract before the code.

---

*Filed by: Claude (Orchestrator, auto.ts, 2026-03-19)*
