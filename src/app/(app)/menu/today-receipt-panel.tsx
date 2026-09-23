/**
 * TodayReceiptPanel — server component.
 *
 * Shown at the top of /menu on service days when the employee has a PAID
 * meal. Calls autoConfirmPastMeals() first so that by the time we read
 * the items, anything past 18:00 is already marked — no cron needed.
 *
 * Returns null silently on non-service days or when there are no paid meals.
 */

import { prisma } from '@/lib/prisma';
import { autoConfirmPastMeals } from '@/lib/meal-receipt';
import { todayInAppTz, toDateKey, formatDate, formatDateTime, zonedToUtc, APP_TIMEZONE } from '@/lib/cycle';
import { MealReceiptButton } from '@/components/meal-receipt-button';

export async function TodayReceiptPanel({ userId, locale }: { userId: string; locale?: string }) {
  // Run the lazy auto-confirm BEFORE reading items — this is what makes
  // the "past 18:00" auto-confirm happen without a cron job. If it's
  // already past 6 PM and the employee hasn't tapped the button, the
  // items will show as auto-confirmed when we read them below.
  await autoConfirmPastMeals(userId);

  const today = todayInAppTz();
  const todayKey = toDateKey(today);

  const items = await prisma.orderItem.findMany({
    where: {
      serviceDate: today,
      order: { userId, status: 'PAID' },
    },
    select: {
      id: true,
      dishName: true,
      restaurantName: true,
      serviceDate: true,
      receivedAt: true,
      receivedBySystem: true,
    },
    orderBy: { dishName: 'asc' },
  });

  if (items.length === 0) return null;

  const now = new Date();
  const [y, m, d] = todayKey.split('-').map(Number);
  const cutoff6pm = zonedToUtc(y, m, d, 18, 0, APP_TIMEZONE);
  const before6pm = now < cutoff6pm;
  const allConfirmed = items.every((i) => i.receivedAt !== null);

  return (
    <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
        </svg>
        <h2 className="text-sm font-semibold text-emerald-900">
          Today&rsquo;s meal &mdash; {formatDate(today, 'weekday', locale)}, {formatDate(today, 'long', locale)}
        </h2>
      </div>

      {allConfirmed ? (
        <p className="mb-3 text-xs text-emerald-700">All your meals for today are confirmed. Thank you!</p>
      ) : (
        <p className="mb-3 text-xs text-emerald-700">
          Please confirm you received your meal. If you don&rsquo;t, it will be automatically
          confirmed at <strong>6:00 PM</strong>.
        </p>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}
            className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">{item.dishName}</p>
              <p className="text-xs text-slate-500">{item.restaurantName}</p>
            </div>
            <MealReceiptButton
              orderItemId={item.id}
              receivedAt={item.receivedAt}
              receivedBySystem={item.receivedBySystem}
              canUndo={before6pm && item.receivedAt !== null && !item.receivedBySystem}
              receivedAtLabel={item.receivedAt ? formatDateTime(item.receivedAt, locale) : undefined}
            />
          </li>
        ))}
      </ul>

      {!allConfirmed && (
        <p className="mt-3 text-xs text-slate-400">
          Auto-confirm runs at 6:00 PM {APP_TIMEZONE.replace(/_/g, ' ')}.
        </p>
      )}
    </section>
  );
}
