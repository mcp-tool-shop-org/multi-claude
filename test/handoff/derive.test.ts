import { describe, it, expect } from 'vitest';
import { deriveHandoffPacket } from '../../src/handoff/derive/derive-handoff-packet.js';
import { deriveOpenLoops } from '../../src/handoff/derive/derive-open-loops.js';
import { deriveDecisions, deriveRejections } from '../../src/handoff/derive/derive-decisions.js';
import { deriveArtifactRefs } from '../../src/handoff/derive/derive-artifact-refs.js';
import { verifyPacketIntegrity } from '../../src/handoff/integrity/verify-packet.js';

describe('Derivation', () => {
  describe('deriveHandoffPacket', () => {
    it('produces a packet with a valid content hash', () => {
      const packet = deriveHandoffPacket({
        projectId: 'proj-1',
        runId: 'run-001',
        summary: 'Initial handoff',
        instructions: {
          authoritative: ['Implement feature X'],
          constraints: ['Stay within module boundary'],
          prohibitions: ['Do not touch shared types'],
        },
        decisionSource: { approvals: [], contractDeltas: [] },
        rejectionSource: { rejectedApprovals: [], rejectedDeltas: [] },
        openLoopSource: {
          failedPacketIds: [],
          blockedPacketIds: [],
          pendingPacketIds: [],
          unresolvedGates: [],
        },
        artifactSource: { artifacts: [] },
      });

      expect(packet.handoffId).toMatch(/^ho-/);
      expect(packet.packetVersion).toBe(1);
      expect(packet.contentHash).toBeTruthy();

      const integrity = verifyPacketIntegrity(packet);
      expect(integrity.valid).toBe(true);
    });

    it('includes derived decisions from approvals', () => {
      const packet = deriveHandoffPacket({
        projectId: 'proj-1',
        runId: 'run-001',
        summary: 'With decisions',
        instructions: { authoritative: [], constraints: [], prohibitions: [] },
        decisionSource: {
          approvals: [{
            scopeType: 'feature',
            scopeId: 'feat-1',
            decision: 'approved',
            rationale: 'Looks good',
          }],
          contractDeltas: [],
        },
        rejectionSource: { rejectedApprovals: [], rejectedDeltas: [] },
        openLoopSource: {
          failedPacketIds: [],
          blockedPacketIds: [],
          pendingPacketIds: [],
          unresolvedGates: [],
        },
        artifactSource: { artifacts: [] },
      });

      expect(packet.decisions).toHaveLength(1);
      expect(packet.decisions[0].summary).toContain('feature');
    });
  });

  describe('deriveOpenLoops', () => {
    it('creates loops for failed and blocked packets', () => {
      const loops = deriveOpenLoops({
        failedPacketIds: ['pkt-1'],
        blockedPacketIds: ['pkt-2'],
        pendingPacketIds: [],
        unresolvedGates: ['gate-1'],
      });

      expect(loops).toHaveLength(3);
      expect(loops[0].priority).toBe('high');
      expect(loops[0].ownerRole).toBe('worker');
      expect(loops[2].ownerRole).toBe('approver');
    });
  });

  describe('deriveDecisions', () => {
    it('extracts decisions from approved approvals', () => {
      const decisions = deriveDecisions({
        approvals: [
          { scopeType: 'feature', scopeId: 'f-1', decision: 'approved', rationale: 'Good' },
          { scopeType: 'packet', scopeId: 'p-1', decision: 'rejected' },
        ],
        contractDeltas: [],
      });

      expect(decisions).toHaveLength(1);
      expect(decisions[0].summary).toContain('f-1');
    });
  });

  describe('deriveRejections', () => {
    it('extracts rejections from rejected approvals', () => {
      const rejections = deriveRejections({
        rejectedApprovals: [
          { scopeType: 'feature', scopeId: 'f-1', rationale: 'Not ready' },
        ],
        rejectedDeltas: [],
      });

      expect(rejections).toHaveLength(1);
      expect(rejections[0].rationale).toBe('Not ready');
    });
  });

  describe('deriveArtifactRefs', () => {
    it('creates refs with generated IDs', () => {
      const refs = deriveArtifactRefs({
        artifacts: [{
          name: 'build.log',
          kind: 'log',
          storageRef: '/cas/abc',
        }],
      });

      expect(refs).toHaveLength(1);
      expect(refs[0].id).toMatch(/^art-/);
      expect(refs[0].name).toBe('build.log');
    });
  });
});
