/**
 * Handoff Spine — Multi-Claude Control Plane v2 Subsystem.
 *
 * Authoritative, versioned handoff packets with exact-ID retrieval,
 * role-first rendering, audit trail, and integrity binding.
 *
 * Chain: packet → role renderer → model adapter → working context
 */

// Schema
export type {
  HandoffPacket,
  HandoffPacketRecord,
  HandoffId,
  PacketVersion,
  RendererVersion,
  ContentHash,
  HandoffScope,
  HandoffLane,
  HandoffInstructionLayer,
  HandoffDecision,
  HandoffRejection,
  HandoffOpenLoop,
  HandoffArtifactRef,
  HandoffPacketStatus,
  ArtifactKind,
  OpenLoopPriority,
} from './schema/packet.js';

export type { HandoffArtifactRecord } from './schema/artifact.js';

export type {
  RoleRendererInput,
  RoleRenderedContext,
  ModelAdapterInput,
  WorkingContext,
  RenderEventRecord,
  HandoffUseRecord,
  RoleRenderer,
  ModelAdapter,
} from './schema/render.js';

export type {
  LineageRelation,
  InvalidationReasonCode,
  HandoffLineageRecord,
  HandoffInvalidationRecord,
  HandoffApprovalRecord,
  HandoffApprovalType,
  HandoffApprovalStatus,
  HandoffPacketVersionRow,
} from './schema/version.js';

// Store
export { HandoffStore } from './store/handoff-store.js';
export { migrateHandoffSchema, handoffTableCount } from './store/handoff-sql.js';
export { ArtifactCAS } from './store/artifact-cas.js';

// Integrity
export { computePacketHash, computeOutputHash } from './integrity/hash.js';
export { verifyPacketIntegrity } from './integrity/verify-packet.js';
export { invalidatePacketVersion } from './integrity/invalidation-engine.js';

// Derive
export { deriveHandoffPacket, type DeriveHandoffInput } from './derive/derive-handoff-packet.js';
export { deriveOpenLoops, type OpenLoopSource } from './derive/derive-open-loops.js';
export { deriveDecisions, deriveRejections } from './derive/derive-decisions.js';
export { deriveArtifactRefs } from './derive/derive-artifact-refs.js';

// Render
export { WorkerRenderer } from './render/role/worker-renderer.js';
export { ReviewerRenderer } from './render/role/reviewer-renderer.js';
export { ApproverRenderer } from './render/role/approver-renderer.js';
export { RecoveryRenderer } from './render/role/recovery-renderer.js';
export { ClaudeAdapter } from './render/adapters/claude-adapter.js';
export { GptAdapter } from './render/adapters/gpt-adapter.js';
export { OllamaAdapter } from './render/adapters/ollama-adapter.js';
export { composeWorkingContext } from './render/compose-working-context.js';
export { truncateToTokenBudget, estimateTokens, allocateBudget } from './render/truncation-policy.js';

// API
export { createHandoff } from './api/create-handoff.js';
export { readHandoff } from './api/read-handoff.js';
export { renderHandoff } from './api/render-handoff.js';
export { invalidateHandoff } from './api/invalidate-handoff.js';
export { listHandoffLineage } from './api/list-handoff-lineage.js';
export {
  resolveLastValidHandoff,
  resolveLastValidHandoffForPacket,
  type ResolvedHandoff,
  type ResolvedHandoffError,
} from './api/resolve-handoff.js';
export {
  resolveApprovalHandoff,
  type ApprovalHandoffResult,
  type ApprovalHandoffError,
} from './api/resolve-approval-handoff.js';

// Bridge (Phase 2 — execution DB ↔ spine)
export { bridgeExecutionPacket, type BridgeInput, type BridgeResult, type BridgeError } from './bridge/execution-to-handoff.js';
export { createFallbackEvidence, type FallbackEvidence, type FallbackReason } from './bridge/fallback-evidence.js';

// Decision Briefs (Phase 3)
export type {
  DecisionBrief,
  DecisionRole,
  DecisionAction,
  DecisionBlocker,
  EvidenceCoverage,
  ActionEligibility,
  BaselineDelta,
  DecisionActionRecord,
  BlockerSeverity,
} from './decision/types.js';
export { BRIEF_VERSION } from './decision/types.js';
export { deriveDecisionBrief, type DeriveBriefInput } from './decision/derive-decision-brief.js';
export { resolveBaseline, computeBaselineDelta } from './decision/derive-baseline-delta.js';
export { deriveBlockers } from './decision/derive-blockers.js';
export { deriveEvidenceCoverage } from './decision/derive-evidence-coverage.js';
export { renderReviewerBrief } from './decision/reviewer-decision-renderer.js';
export { renderApproverBrief } from './decision/approver-decision-renderer.js';
export { bindDecisionAction } from './decision/bind-decision-action.js';
export { createDecisionBrief, type CreateBriefResult, type CreateBriefError } from './api/create-decision-brief.js';

// Decision Queue (Phase 4)
export type {
  QueueItem,
  QueueItemStatus,
  QueueEvent,
  QueueEventKind,
  PriorityClass,
} from './queue/types.js';
export { PRIORITY_WEIGHT, TERMINAL_STATUSES } from './queue/types.js';
export { QueueStore } from './queue/queue-store.js';
export { migrateQueueSchema } from './queue/queue-sql.js';
export { classifyPriority, deriveQueueItem, enqueueDecisionBrief } from './queue/derive-queue-item.js';
export {
  actOnQueueItem,
  propagateStaleness,
  propagateInvalidation,
  requeueStaleItem,
  type QueueActionInput,
  type QueueActionResult,
  type QueueActionError,
  type RequeueResult,
  type RequeueError,
} from './queue/queue-actions.js';
export {
  enqueueHandoff,
  listQueue,
  inspectQueueItem,
  inspectByHandoff,
  type EnqueueResult,
  type EnqueueError,
  type InspectResult,
  type InspectError,
} from './api/queue-api.js';

// Supervisor Loop (Phase 5)
export type {
  SupervisorClaim,
  ClaimStatus,
  SupervisorEvent,
  SupervisorEventKind,
} from './supervisor/types.js';
export { DEFAULT_LEASE_DURATION_MS, TERMINAL_CLAIM_STATUSES } from './supervisor/types.js';
export { SupervisorStore } from './supervisor/supervisor-store.js';
export { migrateSupervisorSchema } from './supervisor/supervisor-sql.js';
export {
  claimQueueItem,
  releaseClaim,
  deferClaim,
  escalateClaim,
  requeueClaim,
  resolveNextItem,
  sweepExpiredLeases,
  interruptStaleClaims,
  type ClaimResult,
  type SupervisorError,
  type NextItemResult,
  type NextItemEmpty,
} from './supervisor/supervisor-actions.js';
export {
  supervisedInspect,
  type SupervisedInspectResult,
  type SupervisedInspectError,
} from './api/supervisor-api.js';

// Routing Law (Phase 6)
export type {
  Route,
  RouteStatus,
  RoutingLane,
  RoutingReasonCode,
  RoutingEvent,
  RoutingEventKind,
} from './routing/types.js';
export { ALL_LANES } from './routing/types.js';
export { RoutingStore } from './routing/routing-store.js';
export { migrateRoutingSchema } from './routing/routing-sql.js';
export {
  resolveLane,
  resolveDefaultTarget,
  createInitialRoute,
  rerouteItem,
  assignTarget,
  unassignTarget,
  applyActionRouting,
  applyEscalationRouting,
  interruptStaleRoutes,
  resurfaceDeferredRoutes,
  type RouteResult,
  type RoutingError,
} from './routing/routing-actions.js';
export {
  routedInspect,
  type RoutedInspectResult,
  type RoutedInspectError,
} from './api/routing-api.js';

// Flow Control (Phase 7)
export type {
  LaneCapState,
  FlowStatus,
  FlowEvent,
  FlowEventKind,
  FlowReasonCode,
  AdmissionGranted,
  AdmissionDenied,
} from './flow/types.js';
export {
  DEFAULT_STARVATION_THRESHOLD_MS,
  DEFAULT_WIP_CAP,
  DEFAULT_RECOVERY_THROTTLE,
} from './flow/types.js';
export { FlowStore } from './flow/flow-store.js';
export { migrateFlowSchema } from './flow/flow-sql.js';
export {
  countActiveInLane,
  countPendingInLane,
  computeLaneState,
  computeAllLaneStates,
  checkAdmission,
  checkAdmissionWithThrottle,
  enterOverflow,
  resurfaceOverflow,
  recordCapacityFreed,
  recordCapChange,
  detectStarvation,
  recordStarvation,
  setLaneCap,
  reconcileLaneCounts,
  type SetCapResult,
  type SetCapError,
  type StarvedItem,
} from './flow/flow-actions.js';
export {
  flowInspect,
  laneInspect,
  type FlowInspectResult,
  type LaneInspectResult,
} from './api/flow-api.js';

// Intervention Law (Phase 8)
export type {
  HealthState,
  BreachCode,
  InterventionAction,
  InterventionStatus,
  HealthSnapshot,
  Intervention,
  InterventionEvent,
  InterventionEventKind,
  InterventionReasonCode,
  BreachThresholds,
} from './intervention/types.js';
export { DEFAULT_BREACH_THRESHOLDS } from './intervention/types.js';
export { InterventionStore } from './intervention/intervention-store.js';
export { migrateInterventionSchema } from './intervention/intervention-sql.js';
export {
  deriveHealthSnapshot,
  deriveAllHealthSnapshots,
  startIntervention,
  resolveIntervention,
  checkInterventionForClaim,
  checkInterventionForAdmission,
  type InterventionResult,
  type InterventionError,
  type InterventionCheck,
  type InterventionBlocked,
} from './intervention/intervention-actions.js';
export {
  healthInspect,
  laneHealthInspect,
  type HealthInspectResult,
  type LaneHealthResult,
} from './api/intervention-api.js';

// Policy Control (Phase 9)
export type {
  PolicyStatus,
  PolicyContent,
  PolicySet,
  PolicyEvent,
  PolicyEventKind,
  ValidationResult,
  ValidationError,
  PolicyDiff,
  SimulationResult,
} from './policy/types.js';
export { DEFAULT_POLICY_CONTENT } from './policy/types.js';
export { PolicyStore } from './policy/policy-store.js';
export { migratePolicySchema } from './policy/policy-sql.js';
export {
  computePolicyHash,
  validatePolicy,
  createPolicySet,
  activatePolicy,
  rollbackPolicy,
  resolveActivePolicy,
  diffPolicies,
  simulatePolicy,
  type CreatePolicyResult,
  type CreatePolicyError,
  type ActivateResult,
  type ActivateError,
  type RollbackResult,
  type RollbackError,
} from './policy/policy-actions.js';
export {
  policyInspect,
  policyShow,
  policyDiff,
  policySimulate,
  type PolicyInspectResult,
  type PolicyShowResult,
  type PolicyShowError,
  type PolicyDiffResult,
  type PolicyDiffError,
  type PolicySimulateResult,
} from './api/policy-api.js';

// Outcome Ledger (Phase 10)
export type {
  Outcome,
  OutcomeStatus,
  OutcomeEvent,
  OutcomeEventKind,
  ResolutionTerminal,
  ResolutionQuality,
  ReplayEntry,
  ReplayEntryKind,
  ReplayTimeline,
  CloseOutcomeInput,
} from './outcome/types.js';
export { OutcomeStore } from './outcome/outcome-store.js';
export { migrateOutcomeSchema } from './outcome/outcome-sql.js';
export {
  openOutcome,
  closeOutcome,
  computeEffectivenessCounters,
  deriveResolutionQuality,
  deriveResolutionTerminal,
  buildReplayTimeline,
  type OpenOutcomeResult,
  type OpenOutcomeError,
  type CloseOutcomeResult,
  type CloseOutcomeError,
  type EffectivenessCounters,
} from './outcome/outcome-actions.js';
export {
  outcomeInspect,
  outcomeByQueueItem,
  outcomeReplay,
  type OutcomeInspectResult,
  type OutcomeInspectError,
  type ReplayResult,
  type ReplayError,
} from './api/outcome-api.js';

// Calibration Law (Phase 11)
export type {
  PolicyFitness,
  LaneFitness,
  PainCode,
  PainSeverity,
  PainSignal,
  PainEvidence,
  AdjustmentKind,
  PolicyAdjustment,
  AdjustmentEvidence,
  CalibrationReport,
  CalibrationThresholds,
} from './calibration/types.js';
export { DEFAULT_CALIBRATION_THRESHOLDS } from './calibration/types.js';
export { CalibrationStore } from './calibration/calibration-store.js';
export { migrateCalibrationSchema } from './calibration/calibration-sql.js';
export { derivePolicyFitness } from './calibration/derive-policy-fitness.js';
export { deriveLaneFitness, deriveAllLaneFitness } from './calibration/derive-lane-fitness.js';
export { detectPolicyPain } from './calibration/detect-policy-pain.js';
export { proposePolicyAdjustments } from './calibration/propose-policy-adjustments.js';
export {
  buildCalibrationReport,
  type BuildCalibrationResult,
  type BuildCalibrationError,
} from './calibration/build-calibration-report.js';
export {
  calibrationShow,
  calibrationList,
  type CalibrationShowResult,
  type CalibrationShowError,
} from './api/calibration-api.js';

// Promotion Law (Phase 12)
export type {
  PromotionStatus,
  PromotionRecord,
  PromotionEventKind,
  PromotionEvent,
  TrialScopeKind,
  TrialScope,
  ComparisonMetrics,
  ComparisonDiff,
  ComparisonVerdict,
  TrialComparison,
  PromotionEligibilityRules,
  CreateCandidateInput,
} from './promotion/types.js';
export { TERMINAL_PROMOTION_STATUSES, DEFAULT_PROMOTION_RULES } from './promotion/types.js';
export { PromotionStore } from './promotion/promotion-store.js';
export { migratePromotionSchema } from './promotion/promotion-sql.js';
export {
  createCandidate,
  validateCandidate,
  startTrial,
  stopTrial,
  compareTrialOutcomes,
  promoteCandidate,
  rollbackCandidate,
  rejectCandidate,
} from './promotion/promotion-actions.js';
export {
  promotionShow,
  promotionList,
  type PromotionShowResult,
  type PromotionShowError,
} from './api/promotion-api.js';

// CLI
export { handoffCommand } from './cli/handoff-command.js';
