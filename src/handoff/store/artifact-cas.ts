/**
 * Handoff Spine — Content-Addressable Store for artifact bodies.
 *
 * Layout: <casRoot>/sha256/<ab>/<cd>/<abcdef...ext>
 *
 * Rules:
 * - Body path derived from hash
 * - DB stores storage_ref pointing here
 * - Bodies are immutable once written
 * - Packet hash covers artifact refs, not raw artifact bytes
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class ArtifactCAS {
  constructor(private readonly casRoot: string) {
    mkdirSync(join(casRoot, 'sha256'), { recursive: true });
  }

  /**
   * Compute SHA-256 hash of content.
   */
  hash(content: Buffer | string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Derive the storage path for a given hash + extension.
   */
  storagePath(contentHash: string, ext: string = ''): string {
    const prefix1 = contentHash.slice(0, 2);
    const prefix2 = contentHash.slice(2, 4);
    const filename = ext ? `${contentHash}${ext}` : contentHash;
    return join(this.casRoot, 'sha256', prefix1, prefix2, filename);
  }

  /**
   * Store content, returning its hash and storage ref.
   * Idempotent — if the file already exists, it is not rewritten.
   */
  store(content: Buffer | string, ext: string = ''): { contentHash: string; storageRef: string } {
    const contentHash = this.hash(content);
    const path = this.storagePath(contentHash, ext);

    if (!existsSync(path)) {
      const dir = join(path, '..');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
    }

    return { contentHash, storageRef: path };
  }

  /**
   * Retrieve content by hash. Returns null if not found.
   */
  retrieve(contentHash: string, ext: string = ''): Buffer | null {
    const path = this.storagePath(contentHash, ext);
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }

  /**
   * Check if content exists by hash.
   */
  exists(contentHash: string, ext: string = ''): boolean {
    return existsSync(this.storagePath(contentHash, ext));
  }
}
