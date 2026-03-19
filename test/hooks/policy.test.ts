import { describe, it, expect } from 'vitest';
import type { HookEventPayload } from '../../src/hooks/events.js';
import type { EvaluatedConditions } from '../../src/hooks/conditions.js';
import { evaluatePolicy, POLICY_RULES } from '../../src/hooks/policy.js';

function makeEvent(event: string, entityId: string = 'test-packet', featureId: string = 'test-feature'): HookEventPayload {
  return { event: event as HookEventPayload['event'], entityType: 'packet', entityId, featureId, timestamp: new Date().toISOString() };
}

function makeConditions(overrides: Partial<EvaluatedConditions> = {}): EvaluatedConditions {
  return {
    claimableCount: 0,
    claimablePackets: [],
    fileOverlap: false,
    hasProtectedFiles: false,
    hasSeamFiles: false,
    criticalPathDepth: 3,
    graphDepth: 3,
    phaseType: 'subsystem',
    verifiedCount: 0,
    totalPackets: 5,
    activeWorkers: 0,
    allPacketsVerified: false,
    allPromotionsComplete: false,
    hasMergeApproval: false,
    retryCount: 0,
    docsEligible: false,
    ...overrides,
  };
}

describe('Policy Rules', () => {
  it('has 10 rules defined', () => {
    expect(POLICY_RULES.length).toBe(10);
  });

  describe('Rule 1: Auto-launch parallel wave', () => {
    it('fires when 2+ claimable packets with no overlap', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ claimableCount: 3, claimablePackets: ['a', 'b', 'c'] });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('launch_workers');
      expect(result!.decision.packets).toEqual(['a', 'b', 'c']);
    });

    it('does not fire with only 1 claimable packet', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ claimableCount: 1, claimablePackets: ['a'] });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });

    it('does not fire when file overlap exists', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ claimableCount: 2, claimablePackets: ['a', 'b'], fileOverlap: true });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });

    it('does not fire for scaffold phase', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ claimableCount: 2, claimablePackets: ['a', 'b'], phaseType: 'scaffold' });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });

    it('does not fire when protected files involved', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ claimableCount: 2, claimablePackets: ['a', 'b'], hasProtectedFiles: true });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });
  });

  describe('Rule 2: Stay single on foundation', () => {
    it('fires for scaffold phase type', () => {
      const event = makeEvent('feature.approved');
      const cond = makeConditions({ phaseType: 'scaffold' });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('stay_single');
    });

    it('fires when critical path <= 2', () => {
      const event = makeEvent('feature.approved');
      const cond = makeConditions({ criticalPathDepth: 2, phaseType: 'subsystem' });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('stay_single');
    });

    it('does not fire for subsystem with deep graph', () => {
      const event = makeEvent('feature.approved');
      const cond = makeConditions({ criticalPathDepth: 4, phaseType: 'subsystem' });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });
  });

  describe('Rule 3: Auto-launch docs', () => {
    it('fires when docs eligible', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ docsEligible: true, verifiedCount: 4 });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('launch_docs');
    });

    it('does not fire when docs not eligible', () => {
      const event = makeEvent('packet.verified');
      const cond = makeConditions({ docsEligible: false });
      // With 0 claimable, rule 1 won't match either
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });
  });

  describe('Rule 4: Failure handling', () => {
    it('retries on first deterministic failure', () => {
      const event = makeEvent('packet.failed', 'broken-packet');
      const cond = makeConditions({ failureClass: 'deterministic', retryCount: 0 });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('retry_once');
    });

    it('launches verifier-analysis after retry', () => {
      const event = makeEvent('packet.failed', 'broken-packet');
      const cond = makeConditions({ failureClass: 'deterministic', retryCount: 2 });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('launch_verifier');
      expect(result!.decision.role).toBe('verifier-analysis');
    });
  });

  describe('Rule 5: Integration pause', () => {
    it('pauses when all verified and promoted', () => {
      const event = makeEvent('integration.ready');
      const cond = makeConditions({ allPacketsVerified: true, allPromotionsComplete: true });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('pause_human_gate');
      expect(result!.decision.requiresHumanApproval).toBe(true);
    });
  });

  describe('Rule 6: Resume after approval', () => {
    it('resumes when merge approved', () => {
      const event = makeEvent('approval.recorded');
      const cond = makeConditions({ hasMergeApproval: true, allPacketsVerified: true });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('resume_integration');
    });
  });

  describe('Rule 7: Stall detection', () => {
    it('surfaces blocker when stalled', () => {
      const event = makeEvent('queue.stalled');
      const cond = makeConditions({ claimableCount: 0, activeWorkers: 0 });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('surface_blocker');
    });

    it('does not fire when workers active', () => {
      const event = makeEvent('queue.stalled');
      const cond = makeConditions({ claimableCount: 0, activeWorkers: 2 });
      const result = evaluatePolicy(event, cond);
      expect(result).toBeNull();
    });
  });

  describe('Rule 8: Scope violation', () => {
    it('escalates on scope violation', () => {
      const event = makeEvent('packet.failed', 'bad-packet');
      const cond = makeConditions({ failureClass: 'scope_violation' });
      const result = evaluatePolicy(event, cond);
      expect(result).not.toBeNull();
      expect(result!.decision.action).toBe('escalate');
    });
  });
});
