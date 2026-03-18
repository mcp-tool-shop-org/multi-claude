import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { runInit } from '../src/commands/init.js';
import { runFeatureCreate, runFeatureApprove } from '../src/commands/feature.js';
import { runPacketCreate, runPacketReady, type PacketDef } from '../src/commands/packet.js';
import { openDb } from '../src/db/connection.js';

function tempDir(): string {
  const dir = join(tmpdir(), 'mcf-test-' + randomBytes(4).toString('hex'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Feature + Packet lifecycle', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = tempDir();
    dbPath = join(dir, '.mcf', 'execution.db');
    const initResult = runInit('mcp-tool-shop-org/GlyphStudio', dbPath);
    expect(initResult.ok).toBe(true);
  });

  afterEach(() => {
    // Cleanup
    for (const ext of ['', '-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('creates and approves a feature', () => {
    const created = runFeatureCreate(dbPath, 'test-feature', 'Test Feature', 'Test objective', ['Criterion 1'], 'org/repo');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.result.status).toBe('proposed');

    const approved = runFeatureApprove(dbPath, 'test-feature', 'mike');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.result.status).toBe('approved');
  });

  it('rejects duplicate feature', () => {
    runFeatureCreate(dbPath, 'dup', 'Dup', 'obj', ['c1'], 'org/repo');
    const dup = runFeatureCreate(dbPath, 'dup', 'Dup2', 'obj2', ['c2'], 'org/repo');
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error_code).toBe('DUPLICATE_FEATURE');
  });

  it('rejects non-kebab-case feature ID', () => {
    const result = runFeatureCreate(dbPath, 'Not_Kebab', 'T', 'O', ['c'], 'org/r');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_ID');
  });

  it('rejects feature with no criteria', () => {
    const result = runFeatureCreate(dbPath, 'no-criteria', 'T', 'O', [], 'org/r');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('NO_CRITERIA');
  });

  it('rejects approving an already approved feature', () => {
    runFeatureCreate(dbPath, 'f1', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f1', 'mike');
    const result = runFeatureApprove(dbPath, 'f1', 'mike');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_STATE');
  });

  it('creates packets from fixture file', () => {
    runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works', 'Store tracks state'], 'mcp-tool-shop-org/GlyphStudio');
    runFeatureApprove(dbPath, 'anchor-propagation', 'mike');

    const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
    const packets: PacketDef[] = JSON.parse(fixtureData);

    const result = runPacketCreate(dbPath, 'anchor-propagation', packets);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.packets_created).toHaveLength(7);
    expect(result.result.dependency_graph_valid).toBe(true);
  });

  it('readies packets and updates feature to in_progress', () => {
    runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation', 'Propagate anchor updates', ['Backend works'], 'mcp-tool-shop-org/GlyphStudio');
    runFeatureApprove(dbPath, 'anchor-propagation', 'mike');

    const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
    const packets: PacketDef[] = JSON.parse(fixtureData);
    runPacketCreate(dbPath, 'anchor-propagation', packets);

    // Ready the root packet (contract-types has no deps)
    const readyResult = runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike', true);
    expect(readyResult.ok).toBe(true);
    if (!readyResult.ok) return;
    expect(readyResult.result.packets_readied).toEqual(['anchor-propagation--contract-types']);
    expect(readyResult.result.feature_status).toBe('in_progress');
    expect(readyResult.result.approval_id).not.toBeNull();
  });

  it('rejects invalid packet ID format', () => {
    runFeatureCreate(dbPath, 'f1', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f1', 'mike');

    const result = runPacketCreate(dbPath, 'f1', [{
      packet_id: 'bad_format',
      title: 'T',
      layer: 'backend',
      descriptor: 'x',
      role: 'builder',
      playbook_id: 'bp',
      goal: 'g',
      allowed_files: ['src/x.ts'],
      verification_profile_id: 'vp',
    }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('INVALID_PACKET_ID');
  });

  it('rejects packets with nonexistent dependencies', () => {
    runFeatureCreate(dbPath, 'f1', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f1', 'mike');

    const result = runPacketCreate(dbPath, 'f1', [{
      packet_id: 'f1--backend-x',
      title: 'T',
      layer: 'backend',
      descriptor: 'x',
      role: 'builder',
      playbook_id: 'bp',
      goal: 'g',
      allowed_files: ['src/x.ts'],
      verification_profile_id: 'vp',
      depends_on: ['nonexistent--packet-id'],
    }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error_code).toBe('DEPENDENCY_NOT_FOUND');
  });

  it('records state transitions in the log', () => {
    runFeatureCreate(dbPath, 'f1', 'T', 'O', ['c'], 'org/r');
    runFeatureApprove(dbPath, 'f1', 'mike');

    const db = openDb(dbPath);
    try {
      const transitions = db.prepare(`
        SELECT entity_type, entity_id, from_state, to_state, actor_type
        FROM state_transition_log
        WHERE entity_id = 'f1'
        ORDER BY created_at
      `).all() as Array<{ entity_type: string; entity_id: string; from_state: string | null; to_state: string; actor_type: string }>;

      expect(transitions).toHaveLength(2);
      expect(transitions[0]!.from_state).toBeNull();
      expect(transitions[0]!.to_state).toBe('proposed');
      expect(transitions[1]!.from_state).toBe('proposed');
      expect(transitions[1]!.to_state).toBe('approved');
    } finally {
      db.close();
    }
  });

  it('full proof feature can be seeded and queried', () => {
    // Seed the complete anchor-propagation feature
    runFeatureCreate(dbPath, 'anchor-propagation', 'Anchor Propagation System', 'Propagate anchor point updates across animation frames', ['Backend propagation engine works', 'Store tracks propagation state', 'UI controls propagation in AnchorPanel'], 'mcp-tool-shop-org/GlyphStudio');
    runFeatureApprove(dbPath, 'anchor-propagation', 'mike');

    const fixtureData = readFileSync(join(__dirname, 'fixtures', 'anchor-propagation-packets.json'), 'utf-8');
    const packets: PacketDef[] = JSON.parse(fixtureData);
    runPacketCreate(dbPath, 'anchor-propagation', packets);

    // Ready root packet
    runPacketReady(dbPath, ['anchor-propagation--contract-types'], 'mike');

    // Verify the state is correct
    const db = openDb(dbPath);
    try {
      const feature = db.prepare('SELECT status FROM features WHERE feature_id = ?').get('anchor-propagation') as { status: string };
      expect(feature.status).toBe('in_progress');

      const allPackets = db.prepare('SELECT packet_id, status, layer, role FROM packets WHERE feature_id = ? ORDER BY packet_id').all('anchor-propagation') as Array<{ packet_id: string; status: string; layer: string; role: string }>;
      expect(allPackets).toHaveLength(7);

      const readyCount = allPackets.filter(p => p.status === 'ready').length;
      const draftCount = allPackets.filter(p => p.status === 'draft').length;
      expect(readyCount).toBe(1); // contract-types
      expect(draftCount).toBe(6); // everything else

      // Verify dependency graph
      const deps = db.prepare('SELECT packet_id, depends_on_packet_id, dependency_type FROM packet_dependencies ORDER BY packet_id').all() as Array<{ packet_id: string; depends_on_packet_id: string; dependency_type: string }>;
      expect(deps.length).toBeGreaterThan(0);

      // Verify backend depends on contract
      const backendDep = deps.find(d => d.packet_id === 'anchor-propagation--backend-engine' && d.depends_on_packet_id === 'anchor-propagation--contract-types');
      expect(backendDep).toBeDefined();
      expect(backendDep!.dependency_type).toBe('hard');

      // Verify integration depends on everything
      const integrationDeps = deps.filter(d => d.packet_id === 'anchor-propagation--integration-wiring');
      expect(integrationDeps).toHaveLength(5);
    } finally {
      db.close();
    }
  });
});
