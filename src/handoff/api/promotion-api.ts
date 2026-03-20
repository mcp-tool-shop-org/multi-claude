/**
 * Promotion Law — API.
 *
 * Read-only inspection for promotion records and comparisons.
 */

import type { PromotionStore } from '../promotion/promotion-store.js';
import type { PromotionRecord, TrialComparison, PromotionEvent } from '../promotion/types.js';

export interface PromotionShowResult {
  ok: true;
  promotion: PromotionRecord;
  events: PromotionEvent[];
  comparisons: TrialComparison[];
}

export interface PromotionShowError {
  ok: false;
  error: string;
}

export function promotionShow(
  promotionStore: PromotionStore,
  promotionId: string,
): PromotionShowResult | PromotionShowError {
  const promotion = promotionStore.getPromotion(promotionId);
  if (!promotion) {
    return { ok: false, error: `Promotion '${promotionId}' not found` };
  }
  const events = promotionStore.getEvents(promotionId);
  const comparisons = promotionStore.getComparisons(promotionId);
  return { ok: true, promotion, events, comparisons };
}

export function promotionList(
  promotionStore: PromotionStore,
  opts?: { status?: string; scope?: string; limit?: number },
): PromotionRecord[] {
  return promotionStore.listPromotions(opts as Parameters<PromotionStore['listPromotions']>[0]);
}
