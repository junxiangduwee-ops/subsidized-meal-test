/**
 * Meal receipt helpers.
 *
 * Auto-confirmation is now driven by the Vercel cron job at /api/cron
 * (runs daily at 18:00 MYT). The lazy-trigger functions below are kept
 * as thin no-ops so the existing call sites in page components compile
 * without changes — they simply return immediately instead of running a
 * DB update on every page load.
 *
 * The only function still actively used at runtime is `isCutoffPassed`,
 * which the UI calls to decide whether to show the undo button and hint text.
 */

import { zonedToUtc, APP_TIMEZONE } from './cycle';
import { getSiteSettings } from './settings';

function getCutoffUtc(year: number, month: number, day: number, cutoffHour: number): Date {
  return zonedToUtc(year, month, day, cutoffHour, 0, APP_TIMEZONE);
}

/**
 * No-op — auto-confirmation is now handled by the cron job.
 * Kept so call sites in page components do not need to change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function autoConfirmPastMeals(_userId: string): Promise<void> {
  // Intentionally empty — cron owns this now.
}

/**
 * No-op — auto-confirmation is now handled by the cron job.
 * Kept so call sites in page components do not need to change.
 */
export async function autoConfirmAllPastMeals(): Promise<void> {
  // Intentionally empty — cron owns this now.
}

/**
 * Returns whether the cutoff has already passed for a given service date.
 * Used by the panel and receipt button to decide whether to offer the undo
 * option and what hint text to show.
 */
export async function isCutoffPassed(serviceDateKey: string): Promise<boolean> {
  const { mealReceiptCutoffHour } = await getSiteSettings();
  const [y, m, d] = serviceDateKey.split('-').map(Number);
  return new Date() >= getCutoffUtc(y, m, d, mealReceiptCutoffHour);
}
