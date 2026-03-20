/**
 * Calibration Law — API.
 *
 * Read-only inspection for calibration reports.
 */

import type { CalibrationStore } from '../calibration/calibration-store.js';
import type { CalibrationReport } from '../calibration/types.js';

export interface CalibrationShowResult {
  ok: true;
  report: CalibrationReport;
}

export interface CalibrationShowError {
  ok: false;
  error: string;
}

export function calibrationShow(
  calibrationStore: CalibrationStore,
  reportId: string,
): CalibrationShowResult | CalibrationShowError {
  const report = calibrationStore.getReport(reportId);
  if (!report) {
    return { ok: false, error: `Calibration report '${reportId}' not found` };
  }
  return { ok: true, report };
}

export function calibrationList(
  calibrationStore: CalibrationStore,
  opts?: { policySetId?: string; limit?: number },
): CalibrationReport[] {
  return calibrationStore.listReports(opts);
}
