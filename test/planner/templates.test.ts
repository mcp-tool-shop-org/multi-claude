import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_REGISTRY,
  getTemplate,
  suggestTemplate,
  validateTemplateMatch,
} from '../../src/planner/templates.js';

describe('Template Registry', () => {

  it('has 3 templates', () => {
    expect(TEMPLATE_REGISTRY.size).toBe(3);
  });

  it('getTemplate returns backend_law template', () => {
    const t = getTemplate('backend_law');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Backend Law');
    expect(t!.workClass).toBe('backend_state');
  });

  it('getTemplate returns ui_seam template', () => {
    const t = getTemplate('ui_seam');
    expect(t).toBeDefined();
    expect(t!.name).toBe('UI Seam');
    expect(t!.workClass).toBe('ui_interaction');
  });

  it('getTemplate returns control_plane template', () => {
    const t = getTemplate('control_plane');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Control Plane');
    expect(t!.workClass).toBe('control_plane');
  });

  it('getTemplate returns undefined for nonexistent id', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('suggestTemplate returns backend_law for backend_state', () => {
    const t = suggestTemplate('backend_state');
    expect(t).toBeDefined();
    expect(t!.id).toBe('backend_law');
  });

  it('suggestTemplate returns ui_seam for ui_interaction', () => {
    const t = suggestTemplate('ui_interaction');
    expect(t).toBeDefined();
    expect(t!.id).toBe('ui_seam');
  });

  it('suggestTemplate returns control_plane for control_plane', () => {
    const t = suggestTemplate('control_plane');
    expect(t).toBeDefined();
    expect(t!.id).toBe('control_plane');
  });

  it('suggestTemplate returns undefined for unknown work class', () => {
    expect(suggestTemplate('unknown')).toBeUndefined();
  });

  it('validateTemplateMatch warns when packet count is below template minimum', () => {
    const t = getTemplate('backend_law')!;
    const result = validateTemplateMatch(t, 2);
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('below template minimum');
  });

  it('validateTemplateMatch passes at or above template packet count', () => {
    const t = getTemplate('backend_law')!;
    const atCount = validateTemplateMatch(t, 4);
    expect(atCount.valid).toBe(true);
    expect(atCount.warnings).toHaveLength(0);

    const aboveCount = validateTemplateMatch(t, 6);
    expect(aboveCount.valid).toBe(true);
    expect(aboveCount.warnings).toHaveLength(0);
  });

  it('backend_law template has 2 waves with 2 packets each', () => {
    const t = getTemplate('backend_law')!;
    expect(t.waveStructure).toHaveLength(2);
    expect(t.waveStructure[0].packets).toHaveLength(2);
    expect(t.waveStructure[1].packets).toHaveLength(2);
    expect(t.waveStructure[0].parallel).toBe(true);
    expect(t.waveStructure[1].parallel).toBe(true);
  });

  it('ui_seam wave 1 has 1 packet (serial), wave 2 has 2 packets (parallel)', () => {
    const t = getTemplate('ui_seam')!;
    expect(t.waveStructure).toHaveLength(2);
    expect(t.waveStructure[0].packets).toHaveLength(1);
    expect(t.waveStructure[0].parallel).toBe(false);
    expect(t.waveStructure[1].packets).toHaveLength(2);
    expect(t.waveStructure[1].parallel).toBe(true);
  });

  it('control_plane template has law/wire coupling guard', () => {
    const t = getTemplate('control_plane')!;
    const hasLawWireGuard = t.couplingGuards.some(
      (g) => g.includes('defines law') && g.includes('wires orchestration'),
    );
    expect(hasLawWireGuard).toBe(true);
  });

  it('all templates have non-empty requiredGates', () => {
    for (const t of TEMPLATE_REGISTRY.values()) {
      expect(t.requiredGates.length).toBeGreaterThan(0);
    }
  });

  it('all templates have non-empty readinessChecks', () => {
    for (const t of TEMPLATE_REGISTRY.values()) {
      expect(t.readinessChecks.length).toBeGreaterThan(0);
    }
  });
});
