/**
 * render.ts — Terminal-formatted rendering for the Live Run Console.
 *
 * Reads from RunModel, HookFeedResult, and FitnessViewResult read models
 * and produces plain-text output (no ANSI colors) using box-drawing
 * characters and status symbols for visual clarity.
 */

import type { RunModel, RunOverview, PacketNode, WorkerSession, GateStatus } from './run-model.js';
import type { HookFeedResult } from './hook-feed.js';
import type { FitnessViewResult } from './fitness-view.js';
import { RESOLVED_PACKET_STATUSES } from '../types/statuses.js';

// ── Constants ────────────────────────────────────────────────────────

const STATUS_SYMBOLS: Record<string, string> = {
  running: '●',
  in_progress: '●',
  completed: '✓',
  merged: '✓',
  verified: '✓',
  failed: '✗',
  pending: '◌',
  queued: '◌',
  none: '◌',
  paused: '⏸',
  blocked: '⊘',
};

const MAX_HOOK_EVENTS = 10;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_LINE_WIDTH = 100;

// ── Helpers ──────────────────────────────────────────────────────────

function statusSymbol(status: string): string {
  return STATUS_SYMBOLS[status] ?? '◌';
}

function paneHeader(title: string): string {
  const pad = '═══';
  return `${pad} ${title} ${pad}`;
}

function formatElapsed(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  } catch {
    return iso.slice(11, 19) || iso;
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// ── Pane A: Run Overview ─────────────────────────────────────────────

export function renderRunOverview(overview: RunOverview, nextAction: string): string {
  const lines: string[] = [];
  lines.push(paneHeader('RUN OVERVIEW'));

  lines.push(`Run:     ${overview.runId}`);
  lines.push(`Feature: ${overview.featureId} (${overview.featureTitle})`);
  lines.push(`Status:  ${statusSymbol(overview.status)} ${overview.status}`);
  lines.push(`Wave:    ${overview.currentWave} / ${overview.totalWaves}`);

  const pktParts = [
    `${overview.totalPackets} total`,
    `${overview.mergedCount} merged`,
    `${overview.inProgressCount} in-progress`,
    `${overview.failedCount} failed`,
    `${overview.blockedCount} blocked`,
  ];
  lines.push(`Packets: ${pktParts.join(' | ')}`);

  if (overview.workClass || overview.predictedFit) {
    const fitParts: string[] = [];
    if (overview.workClass) fitParts.push(overview.workClass);
    if (overview.predictedFit) fitParts.push(overview.predictedFit);
    if (overview.predictedGradeRange) {
      fitParts.push(`[${overview.predictedGradeRange[0]}, ${overview.predictedGradeRange[1]}]`);
    }
    lines.push(`Fit:     ${fitParts.join(' | ')}`);
  }

  if (overview.pauseReason) {
    lines.push(`Paused:  ${overview.pauseReason}`);
  }

  lines.push('');
  if (nextAction) {
    lines.push(`▶ Next: ${truncate(nextAction, MAX_LINE_WIDTH - 8)}`);
  }

  return lines.join('\n');
}

// ── Pane B: Packet Graph ─────────────────────────────────────────────

export function renderPacketGraph(packets: PacketNode[]): string {
  const lines: string[] = [];
  lines.push(paneHeader('PACKET GRAPH'));

  if (packets.length === 0) {
    lines.push('  (no packets)');
    return lines.join('\n');
  }

  // Group by wave
  const byWave = new Map<number, PacketNode[]>();
  for (const p of packets) {
    const wave = p.wave || 0;
    if (!byWave.has(wave)) byWave.set(wave, []);
    byWave.get(wave)!.push(p);
  }

  const waves = [...byWave.keys()].sort((a, b) => a - b);

  for (const wave of waves) {
    lines.push(`Wave ${wave}:`);
    for (const p of byWave.get(wave)!) {
      const sym = statusSymbol(p.status);
      const tag = `[${p.layer}/${p.role}]`;
      let line = `  ${sym} ${p.packetId} ${tag} ${p.title}`;

      // Annotations
      const annotations: string[] = [];
      if (p.owner) {
        annotations.push(`claimed by ${p.owner}`);
      }

      // Show blocking dependencies
      const blockers = p.dependencies.filter(
        d => d.type === 'hard' && !RESOLVED_PACKET_STATUSES.has(d.status)
      );
      if (blockers.length > 0) {
        annotations.push(`blocked: ${blockers.map(b => b.packetId).join(', ')}`);
      }

      if (annotations.length > 0) {
        line += ` ← ${annotations.join(' | ')}`;
      }

      lines.push(truncate(line, MAX_LINE_WIDTH));
    }
  }

  return lines.join('\n');
}

// ── Pane C: Worker Sessions ──────────────────────────────────────────

export function renderWorkerSessions(workers: WorkerSession[]): string {
  const lines: string[] = [];
  lines.push(paneHeader('WORKER SESSIONS'));

  if (workers.length === 0) {
    lines.push('  (no workers)');
    return lines.join('\n');
  }

  // Sort: active first, then completed/failed, newest first within each group
  const sorted = [...workers].sort((a, b) => {
    const activeStatuses = ['running', 'in_progress'];
    const aActive = activeStatuses.includes(a.status) ? 0 : 1;
    const bActive = activeStatuses.includes(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    // Within same group, most recent first
    const aTime = a.startedAt ?? '';
    const bTime = b.startedAt ?? '';
    return bTime.localeCompare(aTime);
  });

  for (const w of sorted) {
    const sym = statusSymbol(w.status);
    const elapsed = formatElapsed(w.elapsedMs);
    const headerLine = `  ${w.packetId} | ${sym} ${w.status} | ${elapsed} | wave ${w.wave} | attempt ${w.attemptNumber}`;
    lines.push(truncate(headerLine, MAX_LINE_WIDTH));

    // Detail line for active/recent workers
    const detailParts: string[] = [];
    if (w.modelName) detailParts.push(`model: ${w.modelName}`);
    if (w.branchName) detailParts.push(`branch: ${w.branchName}`);
    if (detailParts.length > 0) {
      lines.push(`    ${detailParts.join(' | ')}`);
    }
    if (w.worktreePath) {
      lines.push(`    worktree: ${w.worktreePath}`);
    }
    if (w.error) {
      lines.push(`    error: ${truncate(w.error, MAX_LINE_WIDTH - 11)}`);
    }
  }

  return lines.join('\n');
}

// ── Pane D: Hooks & Gates ────────────────────────────────────────────

export function renderHooksAndGates(hookFeed: HookFeedResult, gates: GateStatus[]): string {
  const lines: string[] = [];
  lines.push(paneHeader('HOOKS & GATES'));

  // Recent decisions
  const recentEvents = hookFeed.events.slice(0, MAX_HOOK_EVENTS);
  if (recentEvents.length > 0) {
    lines.push('Recent decisions:');
    for (const ev of recentEvents) {
      const ts = formatTimestamp(ev.timestamp);
      const action = ev.action ?? '—';
      const rule = ev.ruleMatched ?? '—';
      const decision = `${ev.mode}/${ev.operatorDecision}`;
      const line = `  [${ts}] ${ev.event} → ${action} (${rule}) ${decision}`;
      lines.push(truncate(line, MAX_LINE_WIDTH));
    }
  } else {
    lines.push('Recent decisions: (none)');
  }

  // Pending approvals count
  const pendingCount = hookFeed.summary.pendingApprovals;
  lines.push(`Pending approvals: ${pendingCount}`);

  if (pendingCount > 0) {
    const pendingEvents = hookFeed.events.filter(e => e.operatorDecision === 'pending');
    for (const ev of pendingEvents.slice(0, 5)) {
      const action = ev.action ?? 'unknown';
      lines.push(`  ⏸ ${action} for ${ev.event} ${ev.entityId} — awaiting operator`);
    }
  }

  // Gates
  if (gates.length > 0) {
    lines.push('');
    lines.push('Gates:');
    for (const g of gates) {
      const sym = g.resolved ? statusSymbol('completed') : statusSymbol('pending');
      let detail: string;
      if (g.resolved) {
        detail = `${g.decision ?? 'resolved'}`;
        if (g.actor) detail += ` by ${g.actor}`;
      } else {
        detail = 'pending';
      }
      lines.push(`  ${sym} ${g.type} — ${detail}`);
    }
  }

  return lines.join('\n');
}

// ── Pane E: Fitness & Evidence ───────────────────────────────────────

export function renderFitnessAndEvidence(fitnessView: FitnessViewResult): string {
  const lines: string[] = [];
  lines.push(paneHeader('FITNESS & EVIDENCE'));

  const score = fitnessView.runScore;
  if (score) {
    lines.push(`Grade: ${score.grade} (${score.overall}/100)${score.stale ? ' [stale]' : ''}`);
    lines.push(`  Quality:       ${score.quality}/40`);
    lines.push(`  Lawfulness:    ${score.lawfulness}/25`);
    lines.push(`  Collaboration: ${score.collaboration}/20`);
    lines.push(`  Velocity:      ${score.velocity}/15`);

    if (score.penalties.length > 0) {
      const totalPenalty = score.penalties.reduce((sum, p) => sum + p.points, 0);
      const count = score.penalties.length;
      const reasons = score.penalties.map(p => p.description || p.type).join(', ');
      lines.push(`Penalties: ${totalPenalty} (${count}: ${truncate(reasons, 60)})`);
    }
  } else {
    lines.push('Grade: (no score computed)');
  }

  // Maturation summary
  lines.push('');
  const mat = fitnessView.maturationSummary;
  const matParts: string[] = [];
  if (mat.integrated > 0) matParts.push(`${mat.integrated} integrated`);
  if (mat.verified > 0) matParts.push(`${mat.verified} verified`);
  if (mat.submitted > 0) matParts.push(`${mat.submitted} submitted`);
  if (mat.none > 0) matParts.push(`${mat.none} none`);
  lines.push(`Maturation: ${matParts.length > 0 ? matParts.join(' | ') : '(no packets)'}`);

  // Evidence
  const recentEvidence = fitnessView.evidence.slice(0, MAX_EVIDENCE_ITEMS);
  if (recentEvidence.length > 0) {
    lines.push('');
    lines.push('Evidence (recent):');
    for (const ev of recentEvidence) {
      const pktLabel = ev.packetId ?? 'feature';
      const line = `  [${ev.type}] ${pktLabel}: ${ev.status} — ${ev.summary}`;
      lines.push(truncate(line, MAX_LINE_WIDTH));
    }
  }

  return lines.join('\n');
}

// ── Full Console ─────────────────────────────────────────────────────

export function renderConsole(
  runModel: RunModel,
  hookFeed: HookFeedResult,
  fitnessView: FitnessViewResult,
  nextAction: string,
): string {
  const panes = [
    renderRunOverview(runModel.overview, nextAction),
    renderPacketGraph(runModel.packets),
    renderWorkerSessions(runModel.workers),
    renderHooksAndGates(hookFeed, runModel.gates),
    renderFitnessAndEvidence(fitnessView),
  ];

  return panes.join('\n\n');
}
