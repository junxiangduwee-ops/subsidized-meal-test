import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { cyclePhase, formatDate, formatWeekRange, toDateKey } from '@/lib/cycle';
import { kitchenSheet } from '@/lib/reporting';
import { PageHeader, Section, EmptyState, PhaseBadge, Alert, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

type SearchParams = { cycle?: string; expand?: string };

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireCapability('kitchen:view');
  const params = await searchParams;
  const t = await getTranslations('kitchenAdmin');
  const locale = await getLocale();

  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] as const } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 20,
    select: { id: true, serviceWeekStart: true, status: true, orderOpenAt: true, orderCutoffAt: true },
  });

  if (cycles.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} />
        <EmptyState title={t('noPublishedWeeks')} hint={t('noPublishedWeeksHint')} />
      </>
    );
  }

  const selected = cycles.find((c) => c.id === params.cycle) ?? cycles[0];
  const phase = cyclePhase(selected);
  const sheet = await kitchenSheet(selected.id);

  // The currently expanded row key — format: "restaurant|dateKey|dish|site"
  const expandKey = params.expand ?? null;

  // If a row is expanded, fetch the employees who ordered that specific dish
  let expandedEmployees: {
    name: string;
    staffId: string | null;
    department: string | null;
    deliverySiteName: string;
  }[] = [];

  if (expandKey) {
    const [restaurant, dateKey, dish, site] = expandKey.split('|');
    if (restaurant && dateKey && dish && site) {
      const [year, month, day] = dateKey.split('-').map(Number);
      const serviceDate = new Date(Date.UTC(year, month - 1, day));

      const items = await prisma.orderItem.findMany({
        where: {
          restaurantName: restaurant,
          dishName: dish,
          serviceDate,
          order: {
            status: 'PAID',
            cycleId: selected.id,
            deliverySite: { name: site === 'Unassigned' ? undefined : site },
          },
        },
        select: {
          order: {
            select: {
              user: { select: { name: true, staffId: true, department: true } },
              deliverySite: { select: { name: true } },
            },
          },
        },
        orderBy: { order: { user: { name: 'asc' } } },
      });

      expandedEmployees = items.map((i) => ({
        name: i.order.user.name,
        staffId: i.order.user.staffId,
        department: i.order.user.department,
        deliverySiteName: i.order.deliverySite?.name ?? 'Unassigned',
      }));
    }
  }

  // Helper: build URL that toggles a row open/closed
  function expandUrl(restaurant: string, dateKey: string, dish: string, site: string) {
    const key = `${restaurant}|${dateKey}|${dish}|${site}`;
    const qs = new URLSearchParams({ cycle: selected.id });
    if (expandKey !== key) qs.set('expand', key); // open; omit to close
    return `/kitchen?${qs.toString()}`;
  }

  const byRestaurant = new Map<string, typeof sheet>();
  for (const row of sheet) {
    const bucket = byRestaurant.get(row.restaurantName);
    if (bucket) bucket.push(row);
    else byRestaurant.set(row.restaurantName, [row]);
  }

  const totalPortions = sheet.reduce((s, r) => s + r.quantity, 0);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            <span>{formatWeekRange(selected.serviceWeekStart, locale)}</span>
          </span>
        }
        action={
          <div className="flex items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <select name="cycle" defaultValue={selected.id} className="input !w-56 !py-1 text-xs">
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatWeekRange(c.serviceWeekStart, locale)}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary btn-sm">
                {t('show')}
              </button>
            </form>
            <a href={`/api/exports/kitchen?cycle=${selected.id}`} className="btn-secondary btn-sm">
              {t('exportCsv')}
            </a>
            <a href={`/api/exports/kitchen-employees?cycle=${selected.id}`} className="btn-secondary btn-sm">
              Per-employee CSV
            </a>
          </div>
        }
      />

      {phase === 'OPEN' ? (
        <div className="mb-6">
          <Alert tone="warning">{t('stillOpenWarning')}</Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 text-center sm:grid-cols-3">
        <Stat label={t('totalPortions')} value={totalPortions.toLocaleString()} />
        <Stat label={t('restaurants')} value={byRestaurant.size} />
        <Stat label={t('distinctDishes')} value={new Set(sheet.map((r) => r.dishName)).size} />
      </div>

      {sheet.length === 0 ? (
        <EmptyState title={t('nothingOrderedYet')} />
      ) : (
        <div className="grid gap-6">
          {[...byRestaurant.entries()].map(([restaurant, rows]) => {
            const byDate = new Map<string, typeof rows>();
            for (const r of rows) {
              const key = toDateKey(r.serviceDate);
              const bucket = byDate.get(key);
              if (bucket) bucket.push(r);
              else byDate.set(key, [r]);
            }
            const restaurantTotal = rows.reduce((s, r) => s + r.quantity, 0);

            return (
              <Section
                key={restaurant}
                title={restaurant}
                description={t('portionsAcrossWeek', { count: restaurantTotal })}
              >
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('serviceDate')}</th>
                        <th>{t('dish')}</th>
                        <th>{t('deliverySite')}</th>
                        <th className="num">{t('portions')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {[...byDate.entries()].map(([dateKey, dayRows]) =>
                        dayRows.map((r, i) => {
                          const rowKey = `${restaurant}|${dateKey}|${r.dishName}|${r.deliverySiteName}`;
                          const isExpanded = expandKey === rowKey;

                          return (
                            <>
                              <tr
                                key={rowKey}
                                className={isExpanded ? 'bg-brand-50' : 'hover:bg-slate-50'}
                              >
                                <td className={i === 0 ? 'font-medium text-slate-900' : 'text-slate-400'}>
                                  {i === 0
                                    ? `${formatDate(r.serviceDate, 'weekday', locale)} · ${formatDate(r.serviceDate, 'long', locale)}`
                                    : ''}
                                </td>
                                <td className="text-slate-700">{r.dishName}</td>
                                <td className="text-slate-600">{r.deliverySiteName}</td>
                                <td className="num font-medium text-slate-900 text-left">{r.quantity}</td>
                                <td className="text-right">
                                  <Link
                                    href={expandUrl(restaurant, dateKey, r.dishName, r.deliverySiteName)}
                                    className="text-xs text-brand-600 hover:underline whitespace-nowrap"
                                  >
                                    {isExpanded ? '▲ Hide' : '▼ Who ordered'}
                                  </Link>
                                </td>
                              </tr>

                              {/* Expanded employee list — only renders for the active row */}
                              {isExpanded ? (
                                <tr key={`${rowKey}-expanded`} className="bg-brand-50">
                                  <td colSpan={5} className="px-6 pb-4 pt-0">
                                    {expandedEmployees.length === 0 ? (
                                      <p className="text-xs text-slate-400">No employees found.</p>
                                    ) : (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-brand-100 text-slate-500">
                                            <th className="py-1.5 text-left font-medium">#</th>
                                            <th className="py-1.5 text-left font-medium">Name</th>
                                            <th className="py-1.5 text-left font-medium">Staff ID</th>
                                            <th className="py-1.5 text-left font-medium">Department</th>
                                            <th className="py-1.5 text-left font-medium">Delivery Site</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-brand-100">
                                          {expandedEmployees.map((emp, idx) => (
                                            <tr key={idx} className="text-slate-700">
                                              <td className="py-1.5 text-slate-400">{idx + 1}</td>
                                              <td className="py-1.5 font-medium">{emp.name}</td>
                                              <td className="py-1.5 font-mono text-slate-500">
                                                {emp.staffId ?? '—'}
                                              </td>
                                              <td className="py-1.5 text-slate-500">
                                                {emp.department ?? '—'}
                                              </td>
                                              <td className="py-1.5 text-slate-500">
                                                {emp.deliverySiteName}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </td>
                                </tr>
                              ) : null}
                            </>
                          );
                        }),
                      )}
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
