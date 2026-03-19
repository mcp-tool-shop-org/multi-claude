# Builder Experience Report — "Add validation state to anchorStore"

**Worker role:** Builder (state layer)
**Task:** Add validation state to anchorStore
**Scope:** 2 allowed files, 1 forbidden file, 8 tests written, 2575 repo tests passing

---

## 1. What worked well about the packet format

The goal statement was tight and unambiguous. "Add validation state to anchorStore" is a sentence I can hold in my head without rereading it five times. It immediately ruled out a dozen things I might otherwise consider — backend wiring, UI reactivity, contract changes. I knew my job before I opened a single file.

The allowed/forbidden file list was the most practically useful constraint. Having `allowed_files` explicitly enumerated meant I never had to guess whether touching a given file was in scope. The forbidden file acted as a hard fence: it told me there was a boundary I was not supposed to cross, which implicitly told me that something on the other side of that boundary was owned by a different packet. That context — someone else owns that seam — shaped how I wrote the interface between my state and whatever depends on it.

The acceptance criteria being tied to a test count (8 tests) gave me a concrete exit condition rather than a vague "make it work." Test count alone is a blunt instrument, but pairing it with the criteria gave it meaning.

The dependency graph, even when I could only see my own node, told me what I was producing *for*. Knowing this was a state layer packet with downstream consumers meant I thought harder about the shape of what I exported, not just the behavior.

---

## 2. What was friction

The biggest friction point was not knowing the broader system's conventions before starting. The first thing I did was read the existing files to infer naming patterns, how other store slices were structured, and what the module expected from state entries. That inference step is unavoidable in any codebase, but I was doing it with no map. If the packet had included a single sentence — "follow the pattern established in [neighboring store file]" — it would have saved multiple read-and-reason cycles.

The forbidden file rule without explanation was mildly confusing. I respected it because the constraint was explicit, but I didn't know *why* that file was off-limits. Was it protected because another worker owned it, because it was a seam file under a different contract, or because touching it would trigger a merge conflict? The distinction matters if I'm deciding how to structure the boundary on my side. A one-line rationale ("this file is owned by the integration packet, do not touch") would remove that ambiguity entirely.

The output contract instructions (artifacts.json + writeback.json + COMPLETE signal) were clear in structure but required me to hold a small amount of ceremony in parallel with doing the actual work. The COMPLETE file sentinel in particular felt mechanical — the kind of thing that exists because the harness polls for it, not because it communicates anything. It works, but it's plumbing you're aware of.

---

## 3. The output contract (artifacts.json + writeback.json)

The artifacts.json shape is simple and produces zero friction. Four flat arrays, all strings. I could fill it in 30 seconds.

The writeback.json schema is more demanding but I understand why. The `prose` nesting inside `writeback` is the one place where a new worker would trip — the error message from the validator ("Missing top-level 'writeback' key") makes it recoverable, but only if you get to run the validator before submission. The fact that the validator rejects generic summaries (literally checks for "implemented the feature" or "done") is a good design decision. It forces real signal rather than token compliance.

The fields I found most useful to write: `what_affects_next` and `dependencies_affected`. Writing them made me think explicitly about downstream blast radius. That's a good side effect of the format — it turns completion into a brief knowledge handoff rather than just a status flip.

The field I found least useful to write: `docs_required`. It's a boolean, so it's easy to fill, but it felt disconnected from any downstream action. If no one reads that field to actually schedule documentation, it's cargo. Whether that's a system maturity issue or a gap in the playbook, I can't tell from here.

---

## 4. Working in isolation

Not seeing the broader system mostly helped. I had one job. There was no temptation to "fix" something in a neighboring module, no context bleeding from watching another worker make a different choice, no second-guessing whether my interface would match what the UI packet expected. The constraint made me commit to a shape and trust the contract.

Where isolation hurt: I had no way to verify that my exported types were compatible with what the backend packet was going to produce or what the UI packet was going to consume. I wrote to the contract as I understood it from the packet spec. If that spec had any ambiguity, I resolved it by reading the existing codebase — but my read of the codebase is necessarily incomplete in a worktree that only shows me my allowed files.

The deeper risk is that two workers working in isolation can produce locally-correct changes that conflict at the seam. The system accounts for this through the integration phase, but it means errors show up late. That's an acceptable trade for the speed gain of parallelism, as long as the seam definitions are tight.

---

## 5. What I would change

**Add a "prior art" hint to packets.** A single field — `reference_file` or `pattern_from` — pointing to an existing file that uses the same conventions would save the initial read-and-infer cycle without breaking isolation. It's not coordination, it's just context.

**Add a rationale field to forbidden_files.** Not a long one. One line per entry: "owned by packet X" or "seam file, declare-only" or "protected, requires author approval." I already know why from reading the schema, but workers who haven't internalized the schema shouldn't have to reverse-engineer it from a list of filenames.

**Surface the writeback validation errors in-band rather than at submission.** If I could run `validate-writeback` against my draft writeback.json before writing COMPLETE, I'd catch shape errors before the submission round-trip. Even a local lint script that checks the required fields would reduce the tail risk of a failed submission due to a malformed JSON key.

**The COMPLETE/ERROR sentinel pattern is fine but fragile.** It works. But a single typo in "done" or a newline difference silently breaks the signal. If the harness is polling files anyway, it could just look for the JSON outputs being present and non-empty rather than requiring a separate sentinel file. The JSON files are the actual evidence; COMPLETE is just a flag that they exist.

---

## 6. Structured packet vs. vague "implement this feature"

The difference is decisive. A vague request is an invitation to scope creep, second-guessing, and over-engineering. Without the allowed/forbidden file list, I would have wondered whether to update the backend, clean up a related store file I noticed was messy, add a helper to the types module. I would have done more than was needed and possibly touched something another worker was also touching.

The packet format turns a fuzzy region of the codebase into a well-defined surface. The constraints felt like a guardrail, not a cage. I was never fighting the packet — it just told me where the edges were and then got out of the way.

The acceptance criteria tied to actual test count meant I had a real exit condition. "Implement this feature" has no exit condition other than my own judgment about when it's done. That judgment is often wrong in both directions — too much or too little.

The output contract (writeback.json especially) is overhead on a one-off task but it's extremely low overhead, and the payoff is that every worker leaves behind a structured record. If I were building this system, I'd have made the same choice.

The one honest criticism: the ceremony of the output contract does ask me to context-switch briefly from "engineering mode" into "form-filling mode." That's a small but real friction cost. The way to make it disappear is to internalize the schema so thoroughly that filling it out feels as natural as writing a commit message. That happens with repetition.

---

*Filed by: Claude (Builder, state layer, 2026-03-19)*
