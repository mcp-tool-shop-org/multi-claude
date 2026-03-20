import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync } from 'node:fs';
import { openTestStore, makeTestPacket } from './helpers.js';
import { HandoffStore } from '../../src/handoff/store/handoff-store.js';
import { WorkerRenderer } from '../../src/handoff/render/role/worker-renderer.js';
import { ClaudeAdapter } from '../../src/handoff/render/adapters/claude-adapter.js';
import { composeWorkingContext } from '../../src/handoff/render/compose-working-context.js';
import { createHandoff } from '../../src/handoff/api/create-handoff.js';
import { renderHandoff } from '../../src/handoff/api/render-handoff.js';
import type Database from 'better-sqlite3';

describe('Compose Working Context', () => {
  let store: HandoffStore;
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    ({ store, db, dbPath } = openTestStore());
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
    for (const ext of ['-wal', '-shm']) {
      const p = dbPath + ext;
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('produces working context with correct metadata', () => {
    const packet = makeTestPacket();
    const renderer = new WorkerRenderer();
    const adapter = new ClaudeAdapter();

    const result = composeWorkingContext({ packet, renderer, adapter });

    expect(result.context.metadata.handoffId).toBe(packet.handoffId);
    expect(result.context.metadata.packetVersion).toBe(packet.packetVersion);
    expect(result.context.metadata.rendererVersion).toBe(renderer.version);
    expect(result.context.metadata.adapterVersion).toBe(adapter.version);
    expect(result.outputHash).toBeTruthy();
  });

  it('records render event to store when provided', () => {
    const packet = makeTestPacket();

    // Seed the packet in the store so FK constraints are satisfied
    store.createPacket({
      handoffId: packet.handoffId,
      projectId: packet.scope.projectId,
      runId: packet.derivedFromRunId,
      currentVersion: 1,
      status: 'active',
      createdAt: packet.createdAt,
      updatedAt: packet.createdAt,
    });

    const renderer = new WorkerRenderer();
    const adapter = new ClaudeAdapter();

    const result = composeWorkingContext({ packet, renderer, adapter }, store);

    expect(result.renderEventId).toBeDefined();
    expect(result.renderEventId).toBeGreaterThan(0);

    const events = store.getRenderEvents(packet.handoffId);
    expect(events).toHaveLength(1);
    expect(events[0].roleRenderer).toBe('worker');
    expect(events[0].modelAdapter).toBe('claude');
    expect(events[0].outputHash).toBe(result.outputHash);
  });

  it('CLI render output is traceable to packet version + output hash', () => {
    const createResult = createHandoff(store, {
      projectId: 'proj-1',
      runId: 'run-1',
      summary: 'Traceable test',
      instructions: { authoritative: ['Do X'], constraints: [], prohibitions: [] },
      decisionSource: { approvals: [], contractDeltas: [] },
      rejectionSource: { rejectedApprovals: [], rejectedDeltas: [] },
      openLoopSource: { failedPacketIds: [], blockedPacketIds: [], pendingPacketIds: [], unresolvedGates: [] },
      artifactSource: { artifacts: [] },
    });

    const id = createResult.packet.handoffId;

    const renderResult = renderHandoff(store, {
      handoffId: id,
      role: 'worker',
      model: 'claude',
    });

    expect(renderResult.ok).toBe(true);
    if (renderResult.ok) {
      // Output hash exists
      expect(renderResult.outputHash).toBeTruthy();

      // Render event was recorded
      expect(renderResult.renderEventId).toBeDefined();

      // Can trace back: render event → packet version
      const events = store.getRenderEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0].packetVersion).toBe(1);
      expect(events[0].outputHash).toBe(renderResult.outputHash);

      // Context metadata tracks the chain
      expect(renderResult.context.metadata.handoffId).toBe(id);
      expect(renderResult.context.metadata.packetVersion).toBe(1);
    }
  });
});
