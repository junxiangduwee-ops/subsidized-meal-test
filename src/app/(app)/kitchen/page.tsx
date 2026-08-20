import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { cyclePhase, formatDate, formatWeekRange, toDateKey } from '@/lib/cycle';
import { kitchenSheet } from '@/lib/reporting';
import { PageHeader, Section, EmptyState, PhaseBadge, Alert, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  await requireCapability('kitchen:view');
  const params = await searchParams;
  const t = await getTranslations('kitchenAdmin');
  const locale = await getLocale();

  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
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
                      </tr>
                    </thead>
                    <tbody>
                      {[...byDate.entries()].map(([dateKey, dayRows]) =>
                        dayRows.map((r, i) => (
                          <tr key={`${dateKey}-${r.dishName}-${r.deliverySiteName}`}>
                            <td className={i === 0 ? 'font-medium text-slate-900' : 'text-slate-400'}>
                              {i === 0
                                ? `${formatDate(r.serviceDate, 'weekday', locale)} · ${formatDate(r.serviceDate, 'long', locale)}`
                                : ''}
                            </td>
                            <td className="text-slate-700">{r.dishName}</td>
                            <td className="text-slate-600">{r.deliverySiteName}</td>
                            <td className="num font-medium text-slate-900 text-left">{r.quantity}</td>
                          </tr>
                        )),
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
