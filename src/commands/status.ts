import { Command } from 'commander';
import { openDb } from '../db/connection.js';

interface FeatureStatusResult {
  feature_id: string;
  title: string;
  status: string;
  priority: string;
  merge_target: string;
  packets: {
    total: number;
    by_status: Record<string, number>;
    blocked: Array<{ packet_id: string; status: string }>;
    active_claims: Array<{ packet_id: string; claimed_by: string; expires_at: string }>;
  };
  progress_percent: number;
}

interface WorklistResult {
  claimable: Array<{
    packet_id: string;
    feature_id: string;
    layer: string;
    role: string;
    goal: string;
  }>;
}

interface LeasesResult {
  active_claims: Array<{
    claim_id: string;
    packet_id: string;
    claimed_by: string;
    lease_expires_at: string;
    renewals_used: number;
  }>;
}

function statusFeature(dbPath: string, featureId: string): void {
  const db = openDb(dbPath);
  try {
    const feature = db.prepare('SELECT * FROM features WHERE feature_id = ?').get(featureId) as Record<string, unknown> | undefined;
    if (!feature) {
      console.log(JSON.stringify({ ok: false, error: 'Feature not found' }));
      process.exit(1);
    }

    const packets = db.prepare('SELECT packet_id, status FROM packets WHERE feature_id = ?').all(featureId) as Array<{ packet_id: string; status: string }>;

    const byStatus: Record<string, number> = {};
    for (const p of packets) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    }

    const blocked = packets.filter(p => p.status === 'blocked');

    const activeClaims = db.prepare(`
      SELECT c.packet_id, c.claimed_by, c.lease_expires_at as expires_at
      FROM claims c
      JOIN packets p ON p.packet_id = c.packet_id
      WHERE p.feature_id = ? AND c.is_active = 1
    `).all(featureId) as Array<{ packet_id: string; claimed_by: string; expires_at: string }>;

    const nonAbandoned = packets.filter(p => !['abandoned', 'superseded'].includes(p.status));
    const merged = nonAbandoned.filter(p => p.status === 'merged');
    const progressPercent = nonAbandoned.length > 0
      ? Math.round((merged.length / nonAbandoned.length) * 100)
      : 0;

    const result: FeatureStatusResult = {
      feature_id: feature.feature_id as string,
      title: feature.title as string,
      status: feature.status as string,
      priority: feature.priority as string,
      merge_target: feature.merge_target as string,
      packets: {
        total: packets.length,
        by_status: byStatus,
        blocked,
        active_claims: activeClaims,
      },
      progress_percent: progressPercent,
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

function statusPacket(dbPath: string, packetId: string): void {
  const db = openDb(dbPath);
  try {
    const packet = db.prepare('SELECT * FROM packets WHERE packet_id = ?').get(packetId) as Record<string, unknown> | undefined;
    if (!packet) {
      console.log(JSON.stringify({ ok: false, error: 'Packet not found' }));
      process.exit(1);
    }

    const activeClaim = db.prepare(`
      SELECT * FROM claims WHERE packet_id = ? AND is_active = 1
    `).get(packetId);

    const attempts = db.prepare(`
      SELECT attempt_number, end_reason as outcome, started_by, started_at FROM packet_attempts WHERE packet_id = ? ORDER BY attempt_number
    `).all(packetId);

    const hardDeps = db.prepare(`
      SELECT pd.depends_on_packet_id as packet_id, p.status
      FROM packet_dependencies pd
      JOIN packets p ON p.packet_id = pd.depends_on_packet_id
      WHERE pd.packet_id = ? AND pd.dependency_type = 'hard'
    `).all(packetId);

    const softDeps = db.prepare(`
      SELECT pd.depends_on_packet_id as packet_id, p.status
      FROM packet_dependencies pd
      JOIN packets p ON p.packet_id = pd.depends_on_packet_id
      WHERE pd.packet_id = ? AND pd.dependency_type = 'soft'
    `).all(packetId);

    console.log(JSON.stringify({
      ...packet,
      active_claim: activeClaim ?? null,
      attempts,
      dependencies: { hard: hardDeps, soft: softDeps },
    }, null, 2));
  } finally {
    db.close();
  }
}

function statusWorklist(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    // Claimable = ready + all hard deps merged + no active claim
    const readyPackets = db.prepare(`
      SELECT p.packet_id, p.feature_id, p.layer, p.role, p.goal
      FROM packets p
      WHERE p.status = 'ready'
        AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.packet_id = p.packet_id AND c.is_active = 1)
        AND NOT EXISTS (
          SELECT 1 FROM packet_dependencies pd
          JOIN packets dep ON dep.packet_id = pd.depends_on_packet_id
          WHERE pd.packet_id = p.packet_id
            AND pd.dependency_type = 'hard'
            AND dep.status != 'merged'
        )
    `).all() as WorklistResult['claimable'];

    const result: WorklistResult = { claimable: readyPackets };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

function statusLeases(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    const claims = db.prepare(`
      SELECT claim_id, packet_id, claimed_by, lease_expires_at, renewal_count as renewals_used
      FROM claims WHERE is_active = 1
      ORDER BY lease_expires_at ASC
    `).all() as LeasesResult['active_claims'];

    const result: LeasesResult = { active_claims: claims };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

export function statusCommand(): Command {
  const cmd = new Command('status').description('Query system state');

  cmd.command('feature <feature_id>')
    .description('Show feature status')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((featureId: string, opts: { dbPath: string }) => {
      statusFeature(opts.dbPath, featureId);
    });

  cmd.command('packet <packet_id>')
    .description('Show packet status')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((packetId: string, opts: { dbPath: string }) => {
      statusPacket(opts.dbPath, packetId);
    });

  cmd.command('worklist')
    .description('Show claimable packets')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts: { dbPath: string }) => {
      statusWorklist(opts.dbPath);
    });

  cmd.command('leases')
    .description('Show active claim leases')
    .option('--db-path <path>', 'DB path', '.mcf/execution.db')
    .action((opts: { dbPath: string }) => {
      statusLeases(opts.dbPath);
    });

  return cmd;
}
