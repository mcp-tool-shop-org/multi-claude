import { describe, it, expect } from 'vitest';
import { evaluateRun, overridePlan, freezePlan } from '../../src/planner/service.js';
import { validateRunPlan } from '../../src/planner/schema.js';
import type { PlannerInput } from '../../src/planner/types.js';

function makeInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    workClass: 'backend_state',
    packetCount: 5,
    couplingLevel: 'low',
    ownershipClarity: 'clear',
    repoStability: 'stable',
    objectivePriority: 'balanced',
    ...overrides,
  };
}

describe('Planner Service', () => {

  describe('evaluateRun', () => {

    it('backend work produces multi_claude recommendation', () => {
      const plan = evaluateRun(makeInput());
      expect(plan.assessment.mode).toBe('multi_claude');
      expect(plan.assessment.fitLevel).toBe('strong');
    });

    it('UI + 3 packets produces single_claude recommendation', () => {
      const plan = evaluateRun(makeInput({
        workClass: 'ui_interaction',
        packetCount: 3,
        couplingLevel: 'low',
        ownershipClarity: 'clear',
        repoStability: 'stable',
      }));
      expect(plan.assessment.mode).toBe('single_claude');
    });

    it('control-plane produces assessment with warnings', () => {
      const plan = evaluateRun(makeInput({
        workClass: 'control_plane',
        packetCount: 3,
        couplingLevel: 'low',
        ownershipClarity: 'clear',
        repoStability: 'stable',
      }));
      expect(plan.assessment.warnings.length).toBeGreaterThan(0);
      const ids = plan.assessment.warnings.map(w => w.id);
      expect(ids).toContain('CONTROL_PLANE_COUPLING_TAX');
    });

    it('produces non-empty reasons', () => {
      const plan = evaluateRun(makeInput());
      expect(plan.assessment.reasons.length).toBeGreaterThan(0);
    });

    it('suggests correct template for backend work', () => {
      const plan = evaluateRun(makeInput());
      expect(plan.assessment.suggestedTemplate).toBe('backend_law');
    });

    it('suggests null template when single_claude', () => {
      const plan = evaluateRun(makeInput({ packetCount: 2 }));
      expect(plan.assessment.mode).toBe('single_claude');
      expect(plan.assessment.suggestedTemplate).toBeNull();
    });

    it('produces a valid RunPlan per schema validation', () => {
      const plan = evaluateRun(makeInput());
      const result = validateRunPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('has valid id and createdAt', () => {
      const plan = evaluateRun(makeInput());
      expect(plan.id).toMatch(/^plan-[a-f0-9]{16}$/);
      expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  describe('overridePlan', () => {

    it('adds rationale to a non-frozen plan', () => {
      const plan = evaluateRun(makeInput());
      const overridden = overridePlan(plan, 'User override: ship fast');
      expect(overridden.overrideRationale).toBe('User override: ship fast');
      expect(overridden.frozen).toBe(false);
    });

    it('throws on frozen plan', () => {
      const plan = evaluateRun(makeInput());
      const frozen = freezePlan(plan);
      expect(() => overridePlan(frozen, 'too late')).toThrow('Cannot override a frozen plan');
    });
  });

  describe('freezePlan', () => {

    it('sets frozen to true', () => {
      const plan = evaluateRun(makeInput());
      expect(plan.frozen).toBe(false);
      const frozen = freezePlan(plan);
      expect(frozen.frozen).toBe(true);
    });

    it('throws on already frozen plan', () => {
      const plan = evaluateRun(makeInput());
      const frozen = freezePlan(plan);
      expect(() => freezePlan(frozen)).toThrow('Plan is already frozen');
    });
  });
});
