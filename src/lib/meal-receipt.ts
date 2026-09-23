/**
 * Lazy auto-confirm — no cron job, no scheduler.
 *
 * Called at the top of any server component that reads meal receipt data.
 * Marks PAID OrderItems as received when the configurable cutoff hour
 * (set by admin in /admin/settings) has passed on their service date.
 */

import { prisma } from './prisma';
import { todayInAppTz, toDateKey, zonedToUtc, APP_TIMEZONE } from './cycle';
import { getSiteSettings } from './settings';

function getCutoffUtc(year: number, month: number, day: number, cutoffHour: number): Date {
  return zonedToUtc(year, month, day, cutoffHour, 0, APP_TIMEZONE);
}

function buildServiceDateFilter(now: Date, cutoffHour: number) {
  const today = todayInAppTz(now);
  const todayKey = toDateKey(today);
  const [y, m, d] = todayKey.split('-').map(Number);
  const cutoffUtc = getCutoffUtc(y, m, d, cutoffHour);

  // Dates strictly before today are unconditionally past cutoff.
  // Today itself only qualifies if the clock has passed the cutoff hour.
  return now >= cutoffUtc
    ? { lte: today }   // today and all earlier dates
    : { lt: today };   // only strictly past dates
}

/**
 * Auto-confirm unconfirmed PAID meal items for one employee.
 * Call before reading that employee's order items for display.
 */
export async function autoConfirmPastMeals(userId: string): Promise<void> {
  const now = new Date();
  const { mealReceiptCutoffHour } = await getSiteSettings();
  const serviceDateFilter = buildServiceDateFilter(now, mealReceiptCutoffHour);

  await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: { userId, status: 'PAID' },
    },
    data: { receivedAt: now, receivedBySystem: true },
  });
}

/**
 * Auto-confirm across ALL employees — for admin/kitchen/receipt pages.
 */
export async function autoConfirmAllPastMeals(): Promise<void> {
  const now = new Date();
  const { mealReceiptCutoffHour } = await getSiteSettings();
  const serviceDateFilter = buildServiceDateFilter(now, mealReceiptCutoffHour);

  await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: { status: 'PAID' },
    },
    data: { receivedAt: now, receivedBySystem: true },
  });
}

/**
 * Returns whether the cutoff has already passed for a given service date
 * (today). Used by the panel and receipt button to decide whether to offer
 * the undo option and what hint text to show.
 */
export async function isCutoffPassed(serviceDateKey: string): Promise<boolean> {
  const { mealReceiptCutoffHour } = await getSiteSettings();
  const [y, m, d] = serviceDateKey.split('-').map(Number);
  return new Date() >= getCutoffUtc(y, m, d, mealReceiptCutoffHour);
}
