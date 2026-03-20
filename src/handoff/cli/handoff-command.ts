/**
 * Handoff Spine — Parent CLI command.
 *
 * multi-claude handoff create|show|render|invalidate|lineage|brief|decide
 */

import { Command } from 'commander';
import { handoffCreateCommand } from './handoff-create.js';
import { handoffShowCommand } from './handoff-show.js';
import { handoffRenderCommand } from './handoff-render.js';
import { handoffInvalidateCommand } from './handoff-invalidate.js';
import { handoffLineageCommand } from './handoff-lineage.js';
import { handoffBriefCommand } from './handoff-brief.js';
import { handoffDecideCommand } from './handoff-decide.js';
import { handoffQueueCommand } from './handoff-queue.js';
import { handoffInspectCommand } from './handoff-inspect.js';
import { handoffNextCommand } from './handoff-next.js';
import { handoffClaimCommand } from './handoff-claim.js';
import { handoffReleaseCommand } from './handoff-release.js';
import { handoffDeferCommand } from './handoff-defer.js';
import { handoffEscalateCommand } from './handoff-escalate.js';
import { handoffRequeueCommand } from './handoff-requeue.js';
import { handoffClaimsCommand } from './handoff-claims.js';
import { handoffRoutesCommand } from './handoff-routes.js';
import { handoffRouteCommand } from './handoff-route.js';
import { handoffRerouteCommand } from './handoff-reroute.js';
import { handoffAssignCommand, handoffUnassignCommand } from './handoff-assign.js';
import { handoffFlowCommand } from './handoff-flow.js';
import { handoffCapsCommand, handoffSetCapCommand } from './handoff-caps.js';
import { handoffOverflowCommand } from './handoff-overflow.js';
import { handoffStarvedCommand } from './handoff-starved.js';
import { handoffHealthCommand } from './handoff-health.js';
import { handoffBreachesCommand } from './handoff-breaches.js';
import { handoffInterveneCommand, handoffResolveInterventionCommand } from './handoff-intervene.js';
import {
  handoffOutcomesCommand,
  handoffOutcomeShowCommand,
  handoffReplayCommand,
} from './handoff-outcomes.js';
import {
  handoffPolicyCommand,
  handoffPolicyShowCommand,
  handoffPolicyValidateCommand,
  handoffPolicyDiffCommand,
  handoffPolicySimulateCommand,
  handoffPolicyActivateCommand,
  handoffPolicyRollbackCommand,
  handoffPolicyCreateCommand,
} from './handoff-policy.js';
import {
  handoffCalibrateCommand,
  handoffCalibrationShowCommand,
  handoffCalibrationsCommand,
} from './handoff-calibrate.js';
import {
  handoffPromoteCommand,
  handoffPromotionShowCommand,
  handoffPromotionsCommand,
  handoffPromotionValidateCommand,
  handoffPromotionTrialStartCommand,
  handoffPromotionTrialStopCommand,
  handoffPromotionCompareCommand,
  handoffPromotionApplyCommand,
  handoffPromotionRollbackCommand,
} from './handoff-promote.js';

export function handoffCommand(): Command {
  const cmd = new Command('handoff')
    .description('Handoff Spine — authoritative packet management');

  // Phase 1: Packet operations
  cmd.addCommand(handoffCreateCommand());
  cmd.addCommand(handoffShowCommand());
  cmd.addCommand(handoffRenderCommand());
  cmd.addCommand(handoffInvalidateCommand());
  cmd.addCommand(handoffLineageCommand());

  // Phase 3: Decision briefs
  cmd.addCommand(handoffBriefCommand());
  cmd.addCommand(handoffDecideCommand());

  // Phase 4: Decision queue
  cmd.addCommand(handoffQueueCommand());
  cmd.addCommand(handoffInspectCommand());

  // Phase 5: Supervisor loop
  cmd.addCommand(handoffNextCommand());
  cmd.addCommand(handoffClaimCommand());
  cmd.addCommand(handoffReleaseCommand());
  cmd.addCommand(handoffDeferCommand());
  cmd.addCommand(handoffEscalateCommand());
  cmd.addCommand(handoffRequeueCommand());
  cmd.addCommand(handoffClaimsCommand());

  // Phase 6: Routing law
  cmd.addCommand(handoffRoutesCommand());
  cmd.addCommand(handoffRouteCommand());
  cmd.addCommand(handoffRerouteCommand());
  cmd.addCommand(handoffAssignCommand());
  cmd.addCommand(handoffUnassignCommand());

  // Phase 7: Flow control
  cmd.addCommand(handoffFlowCommand());
  cmd.addCommand(handoffCapsCommand());
  cmd.addCommand(handoffSetCapCommand());
  cmd.addCommand(handoffOverflowCommand());
  cmd.addCommand(handoffStarvedCommand());

  // Phase 8: Intervention law
  cmd.addCommand(handoffHealthCommand());
  cmd.addCommand(handoffBreachesCommand());
  cmd.addCommand(handoffInterveneCommand());
  cmd.addCommand(handoffResolveInterventionCommand());

  // Phase 10: Outcome ledger
  cmd.addCommand(handoffOutcomesCommand());
  cmd.addCommand(handoffOutcomeShowCommand());
  cmd.addCommand(handoffReplayCommand());

  // Phase 9: Policy control
  cmd.addCommand(handoffPolicyCommand());
  cmd.addCommand(handoffPolicyShowCommand());
  cmd.addCommand(handoffPolicyValidateCommand());
  cmd.addCommand(handoffPolicyDiffCommand());
  cmd.addCommand(handoffPolicySimulateCommand());
  cmd.addCommand(handoffPolicyActivateCommand());
  cmd.addCommand(handoffPolicyRollbackCommand());
  cmd.addCommand(handoffPolicyCreateCommand());

  // Phase 11: Calibration law
  cmd.addCommand(handoffCalibrateCommand());
  cmd.addCommand(handoffCalibrationShowCommand());
  cmd.addCommand(handoffCalibrationsCommand());

  // Phase 12: Promotion law
  cmd.addCommand(handoffPromoteCommand());
  cmd.addCommand(handoffPromotionShowCommand());
  cmd.addCommand(handoffPromotionsCommand());
  cmd.addCommand(handoffPromotionValidateCommand());
  cmd.addCommand(handoffPromotionTrialStartCommand());
  cmd.addCommand(handoffPromotionTrialStopCommand());
  cmd.addCommand(handoffPromotionCompareCommand());
  cmd.addCommand(handoffPromotionApplyCommand());
  cmd.addCommand(handoffPromotionRollbackCommand());

  return cmd;
}
