/** Factory Fitness — cooperative run scoring */

/** Score weights (must sum to 100) */
export const SCORE_WEIGHTS = {
  quality: 40,
  lawfulness: 25,
  collaboration: 20,
  velocity: 15,
} as const;

/** Point maturation stages */
export const MATURATION = {
  submit: 0.20,   // 20% on submission
  verify: 0.30,   // 30% on verification
  integrate: 0.50, // 50% on integration
} as const;

/** Run-level score */
export interface RunScore {
  runId: string;
  featureId: string;
  timestamp: string;
  overall: number;        // 0-100
  quality: number;        // 0-40
  lawfulness: number;     // 0-25
  collaboration: number;  // 0-20
  velocity: number;       // 0-15
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  packets: PacketFitness[];
  penalties: Penalty[];
}

/** Packet-level fitness */
export interface PacketFitness {
  packetId: string;
  role: string;
  layer: string;
  /** Duration in seconds */
  duration: number;
  /** Expected duration range for this packet class */
  budgetRange: [number, number];
  /** Whether duration was within budget */
  withinBudget: boolean;
  /** Verification result */
  verificationPass: boolean;
  /** Integration survival */
  integrationSurvival: boolean;
  /** Amendment/reopen count */
  amendCount: number;
  /** Manual intervention count */
  manualInterventionCount: number;
  /** Matured points (0-100 raw, weighted by role) */
  maturedPoints: number;
  /** Current maturation stage */
  maturationStage: 'submitted' | 'verified' | 'integrated' | 'none';
}

/** Penalty record */
export interface Penalty {
  type: 'hard' | 'soft';
  category: string;
  description: string;
  points: number;
  packetId?: string;
}

/** Packet class for budget normalization */
export type PacketClass = 'state_domain' | 'backend' | 'ui_interaction' | 'verification' | 'integration' | 'docs_knowledge';

/** Expected duration ranges per packet class (seconds) */
export const PACKET_CLASS_BUDGETS: Record<PacketClass, [number, number]> = {
  state_domain: [120, 300],     // 2-5 min
  backend: [120, 360],          // 2-6 min
  ui_interaction: [180, 480],   // 3-8 min (acknowledge UI is harder)
  verification: [300, 600],     // 5-10 min
  integration: [300, 600],      // 5-10 min
  docs_knowledge: [120, 300],   // 2-5 min
};
