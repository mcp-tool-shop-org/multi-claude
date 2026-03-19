# Packet-Shaping Law

This document codifies the rules for packet boundaries, especially for UI-heavy work.
These rules come directly from Phase 6 findings where Wave 2 UI packets (16+ minutes each, 60+ tool uses) exceeded the playbook budget by 3x.

## The Core Rule

**Shape packets by seam ownership first, feature grouping second.**

A packet should own one coherent surface, not "everything needed for feature X."

## Packet Size Budget

| Packet class | Target duration | Hard ceiling | Max tool uses |
|---|---|---|---|
| state/domain | 2-5 min | 6 min | 30 |
| backend | 2-6 min | 8 min | 35 |
| ui-component | 3-6 min | 8 min | 40 |
| ui-interaction | 3-8 min | 10 min | 50 |
| verification | 5-10 min | 12 min | 40 |
| integration | 5-10 min | 12 min | 50 |
| docs/knowledge | 2-5 min | 6 min | 25 |

If a packet exceeds the hard ceiling in planning (based on scope assessment), split it.

## UI Packet Rules

### Rule 1: Separate layout from wiring
- **Layout packet**: component structure, JSX, CSS, visual appearance
- **Wiring packet**: store connections, command dispatch, event handlers, Tauri invoke calls

Do not combine these unless the total scope is clearly under budget.

### Rule 2: Separate tests from implementation
If the implementation packet is already at 5+ minutes expected, split tests into their own packet that depends on the implementation.

### Rule 3: One CSS owner per section
Shared CSS files (e.g., `workspace.css`) must have explicit section ownership:
- Header/toolbar styles → toolbar packet
- Panel layout styles → layout packet
- Canvas styles → canvas packet
- Inspector styles → inspector packet

If two packets need to edit the same CSS file, the seam file must be integrator-owned.

### Rule 4: Barrel/export files are seam files
`index.ts` files that re-export from multiple modules are seam files by default.
- Builders may add their own export line
- Builders may NOT reorganize existing exports
- Conflicting barrel changes are integrator-resolved

## Seam Ownership Rules

### Shared CSS
- If a CSS file is touched by more than one packet: it is a seam file
- Integrator owns the merge
- Builders produce CSS additions only, not reorganizations

### Barrel exports
- `packages/*/src/index.ts` are seam files
- Builders add their exports; integrator validates the final barrel

### Config files
- `vite.config.ts`, `vitest.config.ts`, `tsconfig.json` are operator-owned
- Builders do NOT modify these unless explicitly allowed in the packet

## Anti-patterns

### Unlawful: "Build the whole panel"
```
BAD: "Create Canvas component with zoom, pan, selection, marquee, overlays, and tests"
```
This is 3-4 packets crammed into one.

### Lawful split:
```
GOOD:
  1. Canvas layout + basic rendering (ui-component)
  2. Canvas interactions: zoom/pan (ui-interaction)
  3. Canvas interactions: selection/marquee (ui-interaction)
  4. Canvas tests (verification)
```

### Unlawful: "Wire everything"
```
BAD: "Connect inspector to stores, add all shortcuts, write CSS, mock Tauri, add tests"
```

### Lawful split:
```
GOOD:
  1. Inspector component + store wiring (ui-component)
  2. Keyboard shortcuts + command surface (ui-interaction)
  3. Component tests (depends on 1+2)
```

## Phase 6 Evidence

Wave 1 (lawful):
- SF5-101: 3.1 min, 20 tool uses — viewport state/domain work
- SF5-102: 4.4 min, 25 tool uses — selection state/domain work

Wave 2 (unlawful):
- SF5-103: 16.4 min, 60+ tool uses — canvas layout + interactions + CSS + tests
- SF5-104: 15.7 min, 60+ tool uses — inspector + shortcuts + CSS + tests

The Wave 2 packets should have been 4-6 smaller packets, not 2 large ones.

## Enforcement

Before launching a UI packet:
1. Count distinct concerns (layout, wiring, CSS, tests, mocks)
2. If concerns > 2, split the packet
3. If expected duration > budget ceiling, split the packet
4. If the packet touches a seam file, declare it explicitly

This law is enforced at packet creation time, not at submission time.
