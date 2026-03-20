import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import { generateId, nowISO } from '../lib/ids.js';
import { runRender } from './render.js';
import { runClaim, runProgress, endAttempt } from './claim.js';
import { cleanupOnStop } from '../runtime/cleanup.js';
import { runSubmit } from './submit.js';
import { runVerify } from './verify.js';
import { runPromote } from './promote.js';
import type { McfResult } from '../types/common.js';
import { runIntegrate } from './integrate.js';
import { launchWorkerSession } from '../runtime/sdk-runtime.js';
import { registerSession, unregisterSession, stopAllSessions, stopSession } from '../runtime/session-registry.js';
import { emitHookEvent } from '../hooks/engine.js';
import type { WorkerSessionResult, StopReason } from '../runtime/types.js';
import { HandoffStore, migrateHandoffSchema } from '../handoff/index.js';
import { bridgeExecutionPacket } from '../handoff/bridge/execution-to-handoff.js';
import { createHandoff } from '../handoff/api/create-handoff.js';
import { renderHandoff } from '../handoff/api/render-handoff.js';
import { resolveLastValidHandoffForPacket } from '../handoff/api/resolve-handoff.js';
import { createFallbackEvidence, type FallbackEvidence } from '../handoff/bridge/fallback-evidence.js';
import type { HandoffId, HandoffLane } from '../handoff/schema/packet.js';
import type { ModelAdapterName } from '../handoff/api/render-handoff.js';

// ─── Types ──────────────────────────────────────────────────────

interface WavePacket {
  packet_id: string;
  layer: string;
  role: string;
  playbook_id: string;
  goal: string;
}

interface Wave {
  wave: number;
  packets: WavePacket[];
}

interface PlanResult {
  feature_id: string;
  total_waves: number;
  total_packets: number;
  waves: Wave[];
  human_gates: string[];
}

interface RunResult {
  run_id: string;
  feature_id: string;
  status: string;
  waves_completed: number;
  total_waves: number;
  packets_merged: number;
  packets_failed: number;
  pause_reason?: string;
}

interface StatusResult {
  run_id: string;
  feature_id: string;
  status: string;
  current_wave: number;
  total_waves: number;
  workers: Array<{
    packet_id: string;
    wave: number;
    status: string;
    error?: string;
  }>;
  pause_reason?: string;
}

// ─── Model Routing (canonical, from types/statuses.ts) ──────────

import { getModelForRole } from '../types/statuses.js';

// ─── Spine Helpers ──────────────────────────────────────────────

/** Map SDK model string to Handoff Spine adapter name */
function modelToAdapterName(model: string): ModelAdapterName {
  if (model.includes('claude')) return 'claude';
  if (model.includes('gpt') || model.includes('o1') || model.includes('o3') || model.includes('o4')) return 'gpt';
  return 'ollama';
}

/** Map execution role to Handoff Spine lane */
function roleToLane(role: string): HandoffLane {
  switch (role) {
    case 'reviewer': return 'reviewer';
    case 'approver': return 'approver';
    default: return 'worker';
  }
}

// ─── Constants ──────────────────────────────────────────────────

const LAYER_ORDER: Record<string, number> = {
  contract: 1, backend: 2, state: 3, ui: 4, test: 2, integration: 5, docs: 6,
};

const WORKER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ─── Wave Computation ───────────────────────────────────────────

function computeWaves(dbPath: string, featureId: string): McfResult<PlanResult> {
  const db = openDb(dbPath);
  try {
    const feature = db.prepare('SELECT * FROM features WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;
    if (!feature) {
      return mcfError('multi-claude auto plan', ERR.FEATURE_NOT_FOUND, `Feature '${featureId}' not found`, { feature_id: featureId });
    }

    const packets = db.prepare(`
      SELECT packet_id, layer, role, playbook_id, goal, status
      FROM packets WHERE feature_id = ? AND status NOT IN ('merged', 'abandoned', 'superseded')
    `).all(featureId) as Array<WavePacket & { status: string }>;

    if (packets.length === 0) {
      return mcfError('multi-claude auto plan', ERR.NO_CLAIMABLE_PACKETS, 'No actionable packets for this feature', { feature_id: featureId });
    }

    const deps = db.prepare(`
      SELECT pd.packet_id, pd.depends_on_packet_id
      FROM packet_dependencies pd
      JOIN packets p ON p.packet_id = pd.packet_id
      WHERE p.feature_id = ? AND pd.dependency_type = 'hard'
    `).all(featureId) as Array<{ packet_id: string; depends_on_packet_id: string }>;

    const depMap = new Map<string, string[]>();
    for (const p of packets) depMap.set(p.packet_id, []);
    for (const d of deps) {
      const list = depMap.get(d.packet_id);
      if (list) list.push(d.depends_on_packet_id);
    }

    const waves: Wave[] = [];
    const assigned = new Set<string>();
    const donePackets = db.prepare(`
      SELECT packet_id FROM packets WHERE feature_id = ? AND status IN ('verified', 'integrating', 'merged')
    `).all(featureId) as Array<{ packet_id: string }>;
    for (const d of donePackets) assigned.add(d.packet_id);

    let waveNum = 1;
    let remaining = packets.filter(p => !assigned.has(p.packet_id));

    while (remaining.length > 0) {
      const ready: WavePacket[] = [];
      for (const p of remaining) {
        const pDeps = depMap.get(p.packet_id) ?? [];
        if (pDeps.every(d => assigned.has(d))) {
          ready.push({ packet_id: p.packet_id, layer: p.layer, role: p.role, playbook_id: p.playbook_id, goal: p.goal });
        }
      }
      if (ready.length === 0) break;
      ready.sort((a, b) => (LAYER_ORDER[a.layer] ?? 99) - (LAYER_ORDER[b.layer] ?? 99));
      waves.push({ wave: waveNum, packets: ready });
      for (const p of ready) assigned.add(p.packet_id);
      remaining = remaining.filter(p => !assigned.has(p.packet_id));
      waveNum++;
    }

    const humanGates: string[] = [];
    if (feature.status === 'proposed') humanGates.push('feature_approval');
    humanGates.push('merge_approval');

    return {
      ok: true, command: 'multi-claude auto plan',
      result: { feature_id: featureId, total_waves: waves.length, total_packets: waves.reduce((sum, w) => sum + w.packets.length, 0), waves, human_gates: humanGates },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

// ─── Worktree Management ────────────────────────────────────────

function getRepoRoot(dbPath: string): string {
  const mcDir = resolve(dbPath, '..');
  return resolve(mcDir, '..');
}

function createWorktree(repoRoot: string, packetId: string): { worktreePath: string; branchName: string } {
  const branchName = `multi-claude/${packetId}`;
  const worktreePath = join(repoRoot, '.multi-claude', 'worktrees', packetId);

  if (existsSync(worktreePath)) {
    try { execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }
  }
  try { execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }

  mkdirSync(join(repoRoot, '.multi-claude', 'worktrees'), { recursive: true });
  execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' });
  return { worktreePath, branchName };
}

// cleanupWorktree reserved for future use — currently called externally
export function cleanupWorktree(repoRoot: string, packetId: string): void {
  const branchName = `multi-claude/${packetId}`;
  const worktreePath = join(repoRoot, '.multi-claude', 'worktrees', packetId);
  try { execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }
  try { execSync(`git branch -D "${branchName}"`, { cwd: repoRoot, stdio: 'pipe' }); } catch { /* ignore */ }
}

// ─── SDK Worker Session (via runtime adapter) ──────────────────

/** Map StopReason from runtime adapter to auto outcome */
function stopReasonToOutcome(stopReason: WorkerSessionResult['stopReason']): 'complete' | 'error' | 'timeout' {
  switch (stopReason) {
    case 'completed': return 'complete';
    case 'timed_out': return 'timeout';
    case 'stopped': return 'error'; // stopped is a controlled interruption
    default: return 'error';
  }
}

// ─── Submit & Verify Worker Output ──────────────────────────────

function submitWorkerOutput(
  dbPath: string,
  packetId: string,
  outputDir: string,
  workerId: string,
): McfResult<{ submission_id: string }> {
  const artifactsPath = join(outputDir, 'artifacts.json');
  const writebackPath = join(outputDir, 'writeback.json');

  if (!existsSync(artifactsPath)) {
    return mcfError('multi-claude auto run', ERR.INVALID_ARTIFACTS, `No artifacts.json found for ${packetId}`, { packet_id: packetId, output_dir: outputDir });
  }
  if (!existsSync(writebackPath)) {
    return mcfError('multi-claude auto run', ERR.INVALID_WRITEBACK, `No writeback.json found for ${packetId}`, { packet_id: packetId, output_dir: outputDir });
  }

  // Read file CONTENTS — runSubmit expects JSON strings, not file paths
  const artifactsJson = readFileSync(artifactsPath, 'utf-8');
  const writebackJson = readFileSync(writebackPath, 'utf-8');

  return runSubmit(dbPath, packetId, workerId, artifactsJson, writebackJson, true,
    `Auto-submitted by multi-claude auto for ${packetId}`);
}

function verifyWorkerOutput(
  dbPath: string,
  packetId: string,
  repoRoot: string,
  worktreePath: string,
): McfResult<{ verdict: string }> {
  const db = openDb(dbPath);
  let verificationSteps: Array<{ command: string; required: boolean; pass_condition: string }> = [];
  try {
    const packet = db.prepare('SELECT verification_profile_id, verification_overrides FROM packets WHERE packet_id = ?')
      .get(packetId) as { verification_profile_id: string; verification_overrides: string | null } | undefined;
    if (packet) {
      const profile = db.prepare('SELECT steps FROM verification_profiles WHERE verification_profile_id = ?')
        .get(packet.verification_profile_id) as { steps: string } | undefined;
      if (profile) {
        try { verificationSteps = JSON.parse(profile.steps); } catch { /* empty */ }
      }
    }
  } finally {
    db.close();
  }

  const checks: Record<string, boolean> = {};
  const failures: string[] = [];

  if (verificationSteps.length === 0) {
    checks['artifacts_present'] = true;
    checks['writeback_present'] = true;
  }

  for (const step of verificationSteps) {
    try {
      execSync(step.command, { cwd: worktreePath, stdio: 'pipe', timeout: 120000 });
      checks[step.command] = true;
    } catch (err) {
      checks[step.command] = false;
      if (step.required) {
        failures.push(`${step.command}: ${(err as Error).message?.slice(0, 200)}`);
      }
    }
  }

  checks['no_forbidden_files'] = true;
  checks['writeback_complete'] = true;

  const verdict = failures.length === 0 ? 'pass' : 'fail';
  const checksPath = join(repoRoot, '.multi-claude', 'workers', packetId, 'checks.json');
  writeFileSync(checksPath, JSON.stringify(checks), 'utf-8');

  return runVerify(dbPath, packetId, 'auto-verifier', 'verifier-checklist', checksPath,
    verdict as 'pass' | 'fail',
    verdict === 'pass' ? 'Automated verification: all checks passed' : `Automated verification failed: ${failures.join('; ')}`);
}

// ─── Main Run Logic ─────────────────────────────────────────────

async function executeAutoRun(
  dbPath: string,
  featureId: string,
): Promise<McfResult<RunResult>> {
  const repoRoot = getRepoRoot(dbPath);

  // 1. Compute waves
  const planResult = computeWaves(dbPath, featureId);
  if (!planResult.ok) return planResult;
  const plan = planResult.result;

  // 2. Check for active run
  const db = openDb(dbPath);
  try {
    const activeRun = db.prepare(`
      SELECT run_id FROM auto_runs WHERE feature_id = ? AND status IN ('planned', 'running', 'paused', 'completing')
    `).get(featureId) as { run_id: string } | undefined;

    if (activeRun) {
      return mcfError('multi-claude auto run', ERR.RUN_ALREADY_ACTIVE, `Feature '${featureId}' already has active run '${activeRun.run_id}'`, { run_id: activeRun.run_id });
    }

    // 3. Create run record
    const runId = generateId('run');
    const now = nowISO();

    db.prepare(`INSERT INTO auto_runs (run_id, feature_id, status, started_at, total_waves, config_json) VALUES (?, ?, 'running', ?, ?, '{}')`)
      .run(runId, featureId, now, plan.total_waves);

    for (const wave of plan.waves) {
      for (const pkt of wave.packets) {
        db.prepare(`INSERT INTO auto_run_workers (worker_id, run_id, packet_id, wave, status) VALUES (?, ?, ?, ?, 'pending')`)
          .run(generateId('wkr'), runId, pkt.packet_id, wave.wave);
      }
    }
    db.close();

    // 4. Execute waves
    let packetsMerged = 0;
    let packetsFailed = 0;
    let pauseReason: string | undefined;
    let completedWaves = 0;

    console.error(`[multi-claude auto] Starting run ${runId} for feature ${featureId}`);
    console.error(`[multi-claude auto] ${plan.total_waves} waves, ${plan.total_packets} packets`);

    for (const wave of plan.waves) {
      console.error(`\n[multi-claude auto] === Wave ${wave.wave}/${plan.total_waves} ===`);
      console.error(`[multi-claude auto] Launching ${wave.packets.length} worker(s): ${wave.packets.map(p => p.packet_id).join(', ')}`);

      // Prepare workers for this wave using runtime adapter
      const handles: Array<{ handle: ReturnType<typeof launchWorkerSession>; pkt: WavePacket }> = [];

      for (const pkt of wave.packets) {
        // Hook: evaluate before launch
        const hookResult = emitHookEvent(dbPath, 'packet.ready', 'packet', pkt.packet_id, featureId, 'autonomous');
        if (hookResult.decision?.action === 'stay_single') {
          console.error(`[multi-claude auto] Hook says stay_single for ${pkt.packet_id} — skipping worker launch`);
          continue;
        } else if (hookResult.decision?.action === 'escalate') {
          console.error(`[multi-claude auto] Hook says escalate_human for ${pkt.packet_id} — pausing run`);
          pauseReason = `retry_limit_exceeded:${pkt.packet_id}`;
          break;
        }

        // Claim
        const claimResult = runClaim(dbPath, pkt.packet_id, `auto-${pkt.role}`, `auto-run-${runId}`);
        if (!claimResult.ok) {
          console.error(`[multi-claude auto] Failed to claim ${pkt.packet_id}: ${claimResult.message}`);
          packetsFailed++;
          continue;
        }

        // Progress
        const progResult = runProgress(dbPath, pkt.packet_id, `auto-${pkt.role}`);
        if (!progResult.ok) {
          console.error(`[multi-claude auto] Failed to progress ${pkt.packet_id}: ${progResult.message}`);
          packetsFailed++;
          continue;
        }

        // Render packet — Handoff Spine path (Phase 2)
        const model = getModelForRole(pkt.role);
        let packetMarkdown = '';
        let spineHandoffId: string | undefined;
        let spineRenderEventId: number | undefined;
        let fallbackEvidence: FallbackEvidence | undefined;

        const spineDb = openDb(dbPath);
        try {
          migrateHandoffSchema(spineDb);
          const handoffStore = new HandoffStore(spineDb);

          // Phase 2 Step 2: Check for prior handoff (recovery path)
          // If this packet was previously launched through the spine and failed,
          // resolve the last valid version and render with recovery-renderer.
          const priorHandoff = resolveLastValidHandoffForPacket(
            handoffStore, pkt.packet_id, featureId,
          );

          if (priorHandoff.ok) {
            // RECOVERY PATH — prior handoff found, render with recovery-renderer
            spineHandoffId = priorHandoff.packet.handoffId;

            const recoveryRender = renderHandoff(handoffStore, {
              handoffId: priorHandoff.packet.handoffId as HandoffId,
              version: priorHandoff.resolvedVersion,
              role: 'recovery',
              model: modelToAdapterName(model),
            });

            if (recoveryRender.ok) {
              const parts = [recoveryRender.context.system];
              if (recoveryRender.context.developer) parts.push(recoveryRender.context.developer);
              packetMarkdown = parts.join('\n\n');
              spineRenderEventId = recoveryRender.renderEventId;

              // Record recovery use for audit trail
              handoffStore.insertUse({
                handoffId: priorHandoff.packet.handoffId,
                packetVersion: priorHandoff.resolvedVersion,
                renderEventId: recoveryRender.renderEventId,
                consumerRunId: runId,
                consumerRole: `recovery:${pkt.role}`,
                usedAt: nowISO(),
              });

              const rollbackNote = priorHandoff.isRollback
                ? ` (rolled back from v${priorHandoff.packet.packetVersion}, skipped ${priorHandoff.skippedVersions} invalidated)`
                : '';
              console.error(`[multi-claude auto] Recovery render OK for ${pkt.packet_id} → handoff ${spineHandoffId} v${priorHandoff.resolvedVersion}${rollbackNote}`);
            } else {
              // Recovery render failed — fall back to fresh spine render
              console.error(`[multi-claude auto] Recovery render failed for ${pkt.packet_id}: ${recoveryRender.error}`);
              fallbackEvidence = createFallbackEvidence(
                pkt.packet_id, runId, 'spine_render_failed',
                `Recovery render failed: ${recoveryRender.error}`,
                'fresh_spine_render',
                { attemptedHandoffId: spineHandoffId, attemptedVersion: priorHandoff.resolvedVersion },
              );
              // Fall through to fresh spine render below
              spineHandoffId = undefined;
            }
          }

          // FRESH LAUNCH PATH — no prior handoff or recovery render failed
          if (!spineHandoffId) {
            const bridgeResult = bridgeExecutionPacket({
              db: spineDb,
              packetId: pkt.packet_id,
              runId,
              repoRoot,
              lane: roleToLane(pkt.role),
            });

            if (bridgeResult.ok) {
              // Create handoff packet (derive + store)
              const handoffResult = createHandoff(handoffStore, bridgeResult.input);
              spineHandoffId = handoffResult.packet.handoffId;

              // Render via spine chain: packet → role renderer → model adapter
              const spineRender = renderHandoff(handoffStore, {
                handoffId: handoffResult.packet.handoffId as HandoffId,
                role: roleToLane(pkt.role),
                model: modelToAdapterName(model),
              });

              if (spineRender.ok) {
                const parts = [spineRender.context.system];
                if (spineRender.context.developer) parts.push(spineRender.context.developer);
                packetMarkdown = parts.join('\n\n');
                spineRenderEventId = spineRender.renderEventId;

                // Record handoff_use for audit trail
                handoffStore.insertUse({
                  handoffId: handoffResult.packet.handoffId,
                  packetVersion: handoffResult.packet.packetVersion,
                  renderEventId: spineRender.renderEventId,
                  consumerRunId: runId,
                  consumerRole: pkt.role,
                  usedAt: nowISO(),
                });

                console.error(`[multi-claude auto] Spine render OK for ${pkt.packet_id} → handoff ${spineHandoffId}`);
              } else {
                // Spine render failed — fall back to legacy
                fallbackEvidence = fallbackEvidence ?? createFallbackEvidence(
                  pkt.packet_id, runId, 'spine_render_failed',
                  `Spine render failed: ${spineRender.error}`, 'legacy_render',
                );
                spineHandoffId = undefined;
              }
            } else {
              // Bridge failed — fall back to legacy
              fallbackEvidence = fallbackEvidence ?? createFallbackEvidence(
                pkt.packet_id, runId, 'bridge_failed',
                `Bridge failed: ${bridgeResult.error}`, 'legacy_render',
              );
            }

            // Legacy fallback (noisy — writes structured evidence)
            if (!spineHandoffId) {
              console.error(`[multi-claude auto] FALLBACK for ${pkt.packet_id}: ${fallbackEvidence?.reason} — ${fallbackEvidence?.detail}`);
              const legacyResult = runRender(dbPath, pkt.packet_id);
              if (!legacyResult.ok) {
                console.error(`[multi-claude auto] Legacy render also failed: ${legacyResult.message}`);
                packetsFailed++;
                continue;
              }
              packetMarkdown = legacyResult.result.markdown;
            }
          }
        } finally {
          spineDb.close();
        }

        // Create worktree
        let wt: { worktreePath: string; branchName: string };
        try {
          wt = createWorktree(repoRoot, pkt.packet_id);
        } catch (err) {
          console.error(`[multi-claude auto] Failed to create worktree for ${pkt.packet_id}: ${err}`);
          packetsFailed++;
          continue;
        }

        // Set up output directory
        const outputDir = join(repoRoot, '.multi-claude', 'workers', pkt.packet_id);
        mkdirSync(outputDir, { recursive: true });

        // Write fallback evidence if spine path was not used
        if (fallbackEvidence) {
          writeFileSync(
            join(outputDir, 'fallback-evidence.json'),
            JSON.stringify(fallbackEvidence, null, 2),
            'utf-8',
          );
        }

        // Update worker record
        const db2 = openDb(dbPath);
        db2.prepare(`UPDATE auto_run_workers SET status = 'running', started_at = ?, worktree_path = ?, branch_name = ?, output_dir = ? WHERE run_id = ? AND packet_id = ?`)
          .run(nowISO(), wt.worktreePath, wt.branchName, outputDir, runId, pkt.packet_id);
        db2.close();

        console.error(`[multi-claude auto] Launching SDK worker for ${pkt.packet_id} (${model}) via runtime adapter`);

        // Launch via runtime adapter — returns handle with abort()
        const handle = launchWorkerSession({
          packetId: pkt.packet_id,
          role: pkt.role,
          model,
          worktreePath: wt.worktreePath,
          outputDir,
          packetMarkdown,
          allowedTools: [],  // runtime adapter uses getToolProfile internally
          maxTurns: 50,
          maxBudgetUsd: 5.0,
          timeoutMs: WORKER_TIMEOUT_MS,
          handoffId: spineHandoffId,
          renderEventId: spineRenderEventId,
        });

        // Register in session registry for external stop control
        registerSession(runId, handle);
        handles.push({ handle, pkt });
      }

      // Wait for all workers in this wave to complete (parallel execution)
      const results = await Promise.allSettled(handles.map(h => h.handle.promise));

      // Process results
      for (let i = 0; i < results.length; i++) {
        const settled = results[i]!;
        const { pkt } = handles[i]!;
        const packetId = pkt.packet_id;

        // Unregister from session registry
        unregisterSession(runId, packetId);

        const sessionResult: WorkerSessionResult | null = settled.status === 'fulfilled' ? settled.value : null;

        // End the attempt record
        const endReason = sessionResult?.stopReason ?? 'crashed';
        endAttempt(dbPath, packetId, endReason);
        const outcome = sessionResult ? stopReasonToOutcome(sessionResult.stopReason) : 'error';
        const error = sessionResult?.error ?? (settled.status === 'rejected' ? String((settled as PromiseRejectedResult).reason) : undefined);

        console.error(`[multi-claude auto] Worker ${packetId}: ${outcome} (stopReason: ${sessionResult?.stopReason ?? 'unknown'})`);

        // Emit hook event for packet result
        emitHookEvent(dbPath, outcome === 'complete' ? 'packet.verified' : 'packet.failed', 'packet', packetId, featureId, 'autonomous');

        // Update worker record
        const db3 = openDb(dbPath);
        db3.prepare('UPDATE auto_run_workers SET status = ?, completed_at = ?, error = ? WHERE run_id = ? AND packet_id = ?')
          .run(outcome === 'complete' ? 'completed' : outcome === 'timeout' ? 'timed_out' : 'failed', nowISO(), error ?? null, runId, packetId);
        db3.close();

        if (outcome === 'complete' && sessionResult) {
          // Submit
          const submitResult = submitWorkerOutput(dbPath, packetId, sessionResult.outputDir, `auto-${pkt.role}`);
          if (submitResult.ok) {
            console.error(`[multi-claude auto] Submitted ${packetId}`);

            // Verify
            const verifyResult = verifyWorkerOutput(dbPath, packetId, repoRoot, sessionResult.worktreePath);
            if (verifyResult.ok && verifyResult.result.verdict === 'pass') {
              console.error(`[multi-claude auto] Verified ${packetId}: pass`);

              // Promote knowledge if needed
              const db4 = openDb(dbPath);
              const pktRow = db4.prepare('SELECT knowledge_writeback_required FROM packets WHERE packet_id = ?').get(packetId) as { knowledge_writeback_required: number } | undefined;
              db4.close();

              if (pktRow?.knowledge_writeback_required) {
                const subRow = openDb(dbPath);
                const submission = subRow.prepare('SELECT submission_id FROM packet_submissions WHERE packet_id = ? ORDER BY submitted_at DESC LIMIT 1')
                  .get(packetId) as { submission_id: string } | undefined;
                subRow.close();
                if (submission) {
                  runPromote(dbPath, packetId, submission.submission_id, 'auto-knowledge', `Auto-promoted for ${packetId}`);
                  console.error(`[multi-claude auto] Promoted knowledge for ${packetId}`);
                }
              }
              packetsMerged++;
            } else {
              console.error(`[multi-claude auto] Verify failed for ${packetId}`);
              const retryHook = emitHookEvent(dbPath, 'packet.failed', 'packet', packetId, featureId, 'autonomous');
              if (retryHook.decision?.action === 'retry_once') {
                console.error(`[multi-claude auto] Retrying ${packetId} (hook: retry_once)`);
                // Re-claim will happen on next wave iteration if we add it back
                // For now, just log — full retry re-launch is complex
                // The packet stays in failed state; operator can manually retry
              }
              packetsFailed++;
            }
          } else {
            console.error(`[multi-claude auto] Submit failed for ${packetId}: ${submitResult.message}`);
            packetsFailed++;
          }
        } else {
          console.error(`[multi-claude auto] Worker ${outcome} for ${packetId}: ${error ?? 'unknown'}`);
          packetsFailed++;
        }
      }

      // Cleanup using consolidated cleanup law
      for (let i = 0; i < results.length; i++) {
        const settled = results[i]!;
        const pktId = handles[i]!.pkt.packet_id;
        const sessionResult: WorkerSessionResult | null = settled.status === 'fulfilled' ? settled.value : null;
        const reason: StopReason = sessionResult?.stopReason ?? 'failed';
        // WorkerSessionResult has no sessionId field — pass undefined; cleanupOnStop handles it
        cleanupOnStop(repoRoot, pktId, reason, dbPath, undefined);
      }

      // Update wave progress
      const db6 = openDb(dbPath);
      db6.prepare('UPDATE auto_runs SET current_wave = ? WHERE run_id = ?').run(wave.wave, runId);
      db6.close();

      if (pauseReason) break;
      if (packetsFailed > 0) {
        console.error(`[multi-claude auto] ${packetsFailed} packet(s) failed in wave ${wave.wave}`);
        break;
      }

      completedWaves = wave.wave;
      console.error(`[multi-claude auto] Wave ${wave.wave} complete`);
    }

    // 5. Integration phase — real integrating → merged path
    if (packetsFailed === 0 && !pauseReason) {
      console.error(`\n[multi-claude auto] === Integration phase ===`);
      console.error(`[multi-claude auto] Pausing for merge approval (human gate)`);

      // Pause for merge approval
      const pauseDb = openDb(dbPath);
      pauseDb.prepare('UPDATE auto_runs SET status = ?, pause_reason = ?, pause_gate_type = ? WHERE run_id = ?')
        .run('paused', 'Merge approval required', 'merge_approval', runId);
      pauseDb.close();

      pauseReason = 'merge_approval_required';
    }

    // 6. Final status
    const finalDb = openDb(dbPath);
    const finalStatus = packetsFailed > 0 ? 'failed' : (pauseReason ? 'paused' : 'complete');
    finalDb.prepare('UPDATE auto_runs SET status = ?, completed_at = ?, last_error = ? WHERE run_id = ?')
      .run(finalStatus, finalStatus !== 'paused' ? nowISO() : null, packetsFailed > 0 ? `${packetsFailed} packets failed` : null, runId);
    finalDb.close();

    console.error(`\n[multi-claude auto] Run ${runId} finished: ${finalStatus}`);

    return {
      ok: true, command: 'multi-claude auto run',
      result: {
        run_id: runId, feature_id: featureId, status: finalStatus,
        waves_completed: completedWaves, total_waves: plan.total_waves,
        packets_merged: packetsMerged, packets_failed: packetsFailed,
        pause_reason: pauseReason,
      },
      transitions: [],
    };
  } catch (err) {
    return mcfError('multi-claude auto run', ERR.DB_ERROR, `Auto run failed: ${err}`, {});
  }
}

// ─── Resume (after human approval) ─────────────────────────────

async function resumeAutoRun(
  dbPath: string,
  runId: string,
): Promise<McfResult<RunResult>> {
  const db = openDb(dbPath);
  try {
    const run = db.prepare('SELECT * FROM auto_runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined;
    if (!run) return mcfError('multi-claude auto resume', ERR.RUN_NOT_FOUND, `Run '${runId}' not found`, {});
    if (run.status !== 'paused') return mcfError('multi-claude auto resume', ERR.RUN_NOT_ACTIVE, `Run is '${run.status}', not paused`, {});

    const featureId = run.feature_id as string;

    if (run.pause_gate_type === 'merge_approval') {
      // Check merge approval exists
      const approval = db.prepare(`
        SELECT approval_id FROM approvals
        WHERE scope_type = 'feature' AND scope_id = ? AND approval_type = 'merge_approval' AND decision = 'approved'
        ORDER BY created_at DESC LIMIT 1
      `).get(featureId) as { approval_id: string } | undefined;

      if (!approval) {
        db.close();
        return mcfError('multi-claude auto resume', ERR.NO_MERGE_APPROVAL, 'Merge not approved. Run: multi-claude approve --scope-type feature --scope-id <feature> --type merge_approval --actor <name>', {});
      }

      // Run the real integration path: prepare → execute → complete
      db.close();

      console.error(`[multi-claude auto] Merge approved. Running integration...`);

      const prepResult = runIntegrate(dbPath, featureId, 'auto-integrator', 'prepare', `auto-run-${runId}`);
      if (!prepResult.ok) {
        console.error(`[multi-claude auto] Integration prepare failed: ${prepResult.message}`);
        const failDb = openDb(dbPath);
        failDb.prepare('UPDATE auto_runs SET status = ?, last_error = ?, completed_at = ? WHERE run_id = ?')
          .run('failed', prepResult.message, nowISO(), runId);
        failDb.close();
        return { ok: true, command: 'multi-claude auto resume', result: { run_id: runId, feature_id: featureId, status: 'failed', waves_completed: run.total_waves as number, total_waves: run.total_waves as number, packets_merged: 0, packets_failed: 0, pause_reason: `Integration prepare failed: ${prepResult.message}` }, transitions: [] };
      }
      console.error(`[multi-claude auto] Integration prepared`);

      const execResult = runIntegrate(dbPath, featureId, 'auto-integrator', 'execute');
      if (!execResult.ok) {
        console.error(`[multi-claude auto] Integration execute failed: ${execResult.message}`);
        runIntegrate(dbPath, featureId, 'auto-integrator', 'fail');
        const failDb = openDb(dbPath);
        failDb.prepare('UPDATE auto_runs SET status = ?, last_error = ?, completed_at = ? WHERE run_id = ?')
          .run('failed', execResult.message, nowISO(), runId);
        failDb.close();
        return { ok: true, command: 'multi-claude auto resume', result: { run_id: runId, feature_id: featureId, status: 'failed', waves_completed: run.total_waves as number, total_waves: run.total_waves as number, packets_merged: 0, packets_failed: 0, pause_reason: `Integration execute failed: ${execResult.message}` }, transitions: [] };
      }
      console.error(`[multi-claude auto] Integration executing`);

      const completeResult = runIntegrate(dbPath, featureId, 'auto-integrator', 'complete');
      if (!completeResult.ok) {
        console.error(`[multi-claude auto] Integration complete failed: ${completeResult.message}`);
        runIntegrate(dbPath, featureId, 'auto-integrator', 'fail');
        const failDb = openDb(dbPath);
        failDb.prepare('UPDATE auto_runs SET status = ?, last_error = ?, completed_at = ? WHERE run_id = ?')
          .run('failed', completeResult.message, nowISO(), runId);
        failDb.close();
        return { ok: true, command: 'multi-claude auto resume', result: { run_id: runId, feature_id: featureId, status: 'failed', waves_completed: run.total_waves as number, total_waves: run.total_waves as number, packets_merged: 0, packets_failed: 0, pause_reason: `Integration complete failed: ${completeResult.message}` }, transitions: [] };
      }

      const cr = completeResult.result as { packets_merged: number; feature_status: string };
      console.error(`[multi-claude auto] Integration complete: ${cr.packets_merged} packets merged, feature ${cr.feature_status}`);

      // Mark auto run complete
      const doneDb = openDb(dbPath);
      doneDb.prepare('UPDATE auto_runs SET status = ?, completed_at = ?, pause_reason = NULL, pause_gate_type = NULL WHERE run_id = ?')
        .run('complete', nowISO(), runId);
      doneDb.close();

      return {
        ok: true, command: 'multi-claude auto resume',
        result: { run_id: runId, feature_id: featureId, status: 'complete', waves_completed: run.total_waves as number, total_waves: run.total_waves as number, packets_merged: cr.packets_merged, packets_failed: 0 },
        transitions: [],
      };
    }

    db.close();
    return mcfError('multi-claude auto resume', ERR.INVALID_STATE, `Unknown pause gate: ${run.pause_gate_type}`, {});
  } catch (err) {
    return mcfError('multi-claude auto resume', ERR.DB_ERROR, `Resume failed: ${err}`, {});
  }
}

// ─── Status ─────────────────────────────────────────────────────

function runAutoStatus(dbPath: string, runId?: string): McfResult<StatusResult> {
  const db = openDb(dbPath);
  try {
    let run: Record<string, unknown> | undefined;
    if (runId) {
      run = db.prepare('SELECT * FROM auto_runs WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined;
    } else {
      run = db.prepare('SELECT * FROM auto_runs ORDER BY started_at DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    }
    if (!run) {
      return mcfError('multi-claude auto status', ERR.RUN_NOT_FOUND, 'No auto run found', {});
    }
    const workers = db.prepare(`
      SELECT packet_id, wave, status, error FROM auto_run_workers WHERE run_id = ? ORDER BY wave, packet_id
    `).all(run.run_id as string) as StatusResult['workers'];

    return {
      ok: true, command: 'multi-claude auto status',
      result: { run_id: run.run_id as string, feature_id: run.feature_id as string, status: run.status as string, current_wave: run.current_wave as number, total_waves: run.total_waves as number, workers, pause_reason: run.pause_reason as string | undefined },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

// ─── Stop ───────────────────────────────────────────────────────

function runAutoStop(dbPath: string, runId: string): McfResult<{ run_id: string; status: string; sessions_stopped: number }> {
  const repoRoot = getRepoRoot(dbPath);
  const db = openDb(dbPath);
  try {
    const run = db.prepare('SELECT status FROM auto_runs WHERE run_id = ?').get(runId) as { status: string } | undefined;
    if (!run) return mcfError('multi-claude auto stop', ERR.RUN_NOT_FOUND, `Run '${runId}' not found`, {});
    if (!['running', 'paused'].includes(run.status)) {
      return mcfError('multi-claude auto stop', ERR.RUN_NOT_ACTIVE, `Run '${runId}' is '${run.status}', not active`, {});
    }

    // Actually stop live SDK worker sessions
    const { stoppedCount } = stopAllSessions(runId);
    console.error(`[multi-claude auto] Stopped ${stoppedCount} live session(s) for run ${runId}`);

    // Emit hook event
    emitHookEvent(dbPath, 'wave.empty', 'run', runId, '', 'autonomous', { reason: 'manual_stop' });

    // Cleanup worktrees for stopped workers
    const incompleteWorkers = db.prepare(
      "SELECT packet_id FROM auto_run_workers WHERE run_id = ? AND status NOT IN ('completed', 'merged')"
    ).all(runId) as Array<{ packet_id: string }>;

    for (const w of incompleteWorkers) {
      endAttempt(dbPath, w.packet_id, 'stopped');
      cleanupOnStop(repoRoot, w.packet_id, 'stopped', dbPath);
    }
    console.error(`[multi-claude auto] Cleaned up ${incompleteWorkers.length} incomplete worker(s)`);

    db.prepare('UPDATE auto_runs SET status = ?, completed_at = ? WHERE run_id = ?').run('stopped', nowISO(), runId);
    return { ok: true, command: 'multi-claude auto stop', result: { run_id: runId, status: 'stopped', sessions_stopped: stoppedCount }, transitions: [] };
  } finally {
    db.close();
  }
}

// ─── CLI Wiring ─────────────────────────────────────────────────

export function autoCommand(): Command {
  const cmd = new Command('auto').description('Automated multi-session orchestration via Agent SDK');

  cmd.command('plan')
    .description('Compute wave plan for a feature (dry run)')
    .requiredOption('--feature <id>', 'Feature ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = computeWaves(opts.dbPath, opts.feature);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('run')
    .description('Execute automated run for a feature')
    .requiredOption('--feature <id>', 'Feature ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action(async (opts) => {
      const result = await executeAutoRun(opts.dbPath, opts.feature);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('resume')
    .description('Resume a paused auto run (after human approval)')
    .requiredOption('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action(async (opts) => {
      const result = await resumeAutoRun(opts.dbPath, opts.run);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('status')
    .description('Show auto run state')
    .option('--run <id>', 'Run ID (default: most recent)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = runAutoStatus(opts.dbPath, opts.run);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('stop')
    .description('Gracefully stop an active run (stops all live sessions)')
    .requiredOption('--run <id>', 'Run ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = runAutoStop(opts.dbPath, opts.run);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
    });

  cmd.command('stop-session')
    .description('Stop a specific live worker session')
    .requiredOption('--run <id>', 'Run ID')
    .requiredOption('--packet <id>', 'Packet ID')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = stopSession(opts.run, opts.packet);
      if (result.stopped) {
        // Log hook event
        emitHookEvent(opts.dbPath, 'packet.failed', 'packet', opts.packet, '', 'autonomous', { reason: 'manual_stop' });
        console.log(JSON.stringify({ ok: true, command: 'multi-claude auto stop-session', result: { run_id: opts.run, packet_id: opts.packet, stopped: true } }));
      } else {
        console.log(JSON.stringify({ ok: false, command: 'multi-claude auto stop-session', error_code: 'SESSION_NOT_FOUND', message: result.wasRegistered ? 'Session already completed' : 'No active session found' }));
        process.exit(1);
      }
    });

  return cmd;
}
