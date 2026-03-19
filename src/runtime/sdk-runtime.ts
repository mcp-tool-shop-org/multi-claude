import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkerConfig, WorkerSessionResult, WorkerSessionHandle, StopReason } from './types.js';
import { getToolProfile } from './tool-profiles.js';
import { WORKER_OUTPUT_INSTRUCTIONS, validateArtifactManifest, validateWriteback } from '../schema/submission.js';
import { nowISO } from '../lib/ids.js';

/** Build the system prompt for a worker session */
function buildSystemPrompt(config: WorkerConfig): string {
  const outPath = config.outputDir.replace(/\\/g, '/');
  return `You are a multi-claude worker executing a build packet. Follow the packet instructions exactly.

RULES:
- Make ALL code changes inside your working directory
- Do NOT run any multi-claude commands
- Do NOT access files outside your working directory
- Stay within the allowed files listed in the packet
- Do NOT modify forbidden files listed in the packet

YOUR PACKET:
${config.packetMarkdown}

OUTPUT DIRECTORY: ${outPath}
Write all output files to this exact directory.

${WORKER_OUTPUT_INSTRUCTIONS.replace(/artifacts\.json/g, `${outPath}/artifacts.json`).replace(/writeback\.json/g, `${outPath}/writeback.json`).replace(/ERROR/g, `${outPath}/ERROR`)}`;
}

/** Hash a prompt for dedup/audit */
function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/** Classify the worker output into a stop reason */
function classifyOutput(outputDir: string): { stopReason: StopReason; error?: string } {
  const errorPath = join(outputDir, 'ERROR');
  const artifactsPath = join(outputDir, 'artifacts.json');
  const writebackPath = join(outputDir, 'writeback.json');

  if (existsSync(errorPath)) {
    return { stopReason: 'failed', error: readFileSync(errorPath, 'utf-8').trim() };
  }

  if (!existsSync(artifactsPath) || !existsSync(writebackPath)) {
    return { stopReason: 'malformed_output', error: 'Missing artifacts.json or writeback.json' };
  }

  // Validate JSON structure
  try {
    const artRaw = readFileSync(artifactsPath, 'utf-8');
    const wbRaw = readFileSync(writebackPath, 'utf-8');
    const artResult = validateArtifactManifest(artRaw);
    const wbResult = validateWriteback(wbRaw, true);

    if ('error' in artResult) {
      return { stopReason: 'malformed_output', error: `artifacts.json: ${artResult.error}` };
    }
    if ('error' in wbResult) {
      return { stopReason: 'malformed_output', error: `writeback.json: ${wbResult.error}` };
    }

    return { stopReason: 'completed' };
  } catch (err) {
    return { stopReason: 'malformed_output', error: `JSON parse error: ${err}` };
  }
}

/** Launch a real SDK worker session with AbortController-based cancellation */
export function launchWorkerSession(config: WorkerConfig): WorkerSessionHandle {
  const abortController = new AbortController();
  const tools = getToolProfile(config.role);
  const systemPrompt = buildSystemPrompt(config);
  const startedAt = nowISO();

  // Write prompt for audit
  writeFileSync(join(config.outputDir, 'prompt.md'), config.packetMarkdown, 'utf-8');
  writeFileSync(join(config.outputDir, 'system-prompt.md'), systemPrompt, 'utf-8');
  writeFileSync(join(config.outputDir, 'prompt-hash.txt'), hashPrompt(systemPrompt), 'utf-8');

  const promise = (async (): Promise<WorkerSessionResult> => {
    const makeResult = (stopReason: StopReason, error?: string): WorkerSessionResult => ({
      packetId: config.packetId,
      worktreePath: config.worktreePath,
      branchName: `multi-claude/${config.packetId}`,
      outputDir: config.outputDir,
      stopReason,
      error,
      startedAt,
      completedAt: nowISO(),
      model: config.model,
      role: config.role,
      toolProfile: tools,
    });

    // Hard timeout — external timer that aborts regardless of stream state
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, config.timeoutMs);

    try {
      // Dynamic import to avoid hard dependency
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      let lastText = '';

      for await (const message of query({
        prompt: `Execute the build packet. Work in ${config.worktreePath.replace(/\\/g, '/')} and follow all rules.`,
        options: {
          cwd: config.worktreePath,
          allowedTools: tools,
          model: config.model,
          systemPrompt,
          permissionMode: 'bypassPermissions',
          maxTurns: config.maxTurns,
          maxBudgetUsd: config.maxBudgetUsd,
        },
      })) {
        // Check abort
        if (abortController.signal.aborted) {
          writeFileSync(join(config.outputDir, 'ERROR'), 'Session aborted (stopped or timed out)', 'utf-8');
          return makeResult('stopped', 'Session aborted');
        }

        if ('result' in message && typeof message.result === 'string') {
          lastText = message.result;
        }
      }

      clearTimeout(timeoutId);

      // Write session output
      writeFileSync(join(config.outputDir, 'output.log'), lastText, 'utf-8');

      // Classify output
      const { stopReason, error } = classifyOutput(config.outputDir);
      return makeResult(stopReason, error);

    } catch (err) {
      clearTimeout(timeoutId);

      if (abortController.signal.aborted) {
        return makeResult('timed_out', 'Session timed out');
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      writeFileSync(join(config.outputDir, 'ERROR'), errorMsg, 'utf-8');
      return makeResult('failed', errorMsg);
    }
  })();

  return {
    packetId: config.packetId,
    abort: () => abortController.abort(),
    promise,
  };
}
