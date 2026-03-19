import { describe, it, expect } from 'vitest';
import {
  validateRunPlan,
  validateRunBlueprint,
  computeFreezeHash,
  type RunPlan,
  type RunBlueprint,
} from '../../src/planner/schema.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<RunPlan> = {}): RunPlan {
  return {
    id: 'plan-001',
    createdAt: '2026-03-19T00:00:00Z',
    version: 1,
    input: {
      workClass: 'greenfield',
      packetCount: 4,
      couplingLevel: 'low',
      ownershipClarity: 'clear',
      repoStability: 'stable',
      objectivePriority: 'correctness',
    },
    assessment: {
      mode: 'parallel',
      fitLevel: 'strong',
      predictedGradeRange: ['A', 'B+'],
      breakEvenEstimate: 3,
      reasons: ['clear seams'],
      warnings: [],
      suggestedTemplate: 'greenfield-4',
    },
    frozen: false,
    ...overrides,
  };
}

function makeBlueprint(overrides: Partial<RunBlueprint> = {}): RunBlueprint {
  return {
    id: 'bp-001',
    planId: 'plan-001',
    createdAt: '2026-03-19T00:00:00Z',
    version: 1,
    templateId: 'greenfield-4',
    workClass: 'greenfield',
    repoRoot: '/f/AI/test-repo',
    waves: [
      {
        wave: 1,
        packets: [
          {
            packetId: 'pkt-1a',
            label: 'Schema types',
            role: 'builder',
            packetClass: 'implementation',
            allowedFiles: ['src/types.ts'],
            forbiddenFiles: ['src/index.ts'],
            budgetMinutes: [15, 30],
            ceilingMinutes: 45,
            dependsOn: [],
          },
          {
            packetId: 'pkt-1b',
            label: 'Util helpers',
            role: 'builder',
            packetClass: 'implementation',
            allowedFiles: ['src/utils.ts'],
            forbiddenFiles: [],
            budgetMinutes: [10, 20],
            ceilingMinutes: 30,
            dependsOn: [],
          },
        ],
      },
      {
        wave: 2,
        packets: [
          {
            packetId: 'pkt-2a',
            label: 'Integration',
            role: 'integrator',
            packetClass: 'integration',
            allowedFiles: ['src/index.ts'],
            forbiddenFiles: [],
            budgetMinutes: [20, 40],
            ceilingMinutes: 60,
            dependsOn: ['pkt-1a', 'pkt-1b'],
          },
        ],
      },
    ],
    couplingGuards: [{ rule: 'no cross-wave imports', enforcedBy: 'verifier' }],
    verifierChecklist: [{ id: 'ck-1', description: 'types compile', required: true }],
    humanGates: [{ afterWave: 1, gateType: 'review', description: 'check wave 1 output' }],
    readinessResult: { ready: true, failures: [], warnings: [] },
    frozen: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RunPlan validation
// ---------------------------------------------------------------------------

describe('validateRunPlan', () => {
  it('accepts a valid RunPlan', () => {
    const result = validateRunPlan(makePlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects plan missing id', () => {
    const result = validateRunPlan(makePlan({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('rejects plan with non-positive version', () => {
    const result = validateRunPlan(makePlan({ version: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  it('rejects plan with non-boolean frozen', () => {
    const plan = { ...makePlan(), frozen: 'yes' };
    const result = validateRunPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('frozen'))).toBe(true);
  });

  it('rejects non-object input', () => {
    const result = validateRunPlan('not-an-object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('plan must be an object');
  });
});

// ---------------------------------------------------------------------------
// RunBlueprint validation
// ---------------------------------------------------------------------------

describe('validateRunBlueprint', () => {
  it('accepts a valid RunBlueprint', () => {
    const result = validateRunBlueprint(makeBlueprint());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects blueprint with empty waves', () => {
    const result = validateRunBlueprint(makeBlueprint({ waves: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('waves'))).toBe(true);
  });

  it('rejects blueprint with overlapping files in same wave', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[1]!.allowedFiles = ['src/types.ts']; // overlap with pkt-1a
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('file overlap'))).toBe(true);
  });

  it('rejects blueprint with same-wave dependency', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[1]!.dependsOn = ['pkt-1a']; // same wave
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('must be earlier'))).toBe(true);
  });

  it('rejects blueprint with later-wave dependency', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[0]!.dependsOn = ['pkt-2a']; // later wave
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('must be earlier'))).toBe(true);
  });

  it('rejects blueprint with empty verifierChecklist', () => {
    const result = validateRunBlueprint(makeBlueprint({ verifierChecklist: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('verifierChecklist'))).toBe(true);
  });

  it('rejects blueprint with empty humanGates', () => {
    const result = validateRunBlueprint(makeBlueprint({ humanGates: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('humanGates'))).toBe(true);
  });

  it('rejects blueprint with empty couplingGuards', () => {
    const result = validateRunBlueprint(makeBlueprint({ couplingGuards: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('couplingGuards'))).toBe(true);
  });

  it('rejects packet with empty allowedFiles', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[0]!.allowedFiles = [];
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-empty allowedFiles'))).toBe(true);
  });

  it('rejects packet with ceilingMinutes < budget max', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[0]!.ceilingMinutes = 20; // less than budgetMinutes[1]=30
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('ceilingMinutes'))).toBe(true);
  });

  it('rejects blueprint with duplicate packetIds', () => {
    const bp = makeBlueprint();
    bp.waves[0]!.packets[1]!.packetId = 'pkt-1a'; // duplicate
    bp.waves[0]!.packets[1]!.allowedFiles = ['src/other.ts']; // avoid file overlap noise
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('duplicate packetId'))).toBe(true);
  });

  it('accepts wave-1 packets with no dependencies', () => {
    const bp = makeBlueprint();
    // wave 1 packets already have empty dependsOn
    const result = validateRunBlueprint(bp);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeFreezeHash
// ---------------------------------------------------------------------------

describe('computeFreezeHash', () => {
  it('returns deterministic hash', () => {
    const bp = makeBlueprint();
    const h1 = computeFreezeHash(bp);
    const h2 = computeFreezeHash(bp);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when content changes', () => {
    const bp1 = makeBlueprint();
    const bp2 = makeBlueprint({ id: 'bp-002' });
    expect(computeFreezeHash(bp1)).not.toBe(computeFreezeHash(bp2));
  });

  it('ignores frozenHash field', () => {
    const bp1 = makeBlueprint();
    const bp2 = makeBlueprint({ frozenHash: 'abc123' });
    expect(computeFreezeHash(bp1)).toBe(computeFreezeHash(bp2));
  });
});
