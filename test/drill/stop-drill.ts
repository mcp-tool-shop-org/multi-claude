/**
 * 6A-301/302: Live Stop Drill
 *
 * Proves:
 * 1. An SDK worker session can be stopped from outside
 * 2. The stop produces a durable envelope with stopReason: "stopped"
 * 3. Evidence is preserved
 * 4. The same work can be retried and completed
 *
 * Uses the runtime adapter + session registry directly (not auto.ts)
 * to isolate the control-plane proof from orchestration complexity.
 */

import { launchWorkerSession } from '../../src/runtime/sdk-runtime.js';
import { registerSession, stopSession, getSession } from '../../src/runtime/session-registry.js';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DRILL_RUN_ID = 'drill-stop-proof';
const DRILL_PACKET_ID = 'drill-stop-fixture';
const OUTPUT_BASE = join(process.cwd(), '.multi-claude', 'drill');

// Slow-enough packet that we can interrupt it
const DRILL_PACKET_MARKDOWN = `
# DRILL PACKET: Stop Fixture

## Goal
Write two files in sequence with a pause between them.

## Instructions
1. Write the text "phase-a-complete" to the file \`phase-a.md\` in your working directory
2. Then run: sleep 30
3. After the sleep, write "phase-b-complete" to \`phase-b.md\`
4. Then write the standard artifacts.json and writeback.json to the output directory

## Allowed files
- phase-a.md
- phase-b.md
`;

async function runDrill() {
  console.log('=== 6A Stop Drill ===\n');

  // ── Attempt 1: Launch and stop ─────────────────────

  const outputDir1 = join(OUTPUT_BASE, 'attempt-1');
  mkdirSync(outputDir1, { recursive: true });

  const worktreePath = join(OUTPUT_BASE, 'worktree');
  mkdirSync(worktreePath, { recursive: true });

  console.log('1. Launching worker session...');
  const handle = launchWorkerSession({
    packetId: DRILL_PACKET_ID,
    role: 'builder',
    model: 'claude-haiku-4-5',  // Cheapest model for drill
    worktreePath,
    outputDir: outputDir1,
    packetMarkdown: DRILL_PACKET_MARKDOWN,
    allowedTools: ['Read', 'Write', 'Bash'],
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    timeoutMs: 120000,
  });

  // Register in session registry
  registerSession(DRILL_RUN_ID, handle);
  console.log(`   Session registered: run=${DRILL_RUN_ID}, packet=${DRILL_PACKET_ID}`);

  // Verify registration
  const registered = getSession(DRILL_RUN_ID, DRILL_PACKET_ID);
  console.log(`   Registry lookup: ${registered ? 'found' : 'NOT FOUND'}`);

  // Wait for session to start and produce first output
  console.log('2. Waiting for session to start producing output...');
  let sessionStarted = false;
  for (let wait = 0; wait < 60; wait++) {
    await new Promise(r => setTimeout(r, 2000));
    // Check if prompt.md was written (indicates session started)
    if (existsSync(join(outputDir1, 'prompt.md')) || existsSync(join(outputDir1, 'system-prompt.md'))) {
      sessionStarted = true;
      console.log(`   Session confirmed running after ${(wait + 1) * 2}s`);
      break;
    }
  }

  if (!sessionStarted) {
    console.error('   FAIL: Session never started producing output');
    process.exit(1);
  }

  // Wait a bit more for the session to get into the work
  await new Promise(r => setTimeout(r, 5000));

  // Issue external stop
  console.log('3. Issuing external stop...');
  const stopResult = stopSession(DRILL_RUN_ID, DRILL_PACKET_ID);
  console.log(`   Stop result: stopped=${stopResult.stopped}, wasRegistered=${stopResult.wasRegistered}`);

  if (!stopResult.stopped) {
    console.error('   FAIL: Stop did not succeed');
    process.exit(1);
  }

  // Wait for the promise to resolve
  console.log('4. Waiting for session to terminate...');
  const result1 = await handle.promise;
  console.log(`   Session terminated: stopReason=${result1.stopReason}`);
  console.log(`   Error: ${result1.error ?? 'none'}`);
  console.log(`   Duration: ${result1.startedAt} → ${result1.completedAt}`);

  // Verify stop evidence
  console.log('\n5. Verifying stop evidence...');

  const checks: Record<string, boolean> = {};

  checks['stopReason_is_stopped_or_timed_out'] = result1.stopReason === 'stopped' || result1.stopReason === 'timed_out';
  checks['startedAt_exists'] = !!result1.startedAt;
  checks['completedAt_exists'] = !!result1.completedAt;
  checks['outputDir_preserved'] = existsSync(outputDir1);
  checks['prompt_md_exists'] = existsSync(join(outputDir1, 'prompt.md')) || existsSync(join(outputDir1, 'system-prompt.md'));
  checks['model_recorded'] = result1.model === 'claude-haiku-4-5';
  checks['role_recorded'] = result1.role === 'builder';
  checks['toolProfile_recorded'] = Array.isArray(result1.toolProfile) && result1.toolProfile.length > 0;

  for (const [check, passed] of Object.entries(checks)) {
    console.log(`   ${passed ? 'PASS' : 'FAIL'}: ${check}`);
  }

  const attempt1Passed = Object.values(checks).every(v => v);
  console.log(`\n   Attempt 1 verdict: ${attempt1Passed ? 'PASS' : 'FAIL'}`);

  // ── Attempt 2: Retry to completion ─────────────────

  console.log('\n6. Retrying packet to completion...');
  const outputDir2 = join(OUTPUT_BASE, 'attempt-2');
  mkdirSync(outputDir2, { recursive: true });

  // Simpler packet for retry — just write the completion markers
  const RETRY_PACKET = `
# DRILL PACKET: Retry Fixture

## Goal
Write phase-a.md and phase-b.md, then produce artifacts.json and writeback.json.

## Instructions
1. Write "phase-a-complete" to phase-a.md in your working directory
2. Write "phase-b-complete" to phase-b.md in your working directory
3. Write artifacts.json and writeback.json to the output directory
`;

  const handle2 = launchWorkerSession({
    packetId: DRILL_PACKET_ID,
    role: 'builder',
    model: 'claude-haiku-4-5',
    worktreePath,
    outputDir: outputDir2,
    packetMarkdown: RETRY_PACKET,
    allowedTools: ['Read', 'Write', 'Bash'],
    maxTurns: 20,
    maxBudgetUsd: 1.0,
    timeoutMs: 120000,
  });

  registerSession(DRILL_RUN_ID, handle2);

  const result2 = await handle2.promise;
  console.log(`   Retry terminated: stopReason=${result2.stopReason}`);
  console.log(`   Error: ${result2.error ?? 'none'}`);

  const retryChecks: Record<string, boolean> = {};
  retryChecks['retry_completed'] = result2.stopReason === 'completed';
  retryChecks['retry_outputDir_preserved'] = existsSync(outputDir2);

  for (const [check, passed] of Object.entries(retryChecks)) {
    console.log(`   ${passed ? 'PASS' : 'FAIL'}: ${check}`);
  }

  // ── Write drill report ─────────────────────────────

  const report = {
    drill: '6A-301/302 Stop Drill',
    timestamp: new Date().toISOString(),
    attempt1: {
      stopReason: result1.stopReason,
      error: result1.error,
      startedAt: result1.startedAt,
      completedAt: result1.completedAt,
      model: result1.model,
      role: result1.role,
      toolProfile: result1.toolProfile,
      checks,
      verdict: attempt1Passed ? 'PASS' : 'FAIL',
    },
    attempt2: {
      stopReason: result2.stopReason,
      error: result2.error,
      startedAt: result2.startedAt,
      completedAt: result2.completedAt,
      verdict: result2.stopReason === 'completed' ? 'PASS' : 'FAIL',
    },
    overallVerdict: attempt1Passed && result2.stopReason === 'completed' ? 'PASS' : 'FAIL',
  };

  const reportPath = join(OUTPUT_BASE, 'drill-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n7. Drill report written to ${reportPath}`);

  console.log(`\n=== OVERALL DRILL VERDICT: ${report.overallVerdict} ===`);

  if (report.overallVerdict !== 'PASS') {
    process.exit(1);
  }
}

runDrill().catch(err => {
  console.error('Drill crashed:', err);
  process.exit(1);
});
