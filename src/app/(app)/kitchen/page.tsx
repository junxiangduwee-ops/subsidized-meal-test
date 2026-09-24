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

  const expandKey = params.expand ?? null;

  // Fetch employees for the expanded row
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
            ...(site === 'Unassigned'
              ? { deliverySiteId: null }
              : { deliverySite: { name: site } }),
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

  function expandUrl(restaurant: string, dateKey: string, dish: string, site: string) {
    const key = `${restaurant}|${dateKey}|${dish}|${site}`;
    const qs = new URLSearchParams({ cycle: selected.id });
    if (expandKey !== key) qs.set('expand', key);
    return `/kitchen?${qs.toString()}`;
  }

  const byRestaurant = new Map<string, typeof sheet>();
  for (const row of sheet) {
    const bucket = byRestaurant.get(row.restaurantName);
    if (bucket) bucket.push(row);
    else byRestaurant.set(row.restaurantName, [row]);
  }

  const totalPortions = sheet.reduce((s, r) => s + r.quantity, 0);

  // Shared cell style: the link fills the entire cell so the whole row is clickable
  const cellLink = 'block w-full h-full';

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
                          const href = expandUrl(restaurant, dateKey, r.dishName, r.deliverySiteName);

                          return (
                            <>
                              {/*
                                Each <td> contains a block-level <Link> that fills
                                the full cell — no text is underlined, no row is
                                highlighted, but every part of the row is clickable.
                              */}
                              <tr key={rowKey} className="cursor-pointer">
                                <td className="p-0">
                                  <Link href={href} className={`${cellLink} px-4 py-3 ${i === 0 ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
                                    {i === 0
                                      ? `${formatDate(r.serviceDate, 'weekday', locale)} · ${formatDate(r.serviceDate, 'long', locale)}`
                                      : ''}
                                  </Link>
                                </td>
                                <td className="p-0">
                                  <Link href={href} className={`${cellLink} px-4 py-3 text-slate-700`}>
                                    {r.dishName}
                                  </Link>
                                </td>
                                <td className="p-0">
                                  <Link href={href} className={`${cellLink} px-4 py-3 text-slate-600`}>
                                    {r.deliverySiteName}
                                  </Link>
                                </td>
                                <td className="p-0">
                                  <Link href={href} className={`${cellLink} px-4 py-3 font-medium text-slate-900 text-right`}>
                                    {r.quantity}
                                  </Link>
                                </td>
                                <td className="p-0">
                                  <Link href={href} className={`${cellLink} px-4 py-3 text-slate-400 text-xs text-right`}>
                                    {isExpanded ? '▲' : '▼'}
                                  </Link>
                                </td>
                              </tr>

                              {/* Expanded employee sub-table */}
                              {isExpanded ? (
                                <tr key={`${rowKey}-expanded`}>
                                  <td colSpan={5} className="border-t-0 bg-slate-50 px-6 pb-4 pt-2">
                                    {expandedEmployees.length === 0 ? (
                                      <p className="text-xs text-slate-400">No employees found.</p>
                                    ) : (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-slate-200 text-slate-500">
                                            <th className="py-1.5 text-left font-medium">#</th>
                                            <th className="py-1.5 text-left font-medium">Name</th>
                                            <th className="py-1.5 text-left font-medium">Staff ID</th>
                                            <th className="py-1.5 text-left font-medium">Department</th>
                                            <th className="py-1.5 text-left font-medium">Delivery Site</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                          {expandedEmployees.map((emp, idx) => (
                                            <tr key={idx}>
                                              <td className="py-1.5 text-slate-400">{idx + 1}</td>
                                              <td className="py-1.5 font-medium text-slate-900">{emp.name}</td>
                                              <td className="py-1.5 font-mono text-slate-500">{emp.staffId ?? '—'}</td>
                                              <td className="py-1.5 text-slate-500">{emp.department ?? '—'}</td>
                                              <td className="py-1.5 text-slate-500">{emp.deliverySiteName}</td>
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
