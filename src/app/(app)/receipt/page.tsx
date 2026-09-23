import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { autoConfirmAllPastMeals } from '@/lib/meal-receipt';
import { cyclePhase, formatDate, formatDateTime, formatWeekRange, toDateKey } from '@/lib/cycle';
import { deliverySiteSheet } from '@/lib/delivery';
import { PageHeader, Section, EmptyState, PhaseBadge, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = { cycle?: string; tab?: string };

export default async function ReceiptPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability('analytics:view');

  // Run lazy auto-confirm before reading any receipt data so numbers are
  // always current — no cron needed.
  await autoConfirmAllPastMeals();

  const params = await searchParams;
  const locale = await getLocale();

  const activeTab = params.tab === 'employee' ? 'employee' : 'delivery';

  // Cycle picker — same pattern as kitchen/reception pages
  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 20,
    select: { id: true, serviceWeekStart: true, status: true, orderOpenAt: true, orderCutoffAt: true },
  });

  if (cycles.length === 0) {
    return (
      <>
        <PageHeader title="Receipt Confirmation" subtitle="Delivery and employee meal receipt tracking" />
        <EmptyState title="No published weeks yet" hint="Publish a menu cycle to start tracking receipts." />
      </>
    );
  }

  const selected = cycles.find((c) => c.id === params.cycle) ?? cycles[0];
  const phase = cyclePhase(selected);

  // ── Tab switcher URLs ────────────────────────────────────────────────────
  const baseUrl = (tab: string) =>
    `?cycle=${selected.id}&tab=${tab}`;

  // ── Shared header ────────────────────────────────────────────────────────
  const header = (
    <PageHeader
      title="Receipt Confirmation"
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <PhaseBadge phase={phase} />
          <span>{formatWeekRange(selected.serviceWeekStart, locale)}</span>
        </span>
      }
      action={
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="tab" value={activeTab} />
          <select name="cycle" defaultValue={selected.id} className="input !w-56 !py-1 text-xs">
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {formatWeekRange(c.serviceWeekStart, locale)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-secondary btn-sm">
            Show
          </button>
        </form>
      }
    />
  );

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = (
    <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
      <a
        href={baseUrl('delivery')}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === 'delivery'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Delivery Reception
      </a>
      <a
        href={baseUrl('employee')}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === 'employee'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Employee Meal Receipt
      </a>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════
  // TAB 1 — Delivery Reception
  // Shows: did reception confirm that the food arrived at each site/day?
  // ════════════════════════════════════════════════════════════════════════
  if (activeTab === 'delivery') {
    const [sheet, confirmations] = await Promise.all([
      deliverySiteSheet(selected.id),
      prisma.deliveryConfirmation.findMany({
        where: { cycleId: selected.id },
        select: {
          deliverySiteId: true,
          serviceDate: true,
          receivedAt: true,
          note: true,
          receivedBy: { select: { name: true } },
        },
      }),
    ]);

    const confirmedMap = new Map(
      confirmations
        .filter((c) => c.receivedAt !== null)
        .map((c) => [`${c.deliverySiteId}|${toDateKey(c.serviceDate)}`, c]),
    );

    const totalSiteDays = sheet.length;
    const confirmedCount = sheet.filter(
      (r) => confirmedMap.has(`${r.deliverySiteId}|${toDateKey(r.serviceDate)}`),
    ).length;
    const pendingCount = totalSiteDays - confirmedCount;

    // Group by site
    const bySite = new Map<string, { siteName: string; rows: typeof sheet }>();
    for (const row of sheet) {
      const existing = bySite.get(row.deliverySiteId);
      if (existing) existing.rows.push(row);
      else bySite.set(row.deliverySiteId, { siteName: row.deliverySiteName, rows: [row] });
    }

    return (
      <>
        {header}
        {tabBar}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat label="Total Site-Days" value={totalSiteDays} />
          <Stat label="Confirmed" value={confirmedCount} tone={confirmedCount === totalSiteDays && totalSiteDays > 0 ? 'positive' : 'default'} />
          <Stat label="Pending" value={pendingCount} tone={pendingCount > 0 ? 'warning' : 'default'} />
        </div>

        {sheet.length === 0 ? (
          <EmptyState title="No paid orders for this week yet" hint="Orders need to be paid before they appear here." />
        ) : (
          <div className="grid gap-6">
            {[...bySite.values()].map(({ siteName, rows }) => {
              const siteConfirmed = rows.filter(
                (r) => confirmedMap.has(`${r.deliverySiteId}|${toDateKey(r.serviceDate)}`),
              ).length;

              return (
                <Section
                  key={siteName}
                  title={siteName}
                  description={`${siteConfirmed} of ${rows.length} days confirmed`}
                >
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Service Date</th>
                          <th>Restaurants</th>
                          <th className="num">Meals</th>
                          <th className="num">Orders</th>
                          <th>Status</th>
                          <th>Confirmed By</th>
                          <th>Confirmed At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const key = `${r.deliverySiteId}|${toDateKey(r.serviceDate)}`;
                          const conf = confirmedMap.get(key);
                          return (
                            <tr key={key}>
                              <td className="whitespace-nowrap font-medium text-slate-900">
                                {formatDate(r.serviceDate, 'weekday', locale)} · {formatDate(r.serviceDate, 'long', locale)}
                              </td>
                              <td className="text-xs text-slate-600">
                                {r.restaurants.map((rr) => (
                                  <div key={rr.restaurantName} className="whitespace-nowrap">
                                    {rr.restaurantName}{' '}
                                    <span className="text-slate-400">×{rr.quantity}</span>
                                  </div>
                                ))}
                              </td>
                              <td className="num text-slate-700">{r.mealCount}</td>
                              <td className="num text-slate-700">{r.orderCount}</td>
                              <td>
                                {conf ? (
                                  <span className="badge bg-emerald-100 text-emerald-800">Confirmed</span>
                                ) : (
                                  <span className="badge bg-amber-100 text-amber-800">Pending</span>
                                )}
                              </td>
                              <td className="text-sm text-slate-600">
                                {conf?.receivedBy?.name ?? '—'}
                              </td>
                              <td className="text-xs text-slate-500 whitespace-nowrap">
                                {conf?.receivedAt ? formatDateTime(conf.receivedAt, locale) : '—'}
                              </td>
                            </tr>
                          );
                        })}
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

  // ════════════════════════════════════════════════════════════════════════
  // TAB 2 — Employee Meal Receipt
  // Shows: did each employee confirm they personally received their meal?
  // ════════════════════════════════════════════════════════════════════════

  // Fetch all PAID order items for this cycle with receipt status + employee info
  const orderItems = await prisma.orderItem.findMany({
    where: {
      order: { cycleId: selected.id, status: 'PAID' },
    },
    select: {
      serviceDate: true,
      dishName: true,
      restaurantName: true,
      receivedAt: true,
      order: {
        select: {
          user: { select: { name: true, staffId: true, department: true } },
          deliverySite: { select: { name: true } },
        },
      },
    },
    orderBy: [{ serviceDate: 'asc' }, { order: { user: { name: 'asc' } } }],
  });

  // Summary stats
  const totalItems = orderItems.length;
  const confirmedItems = orderItems.filter((i) => i.receivedAt !== null).length;
  const pendingItems = totalItems - confirmedItems;

  // Group by service date for the table sections
  const byDate = new Map<string, typeof orderItems>();
  for (const item of orderItems) {
    const key = toDateKey(item.serviceDate);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(item);
    else byDate.set(key, [item]);
  }

  return (
    <>
      {header}
      {tabBar}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Total Meals" value={totalItems} />
        <Stat label="Confirmed" value={confirmedItems} tone={confirmedItems === totalItems && totalItems > 0 ? 'positive' : 'default'} />
        <Stat label="Pending" value={pendingItems} tone={pendingItems > 0 ? 'warning' : 'default'} />
      </div>

      {orderItems.length === 0 ? (
        <EmptyState title="No paid orders for this week yet" hint="Orders need to be paid before they appear here." />
      ) : (
        <div className="grid gap-6">
          {[...byDate.entries()].map(([dateKey, items]) => {
            const dayConfirmed = items.filter((i) => i.receivedAt !== null).length;
            const [year, month, day] = dateKey.split('-').map(Number);
            const dateObj = new Date(Date.UTC(year, month - 1, day));

            return (
              <Section
                key={dateKey}
                title={`${formatDate(dateObj, 'weekday', locale)} · ${formatDate(dateObj, 'long', locale)}`}
                description={`${dayConfirmed} of ${items.length} confirmed`}
              >
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Delivery Site</th>
                        <th>Dish</th>
                        <th>Status</th>
                        <th>Confirmed At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="font-medium text-slate-900">
                            {item.order.user.name}
                            {item.order.user.staffId ? (
                              <span className="ml-1.5 font-mono text-xs text-slate-400">
                                {item.order.user.staffId}
                              </span>
                            ) : null}
                          </td>
                          <td className="text-slate-600">{item.order.user.department ?? '—'}</td>
                          <td className="text-slate-600">{item.order.deliverySite?.name ?? '—'}</td>
                          <td className="text-slate-700">{item.dishName}</td>
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
