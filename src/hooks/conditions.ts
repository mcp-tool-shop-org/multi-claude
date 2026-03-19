import { openDb } from '../db/connection.js';

/** Evaluated conditions for policy decisions */
export interface EvaluatedConditions {
  claimableCount: number;
  claimablePackets: string[];
  fileOverlap: boolean;
  hasProtectedFiles: boolean;
  hasSeamFiles: boolean;
  criticalPathDepth: number;
  graphDepth: number;
  phaseType: 'scaffold' | 'subsystem' | 'hardening' | 'unknown';
  verifiedCount: number;
  totalPackets: number;
  activeWorkers: number;
  allPacketsVerified: boolean;
  allPromotionsComplete: boolean;
  hasMergeApproval: boolean;
  failureClass?: 'deterministic' | 'flaky' | 'scope_violation' | 'schema_mismatch';
  retryCount: number;
  docsEligible: boolean;
}

/** Evaluate all conditions for a feature */
export function evaluateConditions(dbPath: string, featureId: string, failedPacketId?: string): EvaluatedConditions {
  const db = openDb(dbPath);
  try {
    // Get all packets for feature
    const packets = db.prepare(`
      SELECT packet_id, status, layer, role, allowed_files, forbidden_files,
             protected_file_access, seam_file_access, knowledge_writeback_required
      FROM packets WHERE feature_id = ?
    `).all(featureId) as Array<{
      packet_id: string; status: string; layer: string; role: string;
      allowed_files: string; forbidden_files: string;
      protected_file_access: string; seam_file_access: string;
      knowledge_writeback_required: number;
    }>;

    const totalPackets = packets.length;

    // Get hard dependencies
    const deps = db.prepare(`
      SELECT pd.packet_id, pd.depends_on_packet_id
      FROM packet_dependencies pd
      JOIN packets p ON p.packet_id = pd.packet_id
      WHERE p.feature_id = ? AND pd.dependency_type = 'hard'
    `).all(featureId) as Array<{ packet_id: string; depends_on_packet_id: string }>;

    const mergedPackets = new Set(packets.filter(p => p.status === 'merged').map(p => p.packet_id));
    const verifiedPackets = packets.filter(p => p.status === 'verified');

    // Claimable: ready + all hard deps merged
    const depMap = new Map<string, string[]>();
    for (const p of packets) depMap.set(p.packet_id, []);
    for (const d of deps) {
      const list = depMap.get(d.packet_id);
      if (list) list.push(d.depends_on_packet_id);
    }

    const claimablePackets = packets
      .filter(p => p.status === 'ready')
      .filter(p => {
        const pDeps = depMap.get(p.packet_id) ?? [];
        return pDeps.every(d => mergedPackets.has(d));
      })
      .map(p => p.packet_id);

    // File overlap check among claimable
    let fileOverlap = false;
    const allAllowed = claimablePackets.map(pid => {
      const pkt = packets.find(p => p.packet_id === pid)!;
      try { return JSON.parse(pkt.allowed_files) as string[]; } catch { return []; }
    });
    for (let i = 0; i < allAllowed.length; i++) {
      for (let j = i + 1; j < allAllowed.length; j++) {
        const overlap = allAllowed[i]!.some(f => allAllowed[j]!.includes(f));
        if (overlap) { fileOverlap = true; break; }
      }
      if (fileOverlap) break;
    }

    // Protected/seam file involvement in claimable
    const hasProtectedFiles = claimablePackets.some(pid => {
      const pkt = packets.find(p => p.packet_id === pid)!;
      return pkt.protected_file_access !== 'none';
    });
    const hasSeamFiles = claimablePackets.some(pid => {
      const pkt = packets.find(p => p.packet_id === pid)!;
      return pkt.seam_file_access !== 'none';
    });

    // Critical path depth (longest chain of unfinished packets)
    const unfinished = new Set(packets.filter(p => !['merged', 'abandoned', 'superseded'].includes(p.status)).map(p => p.packet_id));
    function longestChain(pid: string, visited: Set<string>): number {
      if (visited.has(pid)) return 0;
      visited.add(pid);
      const dependents = deps.filter(d => d.depends_on_packet_id === pid && unfinished.has(d.packet_id));
      if (dependents.length === 0) return 1;
      return 1 + Math.max(...dependents.map(d => longestChain(d.packet_id, new Set(visited))));
    }
    const roots = [...unfinished].filter(pid => {
      const pDeps = depMap.get(pid) ?? [];
      return pDeps.every(d => !unfinished.has(d));
    });
    const criticalPathDepth = roots.length > 0 ? Math.max(...roots.map(r => longestChain(r, new Set()))) : 0;

    // Graph depth (waves remaining)
    let graphDepth = 0;
    const assigned = new Set(mergedPackets);
    let remaining = packets.filter(p => !assigned.has(p.packet_id) && !['abandoned', 'superseded'].includes(p.status));
    while (remaining.length > 0) {
      const ready = remaining.filter(p => {
        const pDeps = depMap.get(p.packet_id) ?? [];
        return pDeps.every(d => assigned.has(d));
      });
      if (ready.length === 0) break;
      graphDepth++;
      for (const p of ready) assigned.add(p.packet_id);
      remaining = remaining.filter(p => !assigned.has(p.packet_id));
    }

    // Phase type heuristic
    const layers = packets.map(p => p.layer);
    const hasScaffold = layers.includes('contract') && packets.some(p => p.layer === 'contract' && p.role === 'architect');
    const hasMultipleLayers = new Set(layers).size >= 3;
    const phaseType: EvaluatedConditions['phaseType'] = hasScaffold && !hasMultipleLayers
      ? 'scaffold'
      : hasMultipleLayers ? 'subsystem' : 'unknown';

    // Active workers (claimed or in_progress)
    const activeWorkers = packets.filter(p => ['claimed', 'in_progress'].includes(p.status)).length;

    // All verified check (merge-relevant = not abandoned/superseded)
    const mergeRelevant = packets.filter(p => !['abandoned', 'superseded'].includes(p.status));
    const allPacketsVerified = mergeRelevant.every(p => ['verified', 'merged'].includes(p.status));

    // Knowledge promotions complete
    const needPromotion = packets.filter(p => p.knowledge_writeback_required && ['verified', 'merged'].includes(p.status));
    const promotions = db.prepare(`
      SELECT packet_id FROM knowledge_promotions WHERE status = 'promoted'
    `).all() as Array<{ packet_id: string }>;
    const promotedSet = new Set(promotions.map(p => p.packet_id));
    const allPromotionsComplete = needPromotion.every(p => promotedSet.has(p.packet_id));

    // Merge approval
    const mergeApproval = db.prepare(`
      SELECT approval_id FROM approvals
      WHERE scope_type = 'feature' AND scope_id = ? AND approval_type = 'merge_approval' AND decision = 'approved'
      ORDER BY created_at DESC LIMIT 1
    `).get(featureId) as { approval_id: string } | undefined;

    // Failure analysis for specific packet
    let failureClass: EvaluatedConditions['failureClass'];
    let retryCount = 0;
    if (failedPacketId) {
      const attempts = db.prepare(`
        SELECT attempt_number, end_reason FROM packet_attempts WHERE packet_id = ? ORDER BY attempt_number DESC
      `).all(failedPacketId) as Array<{ attempt_number: number; end_reason: string | null }>;
      retryCount = attempts.length;

      // Check last verification result
      const lastVerification = db.prepare(`
        SELECT checks_json, failures_json FROM verification_results WHERE packet_id = ? ORDER BY completed_at DESC LIMIT 1
      `).get(failedPacketId) as { checks_json: string; failures_json: string | null } | undefined;

      if (lastVerification?.failures_json) {
        const failures = lastVerification.failures_json.toLowerCase();
        if (failures.includes('forbidden') || failures.includes('protected') || failures.includes('scope')) {
          failureClass = 'scope_violation';
        } else if (failures.includes('schema') || failures.includes('writeback') || failures.includes('artifacts')) {
          failureClass = 'schema_mismatch';
        } else {
          failureClass = 'deterministic';
        }
      }
    }

    // Docs eligible: 3+ verified and a docs packet exists in ready
    const docsPacket = packets.find(p => p.layer === 'docs' && p.status === 'ready');
    const docsEligible = verifiedPackets.length >= 3 && docsPacket !== undefined;

    return {
      claimableCount: claimablePackets.length,
      claimablePackets,
      fileOverlap,
      hasProtectedFiles,
      hasSeamFiles,
      criticalPathDepth,
      graphDepth,
      phaseType,
      verifiedCount: verifiedPackets.length,
      totalPackets,
      activeWorkers,
      allPacketsVerified,
      allPromotionsComplete,
      hasMergeApproval: !!mergeApproval,
      failureClass,
      retryCount,
      docsEligible,
    };
  } finally {
    db.close();
  }
}
