import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { autoConfirmPastMeals, isCutoffPassed } from '@/lib/meal-receipt';
import { getSiteSettings, formatCutoffHour } from '@/lib/settings';
import { todayInAppTz, toDateKey, formatDate, formatDateTime, formatWeekRange } from '@/lib/cycle';
import { PageHeader, Section, EmptyState } from '@/components/ui';
import { MealReceiptButton } from '@/components/meal-receipt-button';

export const dynamic = 'force-dynamic';

export default async function MyMealsPage() {
  const user = await requireCapability('order:place');
  const locale = await getLocale();

  // Run lazy auto-confirm before reading — no cron needed.
  await autoConfirmPastMeals(user.id);

  const today = todayInAppTz();
  const todayKey = toDateKey(today);

  const [todayItems, settings, pastItems] = await Promise.all([
    // Today's paid meals
    prisma.orderItem.findMany({
      where: {
        serviceDate: today,
        order: { userId: user.id, status: 'PAID' },
      },
      select: {
        id: true,
        dishName: true,
        restaurantName: true,
        serviceDate: true,
        receivedAt: true,
        receivedBySystem: true,
        order: { select: { cycle: { select: { serviceWeekStart: true } } } },
      },
      orderBy: { dishName: 'asc' },
    }),
    getSiteSettings(),
    // Past paid meals (excluding today), newest first, last 30 days
    prisma.orderItem.findMany({
      where: {
        serviceDate: { lt: today },
        order: { userId: user.id, status: 'PAID' },
      },
      select: {
        id: true,
        dishName: true,
        restaurantName: true,
        serviceDate: true,
        receivedAt: true,
        receivedBySystem: true,
        order: { select: { cycle: { select: { serviceWeekStart: true } } } },
      },
      orderBy: { serviceDate: 'desc' },
      take: 60,
    }),
  ]);

  const cutoffPassed = await isCutoffPassed(todayKey);
  const cutoffLabel = formatCutoffHour(settings.mealReceiptCutoffHour);

  // Group past items by service week
  const byWeek = new Map<string, typeof pastItems>();
  for (const item of pastItems) {
    const weekKey = toDateKey(item.order.cycle.serviceWeekStart);
    const bucket = byWeek.get(weekKey);
    if (bucket) bucket.push(item);
    else byWeek.set(weekKey, [item]);
  }

  return (
    <>
      <PageHeader
        title="My Meals"
        subtitle="Confirm you received your meal. Past meals are shown below."
      />

      {/* ── Today's meals ─────────────────────────────────────────────── */}
      {todayItems.length === 0 ? (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-slate-700">No paid meals for today</p>
          <p className="mt-1 text-xs text-slate-400">
            {formatDate(today, 'full', locale)}
          </p>
        </div>
      ) : (
        <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
            </svg>
            <h2 className="text-sm font-semibold text-emerald-900">
              Today &mdash; {formatDate(today, 'full', locale)}
            </h2>
          </div>

          {todayItems.every((i) => i.receivedAt !== null) ? (
            <p className="mb-3 text-xs text-emerald-700">All your meals for today are confirmed. Thank you!</p>
          ) : (
            <p className="mb-3 text-xs text-emerald-700">
              Please confirm you received your meal. If you don&rsquo;t, it will be
              automatically confirmed at <strong>{cutoffLabel}</strong>.
            </p>
          )}

          <ul className="space-y-3">
            {todayItems.map((item) => (
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
                  canUndo={!cutoffPassed && item.receivedAt !== null && !item.receivedBySystem}
                  receivedAtLabel={item.receivedAt ? formatDateTime(item.receivedAt, locale) : undefined}
                />
              </li>
            ))}
          </ul>

          {todayItems.some((i) => i.receivedAt === null) && (
            <p className="mt-3 text-xs text-slate-400">
              Auto-confirm runs at {cutoffLabel}.
            </p>
          )}
        </section>
      )}

      {/* ── Past meals ────────────────────────────────────────────────── */}
      {byWeek.size === 0 ? (
        <EmptyState title="No past meals" hint="Your meal history will appear here." />
      ) : (
        <div className="grid gap-6">
          {[...byWeek.entries()].map(([weekKey, items]) => {
            const weekStart = new Date(weekKey + 'T00:00:00.000Z');
            const confirmedCount = items.filter((i) => i.receivedAt !== null).length;

            return (
              <Section
                key={weekKey}
                title={formatWeekRange(weekStart, locale)}
                description={`${confirmedCount} of ${items.length} confirmed`}
              >
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Dish</th>
                        <th>Restaurant</th>
                        <th>Receipt</th>
                        <th>Confirmed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td className="whitespace-nowrap text-slate-700">
                            {formatDate(item.serviceDate, 'long', locale)}
                          </td>
                          <td className="font-medium text-slate-900">{item.dishName}</td>
                          <td className="text-slate-600">{item.restaurantName}</td>
                          <td>
                            {item.receivedAt ? (
                              <span className="badge bg-emerald-100 text-emerald-800">Confirmed</span>
                            ) : (
                              <span className="badge bg-amber-100 text-amber-800">Pending</span>
                            )}
                          </td>
                          <td className="text-xs text-slate-500 whitespace-nowrap">
                            {item.receivedAt ? formatDateTime(item.receivedAt, locale) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            );
          })}
        </div>
      )}
    </>
  );
}
