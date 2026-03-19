/** Worker session configuration */
export interface WorkerConfig {
  packetId: string;
  role: string;
  model: string;
  worktreePath: string;
  outputDir: string;
  packetMarkdown: string;
  allowedTools: string[];
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
}

/** Normalized session exit status */
export type StopReason = 'completed' | 'failed' | 'stopped' | 'timed_out' | 'malformed_output';

/** Result from a worker session */
export interface WorkerSessionResult {
  packetId: string;
  worktreePath: string;
  branchName: string;
  outputDir: string;
  stopReason: StopReason;
  error?: string;
  startedAt: string;
  completedAt: string;
  model: string;
  role: string;
  toolProfile: string[];
}

/** Handle to a running session — supports cancellation */
export interface WorkerSessionHandle {
  packetId: string;
  abort: () => void;
  promise: Promise<WorkerSessionResult>;
}

/** Durable runtime envelope persisted per session */
export interface RuntimeEnvelope {
  sessionId: string;
  runId: string;
  packetId: string;
  worker: string;
  role: string;
  model: string;
  toolProfile: string[];
  cwd: string;
  outputDir: string;
  promptHash: string;
  startedAt: string;
  completedAt: string | null;
  status: StopReason | 'running';
  stopReason: StopReason | null;
  error: string | null;
  validationVerdict: string | null;
  diffReconciliationVerdict: string | null;
}
