import { describe, it, expect } from 'vitest';
import { METRIC_REGISTRY, validateRegistryWeights, getMetricsByBucket, getMetric } from '../../src/fitness/metrics.js';
import { SCORE_WEIGHTS, MATURATION, PACKET_CLASS_BUDGETS } from '../../src/fitness/types.js';

describe('Fitness Constitution', () => {

  it('score weights sum to 100', () => {
    const total = SCORE_WEIGHTS.quality + SCORE_WEIGHTS.lawfulness + SCORE_WEIGHTS.collaboration + SCORE_WEIGHTS.velocity;
    expect(total).toBe(100);
  });

  it('maturation shares sum to 1.0', () => {
    const total = MATURATION.submit + MATURATION.verify + MATURATION.integrate;
    expect(total).toBeCloseTo(1.0);
  });

  it('submit is smallest maturation share', () => {
    expect(MATURATION.submit).toBeLessThan(MATURATION.verify);
    expect(MATURATION.verify).toBeLessThan(MATURATION.integrate);
  });

  it('integrate is 50% of maturation (anti-rush)', () => {
    expect(MATURATION.integrate).toBe(0.50);
  });
});

describe('Metric Registry', () => {

  it('has 19 metrics', () => {
    expect(METRIC_REGISTRY.length).toBe(19);
  });

  it('weights are valid per bucket', () => {
    const result = validateRegistryWeights();
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('quality metrics sum to 40', () => {
    const metrics = getMetricsByBucket('quality');
    const sum = metrics.reduce((s, m) => s + m.weight, 0);
    expect(sum).toBe(40);
  });

  it('lawfulness metrics sum to 25', () => {
    const metrics = getMetricsByBucket('lawfulness');
    const sum = metrics.reduce((s, m) => s + m.weight, 0);
    expect(sum).toBe(25);
  });

  it('collaboration metrics sum to 20', () => {
    const metrics = getMetricsByBucket('collaboration');
    const sum = metrics.reduce((s, m) => s + m.weight, 0);
    expect(sum).toBe(20);
  });

  it('velocity metrics sum to 15', () => {
    const metrics = getMetricsByBucket('velocity');
    const sum = metrics.reduce((s, m) => s + m.weight, 0);
    expect(sum).toBe(15);
  });

  it('every metric has required fields', () => {
    for (const m of METRIC_REGISTRY) {
      expect(m.key).toBeTruthy();
      expect(m.bucket).toBeTruthy();
      expect(m.weight).toBeGreaterThan(0);
      expect(m.description).toBeTruthy();
      expect(m.formula).toBeTruthy();
      expect(m.source).toBeTruthy();
      expect(['higher_better', 'lower_better']).toContain(m.direction);
      expect(m.gamingRisk).toBeTruthy();
    }
  });

  it('getMetric returns correct metric', () => {
    const m = getMetric('verified_completion_rate');
    expect(m).toBeDefined();
    expect(m!.bucket).toBe('quality');
    expect(m!.weight).toBe(12);
  });

  it('getMetric returns undefined for unknown key', () => {
    expect(getMetric('nonexistent')).toBeUndefined();
  });
});

describe('Packet Class Budgets', () => {

  it('all classes have min < max', () => {
    for (const [cls, [min, max]] of Object.entries(PACKET_CLASS_BUDGETS)) {
      expect(min).toBeLessThan(max);
    }
  });

  it('UI classes have higher budgets than state/domain', () => {
    const [, stateMax] = PACKET_CLASS_BUDGETS.state_domain;
    const [, uiMax] = PACKET_CLASS_BUDGETS.ui_interaction;
    expect(uiMax).toBeGreaterThan(stateMax);
  });

  it('velocity is the smallest score weight (anti-rush)', () => {
    expect(SCORE_WEIGHTS.velocity).toBeLessThan(SCORE_WEIGHTS.quality);
    expect(SCORE_WEIGHTS.velocity).toBeLessThan(SCORE_WEIGHTS.lawfulness);
    expect(SCORE_WEIGHTS.velocity).toBeLessThan(SCORE_WEIGHTS.collaboration);
  });
});
