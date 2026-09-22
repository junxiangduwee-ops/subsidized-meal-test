import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { cyclePhase, formatDate, formatDateTime, formatWeekRange, toDateKey } from '@/lib/cycle';
import { deliverySiteSheet, receptionSiteRestriction } from '@/lib/delivery';
import { PageHeader, Section, EmptyState, PhaseBadge, Alert, Stat } from '@/components/ui';

import { ConfirmDeliveryForm, DeliveryConfirmedCell } from './delivery-row';

export const dynamic = 'force-dynamic';

export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const user = await requireCapability('delivery:confirm');
  const params = await searchParams;
  const t = await getTranslations('reception');
  const locale = await getLocale();

  // A reception account can be pinned to a single site (Admin -> Users);
  // when it is, every query below is scoped to that site alone, not just
  // hidden in the UI - see receptionSiteRestriction and reception/actions.ts.
  const restriction = await receptionSiteRestriction(user.id);

  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 20,
    select: { id: true, serviceWeekStart: true, status: true, orderOpenAt: true, orderCutoffAt: true },
  });

  if (cycles.length === 0) {
    return (
      <>
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <EmptyState title={t('noPublishedWeeks')} hint={t('noPublishedWeeksHint')} />
      </>
    );
  }

  const selected = cycles.find((c) => c.id === params.cycle) ?? cycles[0];
  const phase = cyclePhase(selected);

  const [sheet, confirmations] = await Promise.all([
    deliverySiteSheet(selected.id, { deliverySiteId: restriction?.id }),
    prisma.deliveryConfirmation.findMany({
      where: { cycleId: selected.id, ...(restriction ? { deliverySiteId: restriction.id } : {}) },
      select: {
        id: true,
        deliverySiteId: true,
        serviceDate: true,
        receivedAt: true,
        photoDataUrl: true,
        note: true,
        receivedBy: { select: { name: true } },
      },
    }),
  ]);

  const confirmedByKey = new Map(
    confirmations.map((c) => [`${c.deliverySiteId}|${toDateKey(c.serviceDate)}`, c]),
  );

  const bySite = new Map<string, typeof sheet>();
  for (const row of sheet) {
    const bucket = bySite.get(row.deliverySiteName);
    if (bucket) bucket.push(row);
    else bySite.set(row.deliverySiteName, [row]);
  }

  const totalSiteDays = sheet.length;
  const confirmedCount = sheet.filter(
    (r) => confirmedByKey.get(`${r.deliverySiteId}|${toDateKey(r.serviceDate)}`)?.receivedAt,
  ).length;
  const pendingCount = totalSiteDays - confirmedCount;
  const allConfirmed = totalSiteDays > 0 && pendingCount === 0;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            <span>{formatWeekRange(selected.serviceWeekStart, locale)}</span>
            {restriction ? (
              <span className="badge bg-slate-100 text-slate-700">
                {t('scopedToSite', { site: restriction.name })}
              </span>
            ) : null}
          </span>
        }
        action={
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
        }
      />

      <p className="mb-6 max-w-2xl text-sm text-slate-500">{t('photoOptionalHint')}</p>

      <div className="mb-6 grid gap-4 text-center sm:grid-cols-3">
        <Stat label={t('totalSiteDays')} value={totalSiteDays.toLocaleString()} />
        <Stat
          label={t('confirmed')}
          value={confirmedCount.toLocaleString()}
          tone={totalSiteDays > 0 && confirmedCount === totalSiteDays ? 'positive' : 'default'}
        />
        <Stat
          label={t('pending')}
          value={pendingCount.toLocaleString()}
          tone={pendingCount > 0 ? 'warning' : 'default'}
        />
      </div>

      {allConfirmed ? (
        <div className="mb-6">
          <Alert tone="success">{t('allConfirmed')}</Alert>
        </div>
      ) : null}

      {sheet.length === 0 ? (
        <EmptyState
          title={t('nothingToReceiveYet')}
          hint={restriction ? t('nothingToReceiveYetHintScoped', { site: restriction.name }) : t('nothingToReceiveYetHint')}
        />
      ) : (
        <div className="grid gap-6">
          {[...bySite.entries()].map(([siteName, rows]) => {
            const siteConfirmed = rows.filter(
              (r) => confirmedByKey.get(`${r.deliverySiteId}|${toDateKey(r.serviceDate)}`)?.receivedAt,
            ).length;

            return (
              <Section
                key={siteName}
                title={siteName}
                description={t('siteProgress', { confirmed: siteConfirmed, total: rows.length })}
              >
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('serviceDate')}</th>
                        <th>{t('restaurants')}</th>
                        <th className="num">{t('expectedMeals')}</th>
                        <th className="num">{t('expectedOrders')}</th>
                        <th>{t('status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const key = `${r.deliverySiteId}|${toDateKey(r.serviceDate)}`;
                        const confirmation = confirmedByKey.get(key);
                        const isConfirmed = Boolean(confirmation?.receivedAt);

                        return (
                          <tr key={key}>
                            <td className="whitespace-nowrap font-medium text-slate-900">
                              {formatDate(r.serviceDate, 'weekday', locale)} ·{' '}
                              {formatDate(r.serviceDate, 'long', locale)}
                            </td>
                            <td className="text-xs text-slate-600">
                              {r.restaurants.map((rr) => (
                                <div key={rr.restaurantName} className="whitespace-nowrap">
                                  {rr.restaurantName}{' '}
                                  <span className="text-slate-400">
                                    {t('mealCountSuffix', { count: rr.quantity })}
                                  </span>
                                </div>
                              ))}
                            </td>
                            <td className="num text-slate-700 text-left">{r.mealCount}</td>
                            <td className="num text-slate-700 text-left">{r.orderCount}</td>
                            <td>
                              {isConfirmed && confirmation ? (
                                <DeliveryConfirmedCell
                                  id={confirmation.id}
                                  receivedAtLabel={formatDateTime(confirmation.receivedAt!, locale)}
                                  receivedByName={confirmation.receivedBy?.name ?? null}
                                  note={confirmation.note}
                                  photoDataUrl={confirmation.photoDataUrl}
                                />
                              ) : (
                                <ConfirmDeliveryForm
                                  cycleId={selected.id}
                                  deliverySiteId={r.deliverySiteId}
                                  serviceDate={toDateKey(r.serviceDate)}
                                />
                              )}
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
