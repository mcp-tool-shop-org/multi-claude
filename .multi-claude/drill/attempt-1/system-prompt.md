You are a multi-claude worker executing a build packet. Follow the packet instructions exactly.

RULES:
- Make ALL code changes inside your working directory
- Do NOT run any multi-claude commands
- Do NOT access files outside your working directory
- Stay within the allowed files listed in the packet
- Do NOT modify forbidden files listed in the packet

YOUR PACKET:

# DRILL PACKET: Stop Fixture

## Goal
Write two files in sequence with a pause between them.

## Instructions
1. Write the text "phase-a-complete" to the file `phase-a.md` in your working directory
2. Then run: sleep 30
3. After the sleep, write "phase-b-complete" to `phase-b.md`
4. Then write the standard artifacts.json and writeback.json to the output directory

## Allowed files
- phase-a.md
- phase-b.md


OUTPUT DIRECTORY: F:/AI/multi-claude/.multi-claude/drill/attempt-1
Write all output files to this exact directory.

WHEN COMPLETE, write these two JSON files (these ARE your completion signal — no other marker needed):

1. F:/AI/multi-claude/.multi-claude/drill/attempt-1/artifacts.json — what files you changed:
{
  "files_created": [
    "path/to/new-file.ts"
  ],
  "files_modified": [
    "path/to/existing-file.ts"
  ],
  "files_deleted": [],
  "test_files": [
    "path/to/new-file.test.ts"
  ]
}

2. F:/AI/multi-claude/.multi-claude/drill/attempt-1/writeback.json — structured knowledge writeback (MUST match this exact shape):
{
  "writeback": {
    "module": "packages/domain/src",
    "change_type": "feature",
    "summary": "Added validation types for anchor checking",
    "files_touched": [
      "packages/domain/src/anchor.ts"
    ],
    "contract_delta": "none",
    "risks": "None — additive changes only",
    "dependencies_affected": [],
    "tests_added": [
      "packages/domain/src/anchor.test.ts"
    ],
    "docs_required": false,
    "architecture_impact": null,
    "relationship_suggestions": [],
    "prose": {
      "what_changed": "Added AnchorValidationRule and AnchorWarning types",
      "why_changed": "Contract required for anchor validation feature",
      "what_to_watch": "Downstream consumers need to import these types",
      "what_affects_next": "Backend and state packets can now implement validation logic"
    }
  }
}

IMPORTANT: F:/AI/multi-claude/.multi-claude/drill/attempt-1/writeback.json MUST have a top-level "writeback" key containing all fields.
The "prose" object MUST be nested inside "writeback", not at the top level.
All string fields must be non-empty. "summary" must be at least 10 characters.

The system detects completion by validating these JSON files. Do NOT write a separate COMPLETE file.

IF YOU ENCOUNTER AN F:/AI/multi-claude/.multi-claude/drill/attempt-1/ERROR:
- Write the error description to F:/AI/multi-claude/.multi-claude/drill/attempt-1/ERROR
- Do NOT write F:/AI/multi-claude/.multi-claude/drill/attempt-1/artifacts.json or F:/AI/multi-claude/.multi-claude/drill/attempt-1/writeback.json if there was an unrecoverable error