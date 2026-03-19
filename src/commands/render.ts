import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import { openDb } from '../db/connection.js';
import { mcfError, ERR } from '../lib/errors.js';
import type { McfResult } from '../types/common.js';

interface PacketRow {
  packet_id: string;
  feature_id: string;
  title: string;
  layer: string;
  role: string;
  playbook_id: string;
  status: string;
  goal: string;
  acceptance_criteria: string | null;
  context: string | null;
  allowed_files: string;
  forbidden_files: string;
  forbidden_rationale: string;
  reference_files: string;
  module_family: string | null;
  protected_file_access: string;
  seam_file_access: string;
  merge_with_layer: string | null;
  verification_profile_id: string;
  verification_overrides: string | null;
  rule_profile: string;
  contract_delta_policy: string;
  knowledge_writeback_required: number;
  merge_target: string | null;
}

interface DepRow {
  depends_on_packet_id: string;
  dependency_type: string;
  dep_status: string;
}

interface VerificationStep {
  command: string;
  working_dir?: string;
  timeout_seconds?: number;
  required: boolean;
  pass_condition: string;
  artifacts_expected?: string[];
}

interface AttemptRow {
  attempt_number: number;
  started_by: string;
  end_reason: string | null;
}

export function runRender(dbPath: string, packetId: string): McfResult<{ markdown: string }> {
  const db = openDb(dbPath);
  try {
    const packet = db.prepare('SELECT * FROM packets WHERE packet_id = ?').get(packetId) as PacketRow | undefined;
    if (!packet) {
      return mcfError('multi-claude render', ERR.PACKET_NOT_FOUND, `Packet '${packetId}' not found`, { packet_id: packetId });
    }

    // Get feature info
    const feature = db.prepare('SELECT feature_id, title, merge_target FROM features WHERE feature_id = ?').get(packet.feature_id) as { feature_id: string; title: string; merge_target: string };

    // Get dependencies with current status
    const deps = db.prepare(`
      SELECT pd.depends_on_packet_id, pd.dependency_type, p.status as dep_status
      FROM packet_dependencies pd
      JOIN packets p ON p.packet_id = pd.depends_on_packet_id
      WHERE pd.packet_id = ?
      ORDER BY pd.dependency_type, pd.depends_on_packet_id
    `).all(packetId) as DepRow[];

    // Get verification profile
    const profile = db.prepare(`
      SELECT steps FROM verification_profiles WHERE verification_profile_id = ?
    `).get(packet.verification_profile_id) as { steps: string } | undefined;

    let verificationSteps: VerificationStep[] = [];
    if (profile) {
      try { verificationSteps = JSON.parse(profile.steps) as VerificationStep[]; } catch { /* empty */ }
    }
    if (packet.verification_overrides) {
      try {
        const overrides = JSON.parse(packet.verification_overrides) as VerificationStep[];
        verificationSteps = [...verificationSteps, ...overrides];
      } catch { /* empty */ }
    }

    // Get attempt history
    const attempts = db.prepare(`
      SELECT attempt_number, started_by, end_reason FROM packet_attempts WHERE packet_id = ? ORDER BY attempt_number
    `).all(packetId) as AttemptRow[];

    // Parse JSON fields
    const allowedFiles = JSON.parse(packet.allowed_files) as string[];
    const forbiddenFiles = JSON.parse(packet.forbidden_files) as string[];
    const forbiddenRationale = JSON.parse(packet.forbidden_rationale ?? '{}') as Record<string, string>;
    const referenceFiles = JSON.parse(packet.reference_files ?? '[]') as string[];
    const criteria = packet.acceptance_criteria ? JSON.parse(packet.acceptance_criteria) as string[] : [];

    // Build markdown
    const lines: string[] = [];

    lines.push(`# PACKET: ${packet.packet_id}`);
    lines.push('');
    lines.push(`**Feature:** ${feature.title} (\`${feature.feature_id}\`)`);
    lines.push(`**Layer:** ${packet.layer}`);
    lines.push(`**Role:** ${packet.role}`);
    lines.push(`**Playbook:** ${packet.playbook_id}`);
    lines.push(`**Status:** ${packet.status}`);
    lines.push(`**Merge target:** ${packet.merge_target ?? feature.merge_target}`);
    if (packet.merge_with_layer) {
      lines.push(`**Merges with layer:** ${packet.merge_with_layer}`);
    }
    lines.push('');

    lines.push('## Goal');
    lines.push('');
    lines.push(packet.goal);
    lines.push('');

    if (criteria.length > 0) {
      lines.push('## Acceptance Criteria');
      lines.push('');
      for (const c of criteria) {
        lines.push(`- [ ] ${c}`);
      }
      lines.push('');
    }

    if (packet.context) {
      lines.push('## Context');
      lines.push('');
      lines.push(packet.context);
      lines.push('');
    }

    lines.push('## Scope');
    lines.push('');
    lines.push('### Allowed files');
    lines.push('');
    if (allowedFiles.length > 0) {
      for (const f of allowedFiles) {
        lines.push(`- \`${f}\``);
      }
    } else {
      lines.push('- _(none — integrator/knowledge role)_');
    }
    lines.push('');

    if (forbiddenFiles.length > 0) {
      lines.push('### Forbidden files');
      lines.push('');
      for (const f of forbiddenFiles) {
        const rationale = forbiddenRationale[f];
        lines.push(rationale ? `- \`${f}\` — ${rationale}` : `- \`${f}\``);
      }
      lines.push('');
    }

    if (referenceFiles.length > 0) {
      lines.push('### Reference files (prior art / pattern hints)');
      lines.push('');
      for (const f of referenceFiles) {
        lines.push(`- \`${f}\``);
      }
      lines.push('');
    }

    if (packet.module_family) {
      lines.push(`**Module family:** \`${packet.module_family}\``);
      lines.push('');
    }

    lines.push('### Access rules');
    lines.push('');
    lines.push(`- Protected files: **${packet.protected_file_access}**`);
    lines.push(`- Seam files: **${packet.seam_file_access}**`);
    lines.push('');

    if (deps.length > 0) {
      lines.push('## Dependencies');
      lines.push('');
      lines.push('| Packet | Type | Status |');
      lines.push('|--------|------|--------|');
      for (const d of deps) {
        const statusIcon = d.dep_status === 'merged' ? 'merged' : `**${d.dep_status}**`;
        lines.push(`| \`${d.depends_on_packet_id}\` | ${d.dependency_type} | ${statusIcon} |`);
      }
      lines.push('');
    }

    lines.push('## Verification');
    lines.push('');
    lines.push(`**Rule profile:** ${packet.rule_profile}`);
    lines.push('');
    if (verificationSteps.length > 0) {
      lines.push('| Command | Required | Pass condition |');
      lines.push('|---------|----------|----------------|');
      for (const s of verificationSteps) {
        lines.push(`| \`${s.command}\` | ${s.required ? 'Yes' : 'No'} | ${s.pass_condition} |`);
      }
    } else {
      lines.push('_No verification profile found — packet must define verification_overrides._');
    }
    lines.push('');

    lines.push('## Contract Delta Policy');
    lines.push('');
    lines.push(`**Policy:** ${packet.contract_delta_policy}`);
    lines.push('');
    if (packet.contract_delta_policy === 'none') {
      lines.push('No contract changes expected. If a contract change is discovered, emit a major amendment.');
    } else if (packet.contract_delta_policy === 'declare') {
      lines.push('Must declare any contract delta found. Fast-path landing requires all 4 eligibility criteria.');
    } else if (packet.contract_delta_policy === 'fast_path') {
      lines.push('May land bounded contract deltas inline if all fast-path criteria are met.');
    } else if (packet.contract_delta_policy === 'author') {
      lines.push('This IS a contract packet. Produce contract changes as the primary output.');
    }
    lines.push('');

    lines.push('## Knowledge Writeback');
    lines.push('');
    if (packet.knowledge_writeback_required) {
      lines.push('**Required.** Must produce structured writeback + prose fragment.');
      lines.push('');
      lines.push('Structured fields: module, change_type, summary, files_touched, contract_delta,');
      lines.push('risks, dependencies_affected, tests_added, docs_required, architecture_impact,');
      lines.push('relationship_suggestions.');
      lines.push('');
      lines.push('Prose fields: what_changed, why_changed, what_to_watch, what_affects_next.');
    } else {
      lines.push('Not required for this packet.');
    }
    lines.push('');

    lines.push('## Required Outputs');
    lines.push('');
    lines.push('- [ ] Code (implementation files within allowed scope)');
    lines.push('- [ ] Tests (covering the change)');
    lines.push('- [ ] Contract delta declaration ("none" or delta artifact)');
    if (packet.knowledge_writeback_required) {
      lines.push('- [ ] Knowledge writeback (structured + prose)');
    }
    lines.push('- [ ] Affected files list');
    lines.push('- [ ] Merge readiness declaration');
    lines.push('');

    if (attempts.length > 0) {
      lines.push('## Attempt History');
      lines.push('');
      lines.push('| # | Worker | Outcome |');
      lines.push('|---|--------|---------|');
      for (const a of attempts) {
        lines.push(`| ${a.attempt_number} | ${a.started_by} | ${a.end_reason ?? 'in progress'} |`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push(`_Rendered from multi-claude execution DB at ${new Date().toISOString()}_`);

    const markdown = lines.join('\n');

    return {
      ok: true,
      command: 'multi-claude render',
      result: { markdown },
      transitions: [],
    };
  } finally {
    db.close();
  }
}

export function renderCommand(): Command {
  const cmd = new Command('render')
    .description('Render a packet as markdown handoff')
    .requiredOption('--packet <id>', 'Packet ID')
    .option('--output <path>', 'Output file path (default: stdout)')
    .option('--db-path <path>', 'DB path', '.multi-claude/execution.db')
    .action((opts) => {
      const result = runRender(opts.dbPath, opts.packet);
      if (!result.ok) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(1);
      }
      if (opts.output) {
        writeFileSync(opts.output, result.result.markdown, 'utf-8');
        console.log(JSON.stringify({ ok: true, command: 'multi-claude render', result: { path: opts.output } }, null, 2));
      } else {
        console.log(result.result.markdown);
      }
    });

  return cmd;
}
