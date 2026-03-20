/**
 * 9A-201: Planner Service
 *
 * Composes rules + schema + templates into a high-level planner service.
 * Entry point: evaluateRun() takes PlannerInput and returns a RunPlan.
 */

import { assessFit, explainRecommendation } from './rules.js';
import { suggestTemplate } from './templates.js';
import type { PlannerInput } from './types.js';
import type { RunPlan } from './schema.js';
import { generateId, nowISO } from '../lib/ids.js';

/**
 * Evaluate a run: assess fit, explain recommendation, and produce a RunPlan.
 *
 * The returned RunPlan uses PlannerInputStub/FitAssessmentStub from schema.ts,
 * which are structurally compatible supertypes of the narrow types from types.ts.
 */
export function evaluateRun(input: PlannerInput): RunPlan {
  const assessment = assessFit(input);
  const explanation = explainRecommendation(assessment);

  // suggestTemplate returns the template matching the work class (if any)
  // Template lookup reserved for future packet decomposition
  suggestTemplate(input.workClass);

  return {
    id: generateId('plan'),
    createdAt: nowISO(),
    version: 1,
    input,
    assessment: {
      ...assessment,
      reasons: explanation, // Use full explanation as reasons
    },
    frozen: false,
  };
}

/**
 * Attach an override rationale to a non-frozen plan.
 */
export function overridePlan(plan: RunPlan, rationale: string): RunPlan {
  if (plan.frozen) throw new Error('Cannot override a frozen plan');
  return { ...plan, overrideRationale: rationale };
}

/**
 * Freeze a plan, preventing further modifications.
 */
export function freezePlan(plan: RunPlan): RunPlan {
  if (plan.frozen) throw new Error('Plan is already frozen');
  return { ...plan, frozen: true };
}
