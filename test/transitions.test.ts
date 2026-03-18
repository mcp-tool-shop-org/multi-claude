import { describe, it, expect } from 'vitest';
import {
  isValidPacketTransition,
  isValidFeatureTransition,
  isPacketTerminal,
  isFeatureTerminal,
  getAllowedPacketTransitions,
} from '../src/lib/transitions.js';

describe('Packet state transitions', () => {
  describe('terminal states', () => {
    it('merged is terminal', () => {
      expect(isPacketTerminal('merged')).toBe(true);
    });
    it('abandoned is terminal', () => {
      expect(isPacketTerminal('abandoned')).toBe(true);
    });
    it('superseded is terminal', () => {
      expect(isPacketTerminal('superseded')).toBe(true);
    });
    it('ready is not terminal', () => {
      expect(isPacketTerminal('ready')).toBe(false);
    });
    it('verified is not terminal', () => {
      expect(isPacketTerminal('verified')).toBe(false);
    });
  });

  describe('no transitions from terminal states', () => {
    for (const terminal of ['merged', 'abandoned', 'superseded'] as const) {
      it(`${terminal} has no outbound transitions`, () => {
        expect(getAllowedPacketTransitions(terminal)).toEqual([]);
      });
      it(`${terminal} → ready is illegal`, () => {
        expect(isValidPacketTransition(terminal, 'ready')).toBe(false);
      });
      it(`${terminal} → in_progress is illegal`, () => {
        expect(isValidPacketTransition(terminal, 'in_progress')).toBe(false);
      });
    }
  });

  describe('happy path', () => {
    const happyPath = [
      ['draft', 'ready'],
      ['ready', 'claimed'],
      ['claimed', 'in_progress'],
      ['in_progress', 'submitted'],
      ['submitted', 'verifying'],
      ['verifying', 'verified'],
      ['verified', 'integrating'],
      ['integrating', 'merged'],
    ] as const;

    for (const [from, to] of happyPath) {
      it(`${from} → ${to} is valid`, () => {
        expect(isValidPacketTransition(from, to)).toBe(true);
      });
    }
  });

  describe('failure and recovery paths', () => {
    it('in_progress → failed', () => {
      expect(isValidPacketTransition('in_progress', 'failed')).toBe(true);
    });
    it('failed → ready (retry)', () => {
      expect(isValidPacketTransition('failed', 'ready')).toBe(true);
    });
    it('failed → abandoned', () => {
      expect(isValidPacketTransition('failed', 'abandoned')).toBe(true);
    });
    it('blocked → ready', () => {
      expect(isValidPacketTransition('blocked', 'ready')).toBe(true);
    });
    it('claimed → ready (lease expiry)', () => {
      expect(isValidPacketTransition('claimed', 'ready')).toBe(true);
    });
    it('in_progress → ready (lease expiry)', () => {
      expect(isValidPacketTransition('in_progress', 'ready')).toBe(true);
    });
  });

  describe('illegal transitions', () => {
    it('ready → submitted (must go through claimed + in_progress)', () => {
      expect(isValidPacketTransition('ready', 'submitted')).toBe(false);
    });
    it('draft → claimed (must go through ready)', () => {
      expect(isValidPacketTransition('draft', 'claimed')).toBe(false);
    });
    it('verified → ready (no backward from verified)', () => {
      expect(isValidPacketTransition('verified', 'ready')).toBe(false);
    });
    it('submitted → in_progress (no backward)', () => {
      expect(isValidPacketTransition('submitted', 'in_progress')).toBe(false);
    });
  });
});

describe('Feature state transitions', () => {
  it('proposed → approved', () => {
    expect(isValidFeatureTransition('proposed', 'approved')).toBe(true);
  });
  it('approved → in_progress', () => {
    expect(isValidFeatureTransition('approved', 'in_progress')).toBe(true);
  });
  it('complete is terminal', () => {
    expect(isFeatureTerminal('complete')).toBe(true);
  });
  it('complete → in_progress is illegal', () => {
    expect(isValidFeatureTransition('complete', 'in_progress')).toBe(false);
  });
});
