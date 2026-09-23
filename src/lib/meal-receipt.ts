/**
 * Lazy auto-confirm: no cron job, no scheduler.
 *
 * The system auto-confirms past-6-PM service dates whenever this function
 * is called — typically at the start of any request that reads OrderItems
 * (the menu page, orders page, kitchen page, etc.).
 *
 * How it works:
 * - On every relevant page load, call autoConfirmPastMeals(userId).
 * - It finds any PAID OrderItem for this user where:
 *     - serviceDate is today or earlier
 *     - receivedAt is still null
 *     - it is past 18:00 on that service date in APP_TIMEZONE
 * - Those items are silently marked receivedBySystem = true.
 * - The next read of those items will already show them as confirmed.
 *
 * This is cheap: the index on (serviceDate, receivedAt) means the query
 * only scans unconfirmed rows. On most requests it touches zero rows
 * (once confirmed, items are never re-checked). The update is fire-and-
 * forget — we await it so the page always shows the correct state, but
 * it adds only one fast indexed query per page load.
 *
 * For admin/kitchen views that need totals across all employees, call
 * autoConfirmAllPastMeals() instead (no userId filter).
 */

import { prisma } from './prisma';
import { todayInAppTz, toDateKey, zonedToUtc, APP_TIMEZONE } from './cycle';

/**
 * Returns all service dates that are in the past AND past 18:00 — i.e.
 * dates where the auto-confirm deadline has already passed.
 * "Past" means: date < today, OR (date = today AND now >= 18:00 local).
 */
function getAutoConfirmCutoffDates(now: Date): { beforeDate: Date; todayIfPast6pm: Date | null } {
  const today = todayInAppTz(now);
  const todayKey = toDateKey(today);
  const [y, m, d] = todayKey.split('-').map(Number);
  const cutoff6pm = zonedToUtc(y, m, d, 18, 0, APP_TIMEZONE);

  return {
    // Any service date strictly before today is unconditionally past 18:00
    beforeDate: today,
    // Today itself only qualifies if the clock has passed 18:00
    todayIfPast6pm: now >= cutoff6pm ? today : null,
  };
}

/**
 * Auto-confirm unconfirmed PAID meal items for a specific employee.
 * Call this at the top of any server component/action that renders
 * today's or past meals for the employee.
 */
export async function autoConfirmPastMeals(userId: string): Promise<void> {
  const now = new Date();
  const { beforeDate, todayIfPast6pm } = getAutoConfirmCutoffDates(now);

  // Build the serviceDate filter: all dates before today, plus today
  // if it's past 18:00.
  const serviceDateFilter = todayIfPast6pm
    ? { lte: todayIfPast6pm }    // covers today AND all earlier dates
    : { lt: beforeDate };        // only strictly past dates

  await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: {
        userId,
        status: 'PAID',
      },
    },
    data: {
      receivedAt: now,
      receivedBySystem: true,
    },
  });
}

/**
 * Auto-confirm across ALL employees — for admin/kitchen pages that show
 * system-wide receipt totals. Uses the same date logic.
 */
export async function autoConfirmAllPastMeals(): Promise<void> {
  const now = new Date();
  const { beforeDate, todayIfPast6pm } = getAutoConfirmCutoffDates(now);

  const serviceDateFilter = todayIfPast6pm
    ? { lte: todayIfPast6pm }
    : { lt: beforeDate };

  await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: { status: 'PAID' },
    },
    data: {
      receivedAt: now,
      receivedBySystem: true,
    },
  });
}
