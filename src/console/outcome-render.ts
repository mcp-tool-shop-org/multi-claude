/**
 * Outcome Render — Phase 9F-201
 *
 * Operator-grade terminal rendering for run outcomes.
 * Shows: status, packet breakdown, unresolved items,
 * interventions, acceptability, and follow-up.
 */

import type {
  RunOutcome,
  PacketOutcome,
  UnresolvedItem,
} from '../types/outcome.js';

// ── Constants ────────────────────────────────────────────────────────

const MAX_LINE_WIDTH = 100;

const STATUS_SYMBOLS: Record<string, string> = {
  clean_success: '✓',
  assisted_success: '✓',
  partial_success: '◐',
  terminal_failure: '✗',
  stopped: '⏸',
  in_progress: '●',
};

const PACKET_SYMBOLS: Record<string, string> = {
  resolved: '✓',
  recovered: '↻',
  failed: '✗',
  blocked: '⊘',
  pending: '◌',
  skipped: '—',
};

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

function formatElapsed(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return `${hours}h ${remainMins}m`;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Render a RunOutcome to terminal-formatted text.
 */
export function renderOutcome(outcome: RunOutcome): string {
  const lines: string[] = [];

  // Header
  lines.push('═══ RUN OUTCOME ═══');
  lines.push('');

  // Status
  const sym = STATUS_SYMBOLS[outcome.status] ?? '?';
  lines.push(`  ${sym} Status: ${outcome.status.replace(/_/g, ' ').toUpperCase()}`);
  lines.push(`  Run:     ${outcome.runId}`);
  lines.push(`  Feature: ${outcome.featureId} (${outcome.featureTitle})`);
  lines.push(`  Elapsed: ${formatElapsed(outcome.elapsedMs)}`);
  lines.push('');

  // Summary
  lines.push(`  ${outcome.summary}`);
  lines.push('');

  // Packet breakdown
  lines.push('  Packets:');
  lines.push(`    ${outcome.resolvedCount} resolved | ${outcome.recoveredCount} recovered | ${outcome.failedCount} failed | ${outcome.unresolvedCount} unresolved | ${outcome.totalPackets} total`);
  lines.push('');

  // Per-packet detail (grouped by status)
  const byStatus = groupPacketsByStatus(outcome.packets);
  for (const [status, packets] of byStatus) {
    if (packets.length === 0) continue;
    const groupSym = PACKET_SYMBOLS[status] ?? '?';
    for (const p of packets) {
      const retryNote = p.wasRetried ? ` (${p.attempts} attempts)` : '';
      lines.push(`    ${groupSym} ${p.packetId} — ${p.title}${retryNote}`);
    }
  }
  lines.push('');

  // Unresolved items
  if (outcome.unresolvedItems.length > 0) {
    lines.push('  Unresolved:');
    for (const item of outcome.unresolvedItems) {
      lines.push(`    ✗ [${item.type}] ${truncate(item.description, MAX_LINE_WIDTH - 20)}`);
    }
    lines.push('');
  }

  // Interventions
  if (outcome.interventions.totalActions > 0) {
    lines.push('  Interventions:');
    const parts: string[] = [];
    if (outcome.interventions.retries > 0) parts.push(`${outcome.interventions.retries} retries`);
    if (outcome.interventions.gateApprovals > 0) parts.push(`${outcome.interventions.gateApprovals} gate approvals`);
    if (outcome.interventions.hookResolutions > 0) parts.push(`${outcome.interventions.hookResolutions} hook resolutions`);
    if (outcome.interventions.stops > 0) parts.push(`${outcome.interventions.stops} stops`);
    if (outcome.interventions.resumes > 0) parts.push(`${outcome.interventions.resumes} resumes`);
    lines.push(`    ${outcome.interventions.totalActions} total: ${parts.join(', ')}`);
    lines.push('');
  }

  // Acceptability
  const acceptSym = outcome.acceptable ? '✓' : '✗';
  lines.push(`  ${acceptSym} Acceptable: ${outcome.acceptable ? 'YES' : 'NO'}`);
  lines.push(`    ${outcome.acceptabilityReason}`);
  lines.push('');

  // Follow-up
  if (outcome.followUp.kind !== 'none' || outcome.status === 'in_progress') {
    lines.push('  Follow-up:');
    lines.push(`    ${outcome.followUp.title}`);
    lines.push(`    ${outcome.followUp.reason}`);
    if (outcome.followUp.command) {
      lines.push(`    Run: ${outcome.followUp.command}`);
    }
  } else {
    lines.push('  Follow-up: none needed');
  }

  return lines.join('\n');
}

// ── Internal helpers ────────────────────────────────────────────────

function groupPacketsByStatus(packets: PacketOutcome[]): [string, PacketOutcome[]][] {
  const order = ['resolved', 'recovered', 'failed', 'blocked', 'pending', 'skipped'];
  const groups = new Map<string, PacketOutcome[]>();
  for (const s of order) groups.set(s, []);

  for (const p of packets) {
    const group = groups.get(p.status);
    if (group) group.push(p);
  }

  return [...groups.entries()].filter(([, ps]) => ps.length > 0);
}
