/**
 * 9A-102: Blueprint Schema + Validation
 *
 * Core type definitions and validation for RunPlan and RunBlueprint —
 * the two artifacts the planner produces.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Stub types (101 owns the real ones — integrator will reconcile)
// ---------------------------------------------------------------------------

export interface PlannerInputStub {
  workClass: string;
  packetCount: number;
  couplingLevel: string;
  ownershipClarity: string;
  repoStability: string;
  objectivePriority: string;
  seamDensity?: string;
}

export interface FitAssessmentStub {
  mode: string;
  fitLevel: string;
  predictedGradeRange: [string, string];
  breakEvenEstimate: number;
  reasons: string[];
  warnings: Array<{ id: string; severity: string; description: string; evidence: string }>;
  suggestedTemplate: string | null;
}

// ---------------------------------------------------------------------------
// RunPlan
// ---------------------------------------------------------------------------

export interface RunPlan {
  id: string;
  createdAt: string;
  version: number;
  input: PlannerInputStub;
  assessment: FitAssessmentStub;
  overrideRationale?: string;
  frozen: boolean;
}

// ---------------------------------------------------------------------------
// RunBlueprint
// ---------------------------------------------------------------------------

export interface PacketDefinition {
  packetId: string;
  label: string;
  role: string;
  packetClass: string;
  allowedFiles: string[];
  forbiddenFiles: string[];
  budgetMinutes: [number, number];
  ceilingMinutes: number;
  dependsOn: string[];
}

export interface WaveDefinition {
  wave: number;
  packets: PacketDefinition[];
}

export interface CouplingGuard {
  rule: string;
  enforcedBy: 'verifier' | 'integrator' | 'both';
}

export interface ChecklistItem {
  id: string;
  description: string;
  required: boolean;
}

export interface HumanGate {
  afterWave: number;
  gateType: string;
  description: string;
}

export interface ReadinessResult {
  ready: boolean;
  failures: string[];
  warnings: string[];
}

export interface RunBlueprint {
  id: string;
  planId: string;
  createdAt: string;
  version: number;
  templateId: string;
  workClass: string;
  repoRoot: string;
  waves: WaveDefinition[];
  couplingGuards: CouplingGuard[];
  verifierChecklist: ChecklistItem[];
  humanGates: HumanGate[];
  readinessResult: ReadinessResult;
  frozen: boolean;
  frozenAt?: string;
  frozenHash?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ValidationResult = { valid: boolean; errors: string[] };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isArrayOf<T>(v: unknown, check: (item: unknown) => item is T): v is T[] {
  return Array.isArray(v) && v.every(check);
}

function isStringArray(v: unknown): v is string[] {
  return isArrayOf(v, isNonEmptyString);
}

// ---------------------------------------------------------------------------
// validateRunPlan
// ---------------------------------------------------------------------------

export function validateRunPlan(plan: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(plan)) {
    return { valid: false, errors: ['plan must be an object'] };
  }

  if (!isNonEmptyString(plan['id'])) errors.push('id must be a non-empty string');
  if (!isNonEmptyString(plan['createdAt'])) errors.push('createdAt must be a non-empty string');
  if (!isPositiveInt(plan['version'])) errors.push('version must be a positive integer');
  if (!isBoolean(plan['frozen'])) errors.push('frozen must be a boolean');

  if (!isObject(plan['input'])) {
    errors.push('input must be an object');
  }

  if (!isObject(plan['assessment'])) {
    errors.push('assessment must be an object');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// validateRunBlueprint
// ---------------------------------------------------------------------------

export function validateRunBlueprint(blueprint: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(blueprint)) {
    return { valid: false, errors: ['blueprint must be an object'] };
  }

  const b = blueprint as Record<string, unknown>;

  // Required string fields
  for (const field of ['id', 'planId', 'createdAt', 'templateId', 'workClass', 'repoRoot']) {
    if (!isNonEmptyString(b[field])) errors.push(`${field} must be a non-empty string`);
  }

  if (!isPositiveInt(b['version'])) errors.push('version must be a positive integer');
  if (!isBoolean(b['frozen'])) errors.push('frozen must be a boolean');

  // waves — non-empty
  if (!Array.isArray(b['waves']) || (b['waves'] as unknown[]).length === 0) {
    errors.push('waves must be a non-empty array');
    return { valid: false, errors };
  }

  const waves = b['waves'] as WaveDefinition[];

  // couplingGuards non-empty
  if (!Array.isArray(b['couplingGuards']) || (b['couplingGuards'] as unknown[]).length === 0) {
    errors.push('couplingGuards must be a non-empty array');
  }

  // verifierChecklist non-empty
  if (!Array.isArray(b['verifierChecklist']) || (b['verifierChecklist'] as unknown[]).length === 0) {
    errors.push('verifierChecklist must be a non-empty array');
  }

  // humanGates non-empty
  if (!Array.isArray(b['humanGates']) || (b['humanGates'] as unknown[]).length === 0) {
    errors.push('humanGates must be a non-empty array');
  }

  // readinessResult must be object
  if (!isObject(b['readinessResult'])) {
    errors.push('readinessResult must be an object');
  }

  // -----------------------------------------------------------------------
  // Packet-level validation
  // -----------------------------------------------------------------------

  const allPacketIds = new Set<string>();
  const packetWaveMap = new Map<string, number>(); // packetId -> wave number

  for (const wave of waves) {
    if (!Array.isArray(wave.packets)) {
      errors.push(`wave ${String(wave.wave)} packets must be an array`);
      continue;
    }

    // Check file overlap within the same wave
    const waveFiles = new Map<string, string>(); // file -> packetId that owns it
    for (const pkt of wave.packets) {
      // Duplicate packetId check
      if (allPacketIds.has(pkt.packetId)) {
        errors.push(`duplicate packetId: ${pkt.packetId}`);
      }
      allPacketIds.add(pkt.packetId);
      packetWaveMap.set(pkt.packetId, wave.wave);

      // allowedFiles must be non-empty
      if (!isStringArray(pkt.allowedFiles) || pkt.allowedFiles.length === 0) {
        errors.push(`packet ${pkt.packetId} must have non-empty allowedFiles`);
      } else {
        for (const f of pkt.allowedFiles) {
          const existing = waveFiles.get(f);
          if (existing !== undefined) {
            errors.push(`file overlap in wave ${String(wave.wave)}: "${f}" claimed by ${existing} and ${pkt.packetId}`);
          }
          waveFiles.set(f, pkt.packetId);
        }
      }

      // budgetMinutes validation
      if (
        !Array.isArray(pkt.budgetMinutes) ||
        pkt.budgetMinutes.length !== 2 ||
        typeof pkt.budgetMinutes[0] !== 'number' ||
        typeof pkt.budgetMinutes[1] !== 'number'
      ) {
        errors.push(`packet ${pkt.packetId} must have budgetMinutes as [min, max]`);
      } else if (typeof pkt.ceilingMinutes !== 'number' || pkt.ceilingMinutes < pkt.budgetMinutes[1]) {
        errors.push(`packet ${pkt.packetId} ceilingMinutes must be >= budgetMinutes max`);
      }
    }
  }

  // Dependency consistency: dependsOn targets must exist in an earlier wave
  for (const wave of waves) {
    if (!Array.isArray(wave.packets)) continue;
    for (const pkt of wave.packets) {
      if (!Array.isArray(pkt.dependsOn)) continue;
      for (const dep of pkt.dependsOn) {
        const depWave = packetWaveMap.get(dep);
        if (depWave === undefined) {
          errors.push(`packet ${pkt.packetId} depends on unknown packet ${dep}`);
        } else if (depWave >= wave.wave) {
          errors.push(`packet ${pkt.packetId} depends on ${dep} which is in wave ${String(depWave)} (must be earlier than wave ${String(wave.wave)})`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// computeFreezeHash
// ---------------------------------------------------------------------------

export function computeFreezeHash(blueprint: RunBlueprint): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { frozenHash: _, ...rest } = blueprint;
  const payload = JSON.stringify(rest);
  return createHash('sha256').update(payload).digest('hex');
}
