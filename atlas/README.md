# multi-claude: how it works

Mapped at 2026-09-24 from commit 9d36a21.

## What this is

11 parts, mostly TypeScript (328 files). Work enters through 3 doors; the busiest is CI, which reaches 3 parts. People run multi-claude.

## What changed since the last map

This is the first map.

## What comes in

1. **CI.** On a pull request touching 12 paths; on a push touching 12 paths; or by hand. Runs test/claim.test.ts, test/commands/, test/console/ and 39 more; checks bin/ and src/.
2. **Deploy site to GitHub Pages.** On a push to main touching 2 paths; or by hand. Runs site/astro.config.mjs and site/src/.
3. **multi-claude** (a command people run). Runs bin/multi-claude.ts.

## What happens through CI

1. The workflow runs 69 files in test; it checks bin/ in bin and src/ in src.

## Who reads the results

CI writes nothing this map can see.

## The other doors

**Deploy site to GitHub Pages** runs site/astro.config.mjs and site/src/, and deploys the site.

**multi-claude** (a command people run) runs bin/multi-claude.ts, reaches src, and runs git.

## What breaks what

- **src** is imported by 1 part (bin), and by 1 more only from tests; it sits on the path of 2 doors.
- **bin** is imported by no other part and sits on the path of 2 doors.

## What tends to change together

No two source files changed together often enough to name.

Window: 180 days; a pair counts from 3 shared commits, since the window holds fewer than 30 qualifying commits.

## What no test touches

- **bin** is imported by no test.
- **control-plane-monitor** is imported by no test.

## Written but never read

No place this map can see is written, so none goes unread.

## Helpers that look duplicated

No two parts export a helper that looks alike.

## Generated, never hand-edited

Nothing in this repository writes to a tracked place this map can see.

## Hand-authored

People write .claude/, .github/, .multi-claude/, docs/, reports/, the repository root and site/; 3 writes with paths built at run time may land here.

## Where to start

.github/workflows/ci.yml → src/commands/claim.ts

Read those in order to follow one pull request end to end.

## What this map cannot see

- 3 writes and 5 reads use paths built at run time and are not named here.
- 2 writes go to places this repository does not track, so they are not listed as generated.
- 3 writes and 129 reads go to the directory the command is run in, the home directory or a path its caller passes, not to this repository.
- 1 command is built at run time and not followed.
- Statistics confidence is low: fewer than 30 qualifying commits in the window, and fewer than 20 source files reach 10 revisions.

Regenerate with `npx --yes @dogfood-lab/atlas map`.
