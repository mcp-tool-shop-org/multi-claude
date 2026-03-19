import { describe, it, expect } from 'vitest';
import { assessFit, detectAntiPatterns, explainRecommendation, BREAK_EVEN } from '../../src/planner/rules.js';
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

describe('Planner Rule Engine', () => {

  describe('assessFit', () => {

    it('backend + 5 packets + clear ownership -> multi_claude, strong', () => {
      const result = assessFit(makeInput());
      expect(result.mode).toBe('multi_claude');
      expect(result.fitLevel).toBe('strong');
      expect(result.suggestedTemplate).toBe('backend_law');
    });

    it('backend + 2 packets -> single_claude (below break-even, blocker)', () => {
      const result = assessFit(makeInput({ packetCount: 2 }));
      expect(result.mode).toBe('single_claude');
      expect(result.fitLevel).toBe('weak');
      expect(result.suggestedTemplate).toBeNull();
    });

    it('backend + 3 packets (at break-even) + clear -> multi_claude', () => {
      const result = assessFit(makeInput({ packetCount: 3 }));
      expect(result.mode).toBe('multi_claude');
      expect(result.fitLevel).toBe('strong');
    });

    it('backend + 1 packet -> single_claude, block warning', () => {
      const result = assessFit(makeInput({ packetCount: 1 }));
      expect(result.mode).toBe('single_claude');
      expect(result.warnings.some(w => w.id === 'TOO_FEW_PACKETS' && w.severity === 'block')).toBe(true);
    });

    it('ui + 3 packets + high coupling -> single_claude, weak', () => {
      const result = assessFit(makeInput({
        workClass: 'ui_interaction',
        packetCount: 3,
        couplingLevel: 'high',
      }));
      expect(result.mode).toBe('single_claude');
      expect(result.fitLevel).toBe('weak');
    });

    it('ui + 6 packets + clear -> multi_claude_cautious, moderate', () => {
      // UI base=moderate, above break-even -> upgrade to strong, BUT
      // wait: base moderate(1) + above breakeven(+1) = strong(2) -> multi_claude
      // Actually let's check: ui base is moderate(1), 6 > 5 -> +1 = strong(2)
      // coupling low -> no change, ownership clear -> no change, stable -> no change
      // Result: strong -> multi_claude
      const result = assessFit(makeInput({
        workClass: 'ui_interaction',
        packetCount: 6,
        ownershipClarity: 'clear',
      }));
      expect(result.mode).toBe('multi_claude');
      expect(result.fitLevel).toBe('strong');
    });

    it('ui + 5 packets (at break-even) + clear -> multi_claude_cautious, moderate', () => {
      const result = assessFit(makeInput({
        workClass: 'ui_interaction',
        packetCount: 5,
        ownershipClarity: 'clear',
      }));
      expect(result.mode).toBe('multi_claude_cautious');
      expect(result.fitLevel).toBe('moderate');
    });

    it('control_plane + 6 packets + moderate coupling -> multi_claude_cautious', () => {
      const result = assessFit(makeInput({
        workClass: 'control_plane',
        packetCount: 6,
        couplingLevel: 'moderate',
      }));
      // base moderate(1), above breakeven(+1)=strong(2), moderate coupling -> no change
      // -> strong -> multi_claude
      expect(result.mode).toBe('multi_claude');
      expect(result.fitLevel).toBe('strong');
    });

    it('control_plane + 6 packets + high coupling -> multi_claude_cautious', () => {
      const result = assessFit(makeInput({
        workClass: 'control_plane',
        packetCount: 6,
        couplingLevel: 'high',
      }));
      // base moderate(1), above breakeven(+1)=strong(2), high coupling(-1)=moderate(1)
      expect(result.mode).toBe('multi_claude_cautious');
      expect(result.fitLevel).toBe('moderate');
    });

    it('control_plane + 3 packets + high coupling -> single_claude, block', () => {
      const result = assessFit(makeInput({
        workClass: 'control_plane',
        packetCount: 3,
        couplingLevel: 'high',
      }));
      expect(result.mode).toBe('single_claude');
      expect(result.fitLevel).toBe('weak');
      expect(result.warnings.some(w => w.id === 'HIGH_COUPLING_LOW_PACKETS' && w.severity === 'block')).toBe(true);
    });

    it('unstable repo -> single_claude always, regardless of other factors', () => {
      const result = assessFit(makeInput({
        packetCount: 10,
        couplingLevel: 'low',
        ownershipClarity: 'clear',
        repoStability: 'unstable',
      }));
      expect(result.mode).toBe('single_claude');
      expect(result.fitLevel).toBe('weak');
    });

    it('settling repo caps at cautious', () => {
      const result = assessFit(makeInput({
        packetCount: 10,
        repoStability: 'settling',
      }));
      expect(result.mode).toBe('multi_claude_cautious');
      expect(result.fitLevel).toBe('moderate');
    });

    it('mixed ownership downgrades fit', () => {
      // backend base strong(2), 5 > 3 -> +1 = still 2 (capped), mixed -> -1 = moderate(1)
      const result = assessFit(makeInput({ ownershipClarity: 'mixed' }));
      expect(result.mode).toBe('multi_claude_cautious');
      expect(result.fitLevel).toBe('moderate');
    });

    it('unclear ownership downgrades fit', () => {
      const result = assessFit(makeInput({ ownershipClarity: 'unclear' }));
      expect(result.mode).toBe('multi_claude_cautious');
      expect(result.fitLevel).toBe('moderate');
    });

    it('predicted grade range matches fit level', () => {
      const strong = assessFit(makeInput());
      expect(strong.predictedGradeRange).toEqual(['A-', 'A+']);

      const moderate = assessFit(makeInput({ ownershipClarity: 'mixed' }));
      expect(moderate.predictedGradeRange).toEqual(['B', 'A-']);
    });

    it('break-even estimate matches work class constant', () => {
      const backend = assessFit(makeInput({ workClass: 'backend_state' }));
      expect(backend.breakEvenEstimate).toBe(3);

      const ui = assessFit(makeInput({ workClass: 'ui_interaction', packetCount: 6 }));
      expect(ui.breakEvenEstimate).toBe(5);

      const cp = assessFit(makeInput({ workClass: 'control_plane', packetCount: 6 }));
      expect(cp.breakEvenEstimate).toBe(5);
    });

    it('template suggestions match work class', () => {
      const backend = assessFit(makeInput());
      expect(backend.suggestedTemplate).toBe('backend_law');

      const ui = assessFit(makeInput({ workClass: 'ui_interaction', packetCount: 6 }));
      expect(ui.suggestedTemplate).toBe('ui_seam');

      const cp = assessFit(makeInput({ workClass: 'control_plane', packetCount: 6 }));
      expect(cp.suggestedTemplate).toBe('control_plane');
    });
  });

  describe('detectAntiPatterns', () => {

    it('packets <= 2 produces block', () => {
      const warnings = detectAntiPatterns(makeInput({ packetCount: 2 }));
      expect(warnings.some(w => w.id === 'TOO_FEW_PACKETS' && w.severity === 'block')).toBe(true);
    });

    it('packets below break-even produces warn (not block when > 2)', () => {
      const warnings = detectAntiPatterns(makeInput({
        workClass: 'ui_interaction',
        packetCount: 4,
      }));
      expect(warnings.some(w => w.id === 'BELOW_BREAK_EVEN' && w.severity === 'warn')).toBe(true);
      expect(warnings.some(w => w.id === 'TOO_FEW_PACKETS')).toBe(false);
    });

    it('unclear ownership produces warn', () => {
      const warnings = detectAntiPatterns(makeInput({ ownershipClarity: 'unclear' }));
      expect(warnings.some(w => w.id === 'UNCLEAR_OWNERSHIP')).toBe(true);
    });

    it('high seam density + mixed ownership produces warn', () => {
      const warnings = detectAntiPatterns(makeInput({
        seamDensity: 'high',
        ownershipClarity: 'mixed',
      }));
      expect(warnings.some(w => w.id === 'HIGH_SEAM_UNCLEAR_OWNERSHIP')).toBe(true);
    });

    it('unstable repo produces block', () => {
      const warnings = detectAntiPatterns(makeInput({ repoStability: 'unstable' }));
      expect(warnings.some(w => w.id === 'UNSTABLE_REPO' && w.severity === 'block')).toBe(true);
    });
  });

  describe('explainRecommendation', () => {

    it('returns non-empty explanation', () => {
      const assessment = assessFit(makeInput());
      const lines = explainRecommendation(assessment);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain('multi_claude');
    });

    it('includes warning details when present', () => {
      const assessment = assessFit(makeInput({ packetCount: 2 }));
      const lines = explainRecommendation(assessment);
      const text = lines.join('\n');
      expect(text).toContain('BLOCKER');
      expect(text).toContain('TOO_FEW_PACKETS');
    });

    it('includes template suggestion when applicable', () => {
      const assessment = assessFit(makeInput());
      const lines = explainRecommendation(assessment);
      const text = lines.join('\n');
      expect(text).toContain('backend_law');
    });
  });

  describe('BREAK_EVEN constants', () => {

    it('backend break-even is 3', () => {
      expect(BREAK_EVEN.backend_state).toBe(3);
    });

    it('ui break-even is 5', () => {
      expect(BREAK_EVEN.ui_interaction).toBe(5);
    });

    it('control_plane break-even is 5', () => {
      expect(BREAK_EVEN.control_plane).toBe(5);
    });
  });
});
