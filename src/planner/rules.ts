import type {
  WorkClass,
  FitLevel,
  ModeRecommendation,
  PlannerInput,
  FitAssessment,
  AntiPatternWarning,
} from './types.js';

export const BREAK_EVEN: Record<WorkClass, number> = {
  backend_state: 3,
  ui_interaction: 5,
  control_plane: 5,
};

const BASE_FIT: Record<WorkClass, FitLevel> = {
  backend_state: 'strong',
  ui_interaction: 'moderate',
  control_plane: 'moderate',
};

const FIT_RANK: Record<FitLevel, number> = {
  weak: 0,
  moderate: 1,
  strong: 2,
};

const RANK_TO_FIT: FitLevel[] = ['weak', 'moderate', 'strong'];

const TEMPLATE_MAP: Record<WorkClass, string> = {
  backend_state: 'backend_law',
  ui_interaction: 'ui_seam',
  control_plane: 'control_plane',
};

const GRADE_RANGES: Record<FitLevel, [string, string]> = {
  strong: ['A-', 'A+'],
  moderate: ['B', 'A-'],
  weak: ['C', 'B-'],
};

function clampFit(rank: number): FitLevel {
  const clamped = Math.max(0, Math.min(2, rank));
  return RANK_TO_FIT[clamped]!;
}

function adjustRank(rank: number, delta: number): number {
  return Math.max(0, Math.min(2, rank + delta));
}

export function assessFit(input: PlannerInput): FitAssessment {
  const breakEven = BREAK_EVEN[input.workClass];
  let rank = FIT_RANK[BASE_FIT[input.workClass]];

  // Step 2: packet count vs break-even
  if (input.packetCount < breakEven) {
    rank = adjustRank(rank, -1);
  } else if (input.packetCount > breakEven) {
    rank = adjustRank(rank, 1);
  }

  // Step 3: coupling adjustments
  if (input.couplingLevel === 'high') {
    if (input.packetCount < breakEven) {
      rank = 0; // force weak
    } else {
      rank = adjustRank(rank, -1);
    }
  }

  // Step 4: ownership adjustments
  if (input.ownershipClarity === 'unclear') {
    rank = adjustRank(rank, -1);
  } else if (input.ownershipClarity === 'mixed') {
    rank = adjustRank(rank, -1);
  }

  // Step 5: repo stability overrides
  if (input.repoStability === 'unstable') {
    rank = 0; // force weak
  } else if (input.repoStability === 'settling') {
    rank = Math.min(rank, 1); // cap at moderate
  }

  const fitLevel = clampFit(rank);

  // Step 6: mode from fit level
  let mode: ModeRecommendation;
  if (fitLevel === 'weak') {
    mode = 'single_claude';
  } else if (fitLevel === 'moderate') {
    mode = 'multi_claude_cautious';
  } else {
    mode = 'multi_claude';
  }

  // Step 7: grade range
  const predictedGradeRange = GRADE_RANGES[fitLevel];

  // Step 8: template
  const suggestedTemplate = mode === 'single_claude' ? null : TEMPLATE_MAP[input.workClass];

  // Step 9: anti-patterns
  const warnings = detectAntiPatterns(input);

  // If any blocker, force single_claude
  if (warnings.some(w => w.severity === 'block')) {
    return {
      mode: 'single_claude',
      fitLevel: 'weak',
      predictedGradeRange: GRADE_RANGES['weak'],
      breakEvenEstimate: breakEven,
      reasons: buildReasons(input, 'weak', 'single_claude'),
      warnings,
      suggestedTemplate: null,
    };
  }

  const reasons = buildReasons(input, fitLevel, mode);

  return {
    mode,
    fitLevel,
    predictedGradeRange,
    breakEvenEstimate: breakEven,
    reasons,
    warnings,
    suggestedTemplate,
  };
}

function buildReasons(input: PlannerInput, fitLevel: FitLevel, mode: ModeRecommendation): string[] {
  const reasons: string[] = [];
  const breakEven = BREAK_EVEN[input.workClass];

  reasons.push(`Work class "${input.workClass}" has base fit: ${BASE_FIT[input.workClass]}`);

  if (input.packetCount < breakEven) {
    reasons.push(`Packet count ${input.packetCount} is below break-even (${breakEven})`);
  } else if (input.packetCount > breakEven) {
    reasons.push(`Packet count ${input.packetCount} exceeds break-even (${breakEven}), parallelism advantage expected`);
  } else {
    reasons.push(`Packet count ${input.packetCount} is at break-even (${breakEven})`);
  }

  if (input.couplingLevel === 'high') {
    reasons.push('High coupling increases coordination overhead');
  }

  if (input.ownershipClarity !== 'clear') {
    reasons.push(`Ownership clarity "${input.ownershipClarity}" adds merge-conflict risk`);
  }

  if (input.repoStability === 'unstable') {
    reasons.push('Unstable repo forces single-Claude to avoid cascading conflicts');
  } else if (input.repoStability === 'settling') {
    reasons.push('Settling repo caps parallelism to cautious mode');
  }

  reasons.push(`Final assessment: ${fitLevel} fit -> ${mode}`);

  return reasons;
}

export function detectAntiPatterns(input: PlannerInput): AntiPatternWarning[] {
  const warnings: AntiPatternWarning[] = [];
  const breakEven = BREAK_EVEN[input.workClass];

  // 1. packet count <= 2 -> block
  if (input.packetCount <= 2) {
    warnings.push({
      id: 'TOO_FEW_PACKETS',
      severity: 'block',
      description: 'Packet count too low for any parallel benefit',
      evidence: `packetCount=${input.packetCount}, minimum viable is 3`,
    });
  }

  // 2. below break-even -> warn
  if (input.packetCount > 2 && input.packetCount < breakEven) {
    warnings.push({
      id: 'BELOW_BREAK_EVEN',
      severity: 'warn',
      description: `Packet count below break-even for ${input.workClass}`,
      evidence: `packetCount=${input.packetCount}, breakEven=${breakEven}`,
    });
  }

  // 3. unclear ownership -> warn
  if (input.ownershipClarity === 'unclear') {
    warnings.push({
      id: 'UNCLEAR_OWNERSHIP',
      severity: 'warn',
      description: 'Unclear file ownership increases merge-conflict probability',
      evidence: 'Phase 8 trials showed ownership clarity correlates with grade (Trial 8A)',
    });
  }

  // 4. high coupling + below break-even -> block
  if (input.couplingLevel === 'high' && input.packetCount < breakEven) {
    warnings.push({
      id: 'HIGH_COUPLING_LOW_PACKETS',
      severity: 'block',
      description: 'High coupling with insufficient packets creates coordination deadlock',
      evidence: `coupling=high, packetCount=${input.packetCount}, breakEven=${breakEven}`,
    });
  }

  // 5. unstable repo -> block
  if (input.repoStability === 'unstable') {
    warnings.push({
      id: 'UNSTABLE_REPO',
      severity: 'block',
      description: 'Unstable repo state prevents reliable parallel work',
      evidence: 'Phase 8 trials: unstable repos produced C-grade outcomes regardless of packet count',
    });
  }

  // 6. UI + packets < 5 -> warn (semantic reconciliation)
  if (input.workClass === 'ui_interaction' && input.packetCount < 5) {
    warnings.push({
      id: 'UI_SEMANTIC_RECONCILIATION',
      severity: 'warn',
      description: 'UI work below 5 packets risks semantic reconciliation overhead exceeding gains',
      evidence: `workClass=ui_interaction, packetCount=${input.packetCount}, breakEven=5`,
    });
  }

  // 7. control_plane + packets < 5 -> warn (coupling tax)
  if (input.workClass === 'control_plane' && input.packetCount < 5) {
    warnings.push({
      id: 'CONTROL_PLANE_COUPLING_TAX',
      severity: 'warn',
      description: 'Control-plane work below 5 packets incurs coupling tax that may negate parallelism',
      evidence: `workClass=control_plane, packetCount=${input.packetCount}, breakEven=5`,
    });
  }

  // 8. high seam density + not clear ownership -> warn
  if (input.seamDensity === 'high' && input.ownershipClarity !== 'clear') {
    warnings.push({
      id: 'HIGH_SEAM_UNCLEAR_OWNERSHIP',
      severity: 'warn',
      description: 'High seam density with non-clear ownership amplifies integration risk',
      evidence: `seamDensity=high, ownershipClarity=${input.ownershipClarity}`,
    });
  }

  return warnings;
}

export function explainRecommendation(assessment: FitAssessment): string[] {
  const lines: string[] = [];

  lines.push(`Recommendation: ${assessment.mode} (fit: ${assessment.fitLevel})`);
  lines.push(`Predicted grade range: ${assessment.predictedGradeRange[0]} to ${assessment.predictedGradeRange[1]}`);
  lines.push(`Break-even threshold: ${assessment.breakEvenEstimate} packets`);

  if (assessment.suggestedTemplate) {
    lines.push(`Suggested template: ${assessment.suggestedTemplate}`);
  }

  lines.push('');
  lines.push('Reasoning (backed by Phase 8 trial evidence):');
  for (const reason of assessment.reasons) {
    lines.push(`  - ${reason}`);
  }

  if (assessment.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of assessment.warnings) {
      const prefix = w.severity === 'block' ? 'BLOCKER' : 'WARNING';
      lines.push(`  [${prefix}] ${w.id}: ${w.description}`);
      lines.push(`    Evidence: ${w.evidence}`);
    }
  }

  return lines;
}
