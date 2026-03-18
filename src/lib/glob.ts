/**
 * Simple glob matching for file scope validation.
 * Supports: * (any segment), ** (any depth), ? (single char)
 * Does NOT use external dependencies — keeps CLI lean.
 */
export function minimatch(file: string, pattern: string): boolean {
  // Normalize separators
  const f = file.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');

  // Exact match
  if (f === p) return true;

  // Pattern ends with /* — matches any file in that directory
  if (p.endsWith('/*')) {
    const dir = p.slice(0, -2);
    return f.startsWith(dir + '/') && !f.slice(dir.length + 1).includes('/');
  }

  // Pattern ends with /** — matches any file at any depth
  if (p.endsWith('/**')) {
    const dir = p.slice(0, -3);
    return f.startsWith(dir + '/');
  }

  // Pattern contains ** in the middle
  if (p.includes('**')) {
    const parts = p.split('**');
    if (parts.length === 2) {
      const prefix = parts[0]!;
      const suffix = parts[1]!;
      return f.startsWith(prefix) && f.endsWith(suffix);
    }
  }

  // Simple wildcard: * matches anything except /
  const regex = new RegExp(
    '^' +
    p
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]') +
    '$'
  );
  return regex.test(f);
}
