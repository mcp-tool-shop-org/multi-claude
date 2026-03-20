/**
 * Handoff Spine — Derive open loops from execution truth.
 *
 * Open loops are unresolved items from the run that the next
 * agent/role needs to continue or address.
 */

import type { HandoffOpenLoop, HandoffLane } from '../schema/packet.js';
import { generateId } from '../../lib/ids.js';

export interface OpenLoopSource {
  failedPacketIds: string[];
  blockedPacketIds: string[];
  pendingPacketIds: string[];
  unresolvedGates: string[];
  customLoops?: Array<{
    summary: string;
    priority: 'high' | 'medium' | 'low';
    ownerRole?: HandoffLane;
  }>;
}

export function deriveOpenLoops(source: OpenLoopSource): HandoffOpenLoop[] {
  const loops: HandoffOpenLoop[] = [];

  for (const id of source.failedPacketIds) {
    loops.push({
      id: generateId('loop'),
      summary: `Failed packet ${id} requires retry or supersede`,
      priority: 'high',
      ownerRole: 'worker',
    });
  }

  for (const id of source.blockedPacketIds) {
    loops.push({
      id: generateId('loop'),
      summary: `Blocked packet ${id} awaiting dependency resolution`,
      priority: 'high',
      ownerRole: 'worker',
    });
  }

  for (const id of source.pendingPacketIds) {
    loops.push({
      id: generateId('loop'),
      summary: `Pending packet ${id} not yet started`,
      priority: 'medium',
      ownerRole: 'worker',
    });
  }

  for (const gate of source.unresolvedGates) {
    loops.push({
      id: generateId('loop'),
      summary: `Unresolved gate: ${gate}`,
      priority: 'high',
      ownerRole: 'approver',
    });
  }

  if (source.customLoops) {
    for (const custom of source.customLoops) {
      loops.push({
        id: generateId('loop'),
        summary: custom.summary,
        priority: custom.priority,
        ownerRole: custom.ownerRole,
      });
    }
  }

  return loops;
}
