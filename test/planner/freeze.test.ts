import { describe, it, expect } from 'vitest';
import {
  initBlueprint,
  validateBlueprint,
  freezeBlueprint,
  renderContractFreeze,
} from '../../src/planner/freeze.js';
import type { RunPlan, RunBlueprint, PacketDefinition } from '../../src/planner/schema.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(templateId: string): RunPlan {
  return {
    id: 'plan-test-001',
    createdAt: '2026-03-19T00:00:00Z',
    version: 1,
    input: {
      workClass: 'backend_state',
      packetCount: 4,
      couplingLevel: 'moderate',
      ownershipClarity: 'clear',
      repoStability: 'stable',
      objectivePriority: 'quality',
    },
    assessment: {
      mode: 'multi_claude',
      fitLevel: 'strong',
      predictedGradeRange: ['B+', 'A-'],
      breakEvenEstimate: 3,
      reasons: ['Good separation'],
      warnings: [],
      suggestedTemplate: templateId,
    },
    frozen: true,
  };
}

/** Fill all packets with unique allowedFiles so validation passes */
function fillAllowedFiles(bp: RunBlueprint): RunBlueprint {
  let idx = 0;
  for (const wave of bp.waves) {
    for (const pkt of wave.packets) {
      pkt.allowedFiles = [`src/module-${String(idx)}.ts`];
      idx++;
    }
  }
  return bp;
}

// ---------------------------------------------------------------------------
// initBlueprint
// ---------------------------------------------------------------------------

describe('initBlueprint', () => {
  it('creates valid structure from backend_law template', () => {
    const bp = initBlueprint(makePlan('backend_law'), '/repo');
    expect(bp.templateId).toBe('backend_law');
    expect(bp.workClass).toBe('backend_state');
    expect(bp.repoRoot).toBe('/repo');
    expect(bp.waves.length).toBe(2);
    expect(bp.frozen).toBe(false);
    expect(bp.version).toBe(1);
    expect(bp.planId).toBe('plan-test-001');
  });

  it('creates wave 1 serial + wave 2 parallel from ui_seam template', () => {
    const plan = makePlan('ui_seam');
    plan.input.workClass = 'ui_interaction';
    const bp = initBlueprint(plan, '/repo');
    expect(bp.waves.length).toBe(2);
    // Wave 1: 1 serial packet
    expect(bp.waves[0].packets.length).toBe(1);
    expect(bp.waves[0].packets[0].label).toBe('Domain/State Floor');
    // Wave 2: 2 parallel packets
    expect(bp.waves[1].packets.length).toBe(2);
  });

  it('creates coupling guards from control_plane template', () => {
    const bp = initBlueprint(makePlan('control_plane'), '/repo');
    expect(bp.couplingGuards.length).toBe(3);
    expect(bp.couplingGuards[0].rule).toBe('No packet both defines law and wires orchestration');
    expect(bp.couplingGuards[0].enforcedBy).toBe('both');
  });

  it('throws for unknown template', () => {
    expect(() => initBlueprint(makePlan('nonexistent'), '/repo')).toThrow('Unknown template');
  });

  it('throws when plan has no suggestedTemplate', () => {
    const plan = makePlan('backend_law');
    plan.assessment.suggestedTemplate = null;
    expect(() => initBlueprint(plan, '/repo')).toThrow('no suggestedTemplate');
  });

  it('wave 2 packets depend on all wave 1 packets', () => {
    const bp = initBlueprint(makePlan('backend_law'), '/repo');
    const wave1Ids = bp.waves[0].packets.map((p) => p.packetId);
    expect(wave1Ids.length).toBeGreaterThan(0);
    for (const pkt of bp.waves[1].packets) {
      expect(pkt.dependsOn).toEqual(wave1Ids);
    }
  });

  it('wave 1 packets have no dependencies', () => {
    const bp = initBlueprint(makePlan('backend_law'), '/repo');
    for (const pkt of bp.waves[0].packets) {
      expect(pkt.dependsOn).toEqual([]);
    }
  });

  it('applies packet overrides by index', () => {
    const overrides: Partial<PacketDefinition>[] = [
      { allowedFiles: ['src/core.ts'], forbiddenFiles: ['src/ui.ts'] },
    ];
    const bp = initBlueprint(makePlan('backend_law'), '/repo', overrides);
    expect(bp.waves[0].packets[0].allowedFiles).toEqual(['src/core.ts']);
    expect(bp.waves[0].packets[0].forbiddenFiles).toEqual(['src/ui.ts']);
  });
});

// ---------------------------------------------------------------------------
// validateBlueprint
// ---------------------------------------------------------------------------

describe('validateBlueprint', () => {
  it('catches empty allowedFiles as warnings', () => {
    const bp = initBlueprint(makePlan('backend_law'), '/repo');
    const result = validateBlueprint(bp);
    expect(result.ready).toBe(false);
    // Should have warnings about empty allowedFiles
    const fileWarnings = result.warnings.filter((w) => w.includes('allowedFiles'));
    expect(fileWarnings.length).toBeGreaterThan(0);
  });

  it('passes with complete blueprint', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const result = validateBlueprint(bp);
    expect(result.ready).toBe(true);
    expect(result.failures.length).toBe(0);
    expect(result.warnings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// freezeBlueprint
// ---------------------------------------------------------------------------

describe('freezeBlueprint', () => {
  it('sets hash and timestamp on valid blueprint', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const frozen = freezeBlueprint(bp);
    expect(frozen.frozen).toBe(true);
    expect(frozen.frozenAt).toBeDefined();
    expect(frozen.frozenHash).toBeDefined();
  });

  it('throws if not ready (missing allowedFiles)', () => {
    const bp = initBlueprint(makePlan('backend_law'), '/repo');
    expect(() => freezeBlueprint(bp)).toThrow('not ready to freeze');
  });

  it('frozenHash is a hex string', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const frozen = freezeBlueprint(bp);
    expect(frozen.frozenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// renderContractFreeze
// ---------------------------------------------------------------------------

describe('renderContractFreeze', () => {
  it('produces non-empty markdown', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const md = renderContractFreeze(bp);
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('# Contract Freeze');
  });

  it('contains packet sections', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const md = renderContractFreeze(bp);
    expect(md).toContain('Invariant/Core');
    expect(md).toContain('Boundary/Guardrails');
    expect(md).toContain('Adversarial Tests');
    expect(md).toContain('Integration/Plugin');
  });

  it('contains coupling guards and verifier checklist', () => {
    const bp = fillAllowedFiles(initBlueprint(makePlan('backend_law'), '/repo'));
    const md = renderContractFreeze(bp);
    expect(md).toContain('## Coupling Guards');
    expect(md).toContain('## Verifier Checklist');
    expect(md).toContain('## Human Gates');
  });
});
