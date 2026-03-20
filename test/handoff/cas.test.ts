import { describe, it, expect, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { ArtifactCAS } from '../../src/handoff/store/artifact-cas.js';
import { tempDir } from './helpers.js';

describe('Artifact CAS', () => {
  const dirs: string[] = [];

  function makeCAS(): ArtifactCAS {
    const dir = tempDir();
    dirs.push(dir);
    return new ArtifactCAS(dir);
  }

  afterEach(() => {
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true }); } catch { /* ignore */ }
    }
    dirs.length = 0;
  });

  it('stores and retrieves content by hash', () => {
    const cas = makeCAS();
    const content = 'Hello, handoff!';
    const { contentHash, storageRef } = cas.store(content, '.txt');

    expect(contentHash).toBeTruthy();
    expect(storageRef).toContain(contentHash);

    const retrieved = cas.retrieve(contentHash, '.txt');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toString()).toBe(content);
  });

  it('is idempotent — same content stored twice gives same hash', () => {
    const cas = makeCAS();
    const content = 'Duplicate test';
    const result1 = cas.store(content, '.txt');
    const result2 = cas.store(content, '.txt');

    expect(result1.contentHash).toBe(result2.contentHash);
    expect(result1.storageRef).toBe(result2.storageRef);
  });

  it('different content produces different hashes', () => {
    const cas = makeCAS();
    const r1 = cas.store('Content A');
    const r2 = cas.store('Content B');
    expect(r1.contentHash).not.toBe(r2.contentHash);
  });

  it('exists() returns correct state', () => {
    const cas = makeCAS();
    const { contentHash } = cas.store('Test content', '.log');
    expect(cas.exists(contentHash, '.log')).toBe(true);
    expect(cas.exists('nonexistent-hash', '.log')).toBe(false);
  });

  it('returns null for nonexistent content', () => {
    const cas = makeCAS();
    expect(cas.retrieve('nonexistent')).toBeNull();
  });

  it('artifact refs survive CAS reload', () => {
    const dir = tempDir();
    dirs.push(dir);

    const cas1 = new ArtifactCAS(dir);
    const { contentHash } = cas1.store('Persistent content', '.json');

    // "Reload" by creating a new CAS instance on the same directory
    const cas2 = new ArtifactCAS(dir);
    const retrieved = cas2.retrieve(contentHash, '.json');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toString()).toBe('Persistent content');
  });
});
