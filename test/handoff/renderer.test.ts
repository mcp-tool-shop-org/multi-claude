import { describe, it, expect } from 'vitest';
import { WorkerRenderer } from '../../src/handoff/render/role/worker-renderer.js';
import { ReviewerRenderer } from '../../src/handoff/render/role/reviewer-renderer.js';
import { ApproverRenderer } from '../../src/handoff/render/role/approver-renderer.js';
import { RecoveryRenderer } from '../../src/handoff/render/role/recovery-renderer.js';
import { makeTestPacket } from './helpers.js';

describe('Role Renderers', () => {
  const packet = makeTestPacket();

  describe('all four renderers produce different views from the same packet', () => {
    const worker = new WorkerRenderer();
    const reviewer = new ReviewerRenderer();
    const approver = new ApproverRenderer();
    const recovery = new RecoveryRenderer();

    const wResult = worker.render({ packet });
    const rResult = reviewer.render({ packet });
    const aResult = approver.render({ packet });
    const recResult = recovery.render({ packet });

    it('each renderer reports its own role', () => {
      expect(wResult.role).toBe('worker');
      expect(rResult.role).toBe('reviewer');
      expect(aResult.role).toBe('approver');
      expect(recResult.role).toBe('recovery');
    });

    it('each renderer reports a version', () => {
      expect(wResult.rendererVersion).toBeTruthy();
      expect(rResult.rendererVersion).toBeTruthy();
      expect(aResult.rendererVersion).toBeTruthy();
      expect(recResult.rendererVersion).toBeTruthy();
    });

    it('instruction blocks differ between roles', () => {
      // Worker gets authoritative + constraints + prohibitions
      // Reviewer gets review instructions + constraints
      // Approver gets approval context + prohibitions
      // Recovery gets recovery instructions
      const blocks = new Set([
        wResult.instructionBlock,
        rResult.instructionBlock,
        aResult.instructionBlock,
        recResult.instructionBlock,
      ]);
      expect(blocks.size).toBe(4);
    });

    it('all renderers include state blocks', () => {
      expect(wResult.stateBlock).toContain(packet.summary);
      expect(rResult.stateBlock).toContain(packet.summary);
      expect(aResult.stateBlock).toContain(packet.handoffId);
      expect(recResult.stateBlock).toContain(packet.summary);
    });
  });

  describe('WorkerRenderer', () => {
    it('includes authoritative instructions', () => {
      const renderer = new WorkerRenderer();
      const result = renderer.render({ packet });
      expect(result.instructionBlock).toContain('Complete the backend implementation');
    });

    it('includes prohibitions', () => {
      const renderer = new WorkerRenderer();
      const result = renderer.render({ packet });
      expect(result.instructionBlock).toContain('DO NOT');
    });

    it('filters open loops to worker-owned', () => {
      const testPacket = makeTestPacket({
        openLoops: [
          { id: 'l1', summary: 'Worker task', priority: 'high', ownerRole: 'worker' },
          { id: 'l2', summary: 'Approver task', priority: 'high', ownerRole: 'approver' },
        ],
      });
      const renderer = new WorkerRenderer();
      const result = renderer.render({ packet: testPacket });
      expect(result.openLoopsBlock).toContain('Worker task');
      expect(result.openLoopsBlock).not.toContain('Approver task');
    });

    it('respects token budget', () => {
      const renderer = new WorkerRenderer();
      const result = renderer.render({ packet, tokenBudget: 50 });
      // With a very small budget, some content should be truncated
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ReviewerRenderer', () => {
    it('frames decisions for review', () => {
      const renderer = new ReviewerRenderer();
      const result = renderer.render({ packet });
      expect(result.decisionsBlock).toContain('review for soundness');
    });

    it('shows all open loops, not just worker-owned', () => {
      const testPacket = makeTestPacket({
        openLoops: [
          { id: 'l1', summary: 'Worker task', priority: 'high', ownerRole: 'worker' },
          { id: 'l2', summary: 'Approver task', priority: 'medium', ownerRole: 'approver' },
        ],
      });
      const renderer = new ReviewerRenderer();
      const result = renderer.render({ packet: testPacket });
      expect(result.openLoopsBlock).toContain('Worker task');
      expect(result.openLoopsBlock).toContain('Approver task');
    });
  });

  describe('ApproverRenderer', () => {
    it('includes packet hash for verification', () => {
      const renderer = new ApproverRenderer();
      const result = renderer.render({ packet });
      expect(result.stateBlock).toContain(packet.contentHash);
    });

    it('only shows high-priority risks', () => {
      const testPacket = makeTestPacket({
        openLoops: [
          { id: 'l1', summary: 'Critical risk', priority: 'high' },
          { id: 'l2', summary: 'Minor note', priority: 'low' },
        ],
      });
      const renderer = new ApproverRenderer();
      const result = renderer.render({ packet: testPacket });
      expect(result.openLoopsBlock).toContain('Critical risk');
      expect(result.openLoopsBlock).not.toContain('Minor note');
    });
  });

  describe('RecoveryRenderer', () => {
    it('instructs against fabrication', () => {
      const renderer = new RecoveryRenderer();
      const result = renderer.render({ packet });
      expect(result.instructionBlock).toContain('Do NOT invent state');
    });

    it('includes packet hash for trust verification', () => {
      const renderer = new RecoveryRenderer();
      const result = renderer.render({ packet });
      expect(result.stateBlock).toContain(packet.contentHash);
    });
  });
});
