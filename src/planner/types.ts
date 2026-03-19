export type WorkClass = 'backend_state' | 'ui_interaction' | 'control_plane';
export type CouplingLevel = 'low' | 'moderate' | 'high';
export type OwnershipClarity = 'clear' | 'mixed' | 'unclear';
export type RepoStability = 'stable' | 'settling' | 'unstable';
export type ObjectivePriority = 'speed' | 'quality' | 'balanced';
export type FitLevel = 'strong' | 'moderate' | 'weak';
export type ModeRecommendation = 'single_claude' | 'multi_claude' | 'multi_claude_cautious';

export interface PlannerInput {
  workClass: WorkClass;
  packetCount: number;
  couplingLevel: CouplingLevel;
  ownershipClarity: OwnershipClarity;
  repoStability: RepoStability;
  objectivePriority: ObjectivePriority;
  seamDensity?: 'low' | 'moderate' | 'high';
}

export interface FitAssessment {
  mode: ModeRecommendation;
  fitLevel: FitLevel;
  predictedGradeRange: [string, string];
  breakEvenEstimate: number;
  reasons: string[];
  warnings: AntiPatternWarning[];
  suggestedTemplate: string | null;
}

export interface AntiPatternWarning {
  id: string;
  severity: 'block' | 'warn';
  description: string;
  evidence: string;
}
