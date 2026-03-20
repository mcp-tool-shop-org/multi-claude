import { describe, it, expect } from 'vitest';
import { computePacketHash } from '../../src/handoff/integrity/hash.js';
import { verifyPacketIntegrity } from '../../src/handoff/integrity/verify-packet.js';
import { makeTestPacket } from './helpers.js';

describe('Handoff Packet', () => {
  describe('content hash', () => {
    it('is deterministic — same content produces same hash', () => {
      const packet1 = makeTestPacket();
      const packet2 = makeTestPacket();

      // Same content fields → same hash
      const hash1 = computePacketHash(packet1);
      const hash2 = computePacketHash(packet2);
      expect(hash1).toBe(hash2);
    });

    it('changes when summary changes', () => {
      const packet1 = makeTestPacket();
      const packet2 = makeTestPacket({ summary: 'Different summary' });

      const hash1 = computePacketHash(packet1);
      const hash2 = computePacketHash(packet2);
      expect(hash1).not.toBe(hash2);
    });

    it('changes when instructions change', () => {
      const packet1 = makeTestPacket();
      const packet2 = makeTestPacket({
        instructions: {
          authoritative: ['Different instruction'],
          constraints: [],
          prohibitions: [],
        },
      });

      const hash1 = computePacketHash(packet1);
      const hash2 = computePacketHash(packet2);
      expect(hash1).not.toBe(hash2);
    });

    it('changes when decisions change', () => {
      const packet1 = makeTestPacket();
      const packet2 = makeTestPacket({
        decisions: [{
          id: 'dec-002',
          summary: 'Different decision',
          rationale: 'Different reason',
        }],
      });

      const hash1 = computePacketHash(packet1);
      const hash2 = computePacketHash(packet2);
      expect(hash1).not.toBe(hash2);
    });

    it('does not depend on handoffId, packetVersion, or createdAt', () => {
      const packet1 = makeTestPacket({ handoffId: 'ho-aaa', packetVersion: 1, createdAt: '2020-01-01T00:00:00Z' });
      const packet2 = makeTestPacket({ handoffId: 'ho-bbb', packetVersion: 99, createdAt: '2099-12-31T23:59:59Z' });

      const hash1 = computePacketHash(packet1);
      const hash2 = computePacketHash(packet2);
      expect(hash1).toBe(hash2);
    });
  });

  describe('integrity verification', () => {
    it('passes for a correctly hashed packet', () => {
      const packet = makeTestPacket();
      const result = verifyPacketIntegrity(packet);
      expect(result.valid).toBe(true);
      expect(result.expectedHash).toBe(result.actualHash);
    });

    it('fails when content is tampered with', () => {
      const packet = makeTestPacket();
      // Tamper with the summary but keep the old hash
      packet.summary = 'Tampered summary';
      const result = verifyPacketIntegrity(packet);
      expect(result.valid).toBe(false);
      expect(result.expectedHash).not.toBe(result.actualHash);
    });
  });
});
