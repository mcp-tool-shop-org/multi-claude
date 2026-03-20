/**
 * Handoff Spine — Truncation policies.
 *
 * When a token budget is set, renderers use these policies
 * to decide what to keep and what to trim.
 */

export interface TruncationResult {
  text: string;
  truncated: boolean;
  originalLength: number;
}

/**
 * Rough token estimate: ~4 chars per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget.
 * Preserves complete lines where possible.
 */
export function truncateToTokenBudget(text: string, tokenBudget: number): TruncationResult {
  const originalLength = estimateTokens(text);
  if (originalLength <= tokenBudget) {
    return { text, truncated: false, originalLength };
  }

  const charBudget = tokenBudget * 4;
  const lines = text.split('\n');
  const kept: string[] = [];
  let chars = 0;

  for (const line of lines) {
    if (chars + line.length + 1 > charBudget) break;
    kept.push(line);
    chars += line.length + 1;
  }

  const result = kept.join('\n') + '\n[... truncated]';
  return { text: result, truncated: true, originalLength };
}

/**
 * Allocate token budget across blocks by priority weights.
 * Returns a Map for type-safe access.
 */
export function allocateBudget<K extends string>(
  totalBudget: number,
  weights: Record<K, number>,
): Map<K, number> {
  const entries = Object.entries(weights) as Array<[K, number]>;
  const totalWeight = entries.reduce((a, [, w]) => a + w, 0);
  const result = new Map<K, number>();

  for (const [key, weight] of entries) {
    result.set(key, Math.floor(totalBudget * (weight / totalWeight)));
  }

  return result;
}
