/**
 * 9A-202: Freeze Builder
 *
 * Generate and validate RunBlueprint artifacts from templates,
 * then freeze them into immutable contract documents.
 */

import type {
  RunPlan,
  RunBlueprint,
  PacketDefinition,
  WaveDefinition,
  CouplingGuard,
  ChecklistItem,
  HumanGate,
  ReadinessResult,
} from './schema.js';
import { validateRunBlueprint, computeFreezeHash } from './schema.js';
import { getTemplate } from './templates.js';
import type { PacketTemplate } from './templates.js';
import { generateId, nowISO } from '../lib/ids.js';

// ---------------------------------------------------------------------------
// initBlueprint
// ---------------------------------------------------------------------------

export function initBlueprint(
  plan: RunPlan,
  repoRoot: string,
  packetOverrides?: Partial<PacketDefinition>[],
): RunBlueprint {
  const templateId = plan.assessment.suggestedTemplate;
  if (!templateId) {
    throw new Error('RunPlan has no suggestedTemplate');
  }

  const template: PacketTemplate | undefined = getTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  // Build waves and collect wave-1 packet IDs for dependency wiring
  const wave1PacketIds: string[] = [];
  const waves: WaveDefinition[] = [];

  for (const tw of template.waveStructure) {
    const packets: PacketDefinition[] = tw.packets.map((stub) => {
      const pkt: PacketDefinition = {
        packetId: generateId('pkt'),
        label: stub.label,
        role: stub.role,
        packetClass: stub.packetClass,
        allowedFiles: [],
        forbiddenFiles: [],
        budgetMinutes: [...stub.budgetMinutes],
        ceilingMinutes: stub.ceilingMinutes,
        dependsOn: tw.wave === 1 ? [] : [...wave1PacketIds],
      };
      return pkt;
    });

    waves.push({ wave: tw.wave, packets });

    // After processing wave 1, capture its packet IDs
    if (tw.wave === 1) {
      for (const pkt of packets) {
        wave1PacketIds.push(pkt.packetId);
      }
    }
  }

  // Apply packet overrides if provided
  if (packetOverrides) {
    const allPackets = waves.flatMap((w) => w.packets);
    for (let i = 0; i < packetOverrides.length; i++) {
      const override = packetOverrides[i];
      if (!override) continue;

      // Match by packetId if provided, otherwise by index
      let target: PacketDefinition | undefined;
      if (override.packetId) {
        target = allPackets.find((p) => p.packetId === override.packetId);
      } else if (i < allPackets.length) {
        target = allPackets[i];
      }

      if (target) {
        if (override.allowedFiles) target.allowedFiles = override.allowedFiles;
        if (override.forbiddenFiles) target.forbiddenFiles = override.forbiddenFiles;
        if (override.budgetMinutes) target.budgetMinutes = override.budgetMinutes;
        if (override.ceilingMinutes !== undefined) target.ceilingMinutes = override.ceilingMinutes;
        if (override.label) target.label = override.label;
        if (override.role) target.role = override.role;
        if (override.packetClass) target.packetClass = override.packetClass;
        if (override.dependsOn) target.dependsOn = override.dependsOn;
      }
    }
  }

  // Coupling guards from template
  const couplingGuards: CouplingGuard[] = template.couplingGuards.map((rule) => ({
    rule,
    enforcedBy: 'both' as const,
  }));

  // Verifier checklist from template readiness checks
  const verifierChecklist: ChecklistItem[] = template.readinessChecks.map((check, idx) => ({
    id: `chk-${String(idx + 1).padStart(3, '0')}`,
    description: check,
    required: true,
  }));

  // Human gates from template required gates (after wave 1)
  const humanGates: HumanGate[] = template.requiredGates.map((gate) => ({
    afterWave: 1,
    gateType: 'approval',
    description: gate,
  }));

  const readinessResult: ReadinessResult = {
    ready: false,
    failures: ['Allowed files not assigned'],
    warnings: [],
  };

  return {
    id: generateId('bp'),
    planId: plan.id,
    createdAt: nowISO(),
    version: 1,
    templateId,
    workClass: template.workClass,
    repoRoot,
    waves,
    couplingGuards,
    verifierChecklist,
    humanGates,
    readinessResult,
    frozen: false,
  };
}

// ---------------------------------------------------------------------------
// validateBlueprint
// ---------------------------------------------------------------------------

export function validateBlueprint(blueprint: RunBlueprint): ReadinessResult {
  const schemaResult = validateRunBlueprint(blueprint);
  const failures: string[] = [...schemaResult.errors];
  const warnings: string[] = [];

  // Additional checks beyond schema validation
  for (const wave of blueprint.waves) {
    for (const pkt of wave.packets) {
      if (!pkt.allowedFiles || pkt.allowedFiles.length === 0) {
        warnings.push(`Packet ${pkt.packetId} (${pkt.label}) has no allowedFiles assigned`);
      }
      if (
        !pkt.budgetMinutes ||
        !Array.isArray(pkt.budgetMinutes) ||
        pkt.budgetMinutes.length !== 2
      ) {
        failures.push(`Packet ${pkt.packetId} has no budgetMinutes assigned`);
      }
    }
  }

  return {
    ready: failures.length === 0 && warnings.length === 0,
    failures,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// freezeBlueprint
// ---------------------------------------------------------------------------

export function freezeBlueprint(blueprint: RunBlueprint): RunBlueprint {
  const result = validateBlueprint(blueprint);
  if (!result.ready) {
    const allIssues = [...result.failures, ...result.warnings];
    throw new Error(`Blueprint not ready to freeze: ${allIssues.join('; ')}`);
  }

  const frozen: RunBlueprint = {
    ...blueprint,
    frozen: true,
    frozenAt: nowISO(),
  };
  frozen.frozenHash = computeFreezeHash(frozen);

  return frozen;
}

// ---------------------------------------------------------------------------
// renderContractFreeze
// ---------------------------------------------------------------------------

export function renderContractFreeze(blueprint: RunBlueprint): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Contract Freeze: ${blueprint.id}`);
  lines.push('');

  // Trial identity table
  lines.push('## Trial Identity');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Blueprint ID | ${blueprint.id} |`);
  lines.push(`| Plan ID | ${blueprint.planId} |`);
  lines.push(`| Template | ${blueprint.templateId} |`);
  lines.push(`| Work Class | ${blueprint.workClass} |`);
  lines.push(`| Repo Root | ${blueprint.repoRoot} |`);
  lines.push(`| Version | ${String(blueprint.version)} |`);
  lines.push(`| Frozen | ${String(blueprint.frozen)} |`);
  if (blueprint.frozenAt) {
    lines.push(`| Frozen At | ${blueprint.frozenAt} |`);
  }
  if (blueprint.frozenHash) {
    lines.push(`| Frozen Hash | \`${blueprint.frozenHash}\` |`);
  }
  lines.push('');

  // Wave structure
  lines.push('## Wave Structure');
  lines.push('');

  for (const wave of blueprint.waves) {
    lines.push(`### Wave ${String(wave.wave)}`);
    lines.push('');

    for (const pkt of wave.packets) {
      lines.push(`#### ${pkt.label} (\`${pkt.packetId}\`)`);
      lines.push('');
      lines.push(`- **Role:** ${pkt.role}`);
      lines.push(`- **Class:** ${pkt.packetClass}`);
      lines.push(`- **Budget:** ${String(pkt.budgetMinutes[0])}-${String(pkt.budgetMinutes[1])} min (ceiling: ${String(pkt.ceilingMinutes)} min)`);

      if (pkt.allowedFiles.length > 0) {
        lines.push(`- **Allowed files:** ${pkt.allowedFiles.map((f) => `\`${f}\``).join(', ')}`);
      } else {
        lines.push('- **Allowed files:** (none assigned)');
      }

      if (pkt.forbiddenFiles.length > 0) {
        lines.push(`- **Forbidden files:** ${pkt.forbiddenFiles.map((f) => `\`${f}\``).join(', ')}`);
      }

      if (pkt.dependsOn.length > 0) {
        lines.push(`- **Depends on:** ${pkt.dependsOn.map((d) => `\`${d}\``).join(', ')}`);
      }

      lines.push('');
    }
  }

  // Coupling guards
  lines.push('## Coupling Guards');
  lines.push('');
  for (const guard of blueprint.couplingGuards) {
    lines.push(`- ${guard.rule} _(enforced by: ${guard.enforcedBy})_`);
  }
  lines.push('');

  // Verifier checklist
  lines.push('## Verifier Checklist');
  lines.push('');
  for (const item of blueprint.verifierChecklist) {
    const marker = item.required ? '[ ]' : '[-]';
    lines.push(`- ${marker} **${item.id}**: ${item.description}`);
  }
  lines.push('');

  // Human gates
  lines.push('## Human Gates');
  lines.push('');
  for (const gate of blueprint.humanGates) {
    lines.push(`- After wave ${String(gate.afterWave)} (${gate.gateType}): ${gate.description}`);
  }
  lines.push('');

  return lines.join('\n');
}
