import type { FeatureStatus, PacketStatus } from '../types/common.js';

const PACKET_TERMINAL: ReadonlySet<PacketStatus> = new Set([
  'merged', 'abandoned', 'superseded',
]);

const FEATURE_TERMINAL: ReadonlySet<FeatureStatus> = new Set([
  'complete', 'abandoned', 'superseded',
]);

const PACKET_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ['ready', 'superseded'],
  ready: ['claimed', 'blocked', 'superseded'],
  claimed: ['in_progress', 'ready', 'blocked'],
  in_progress: ['submitted', 'ready', 'blocked', 'failed'],
  submitted: ['verifying', 'failed'],
  verifying: ['verified', 'failed'],
  verified: ['integrating'],
  integrating: ['merged', 'failed'],
  blocked: ['ready', 'superseded', 'abandoned'],
  failed: ['ready', 'abandoned', 'superseded'],
};

const FEATURE_TRANSITIONS: Record<string, readonly string[]> = {
  proposed: ['approved', 'abandoned'],
  approved: ['in_progress', 'abandoned'],
  in_progress: ['verifying', 'blocked', 'abandoned'],
  verifying: ['complete', 'in_progress', 'abandoned'],
  blocked: ['in_progress', 'abandoned'],
};

export function isPacketTerminal(status: PacketStatus): boolean {
  return PACKET_TERMINAL.has(status);
}

export function isFeatureTerminal(status: FeatureStatus): boolean {
  return FEATURE_TERMINAL.has(status);
}

export function isValidPacketTransition(from: PacketStatus, to: PacketStatus): boolean {
  if (PACKET_TERMINAL.has(from)) return false;
  return PACKET_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidFeatureTransition(from: FeatureStatus, to: FeatureStatus): boolean {
  if (FEATURE_TERMINAL.has(from)) return false;
  return FEATURE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAllowedPacketTransitions(from: PacketStatus): readonly string[] {
  if (PACKET_TERMINAL.has(from)) return [];
  return PACKET_TRANSITIONS[from] ?? [];
}

export function getAllowedFeatureTransitions(from: FeatureStatus): readonly string[] {
  if (FEATURE_TERMINAL.has(from)) return [];
  return FEATURE_TRANSITIONS[from] ?? [];
}
