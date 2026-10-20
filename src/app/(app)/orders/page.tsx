import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatWeekRange, formatDateTime, todayInAppTz, toDateKey } from '@/lib/cycle';
import { PageHeader, Section, EmptyState, StatusBadge, Stat } from '@/components/ui';
import { Pagination, parsePage, parsePageSize } from '@/components/pagination';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 25;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; week?: string }>;
}) {
  const user = await requireCapability('order:place');
  const params = await searchParams;
  const t = await getTranslations('orders');
  const locale = await getLocale();
  const page = parsePage(params.page);
  const pageSize = parsePageSize(params.pageSize, DEFAULT_PAGE_SIZE);
  const selectedWeek = params.week;

  const selectedWeekDate = selectedWeek ? new Date(selectedWeek + 'T00:00:00.000Z') : null;

  const where = {
    userId: user.id,
    status: { not: 'CART' as const },
    ...(selectedWeekDate
      ? { cycle: { serviceWeekStart: selectedWeekDate } }
      : {}),
  };

  const allTimeWhere = { userId: user.id, status: { not: 'CART' as const } };

  const availableWeeks = await prisma.menuCycle.findMany({
    where: {
      orders: { some: { userId: user.id, status: { not: 'CART' as const } } },
    },
    select: { serviceWeekStart: true },
    orderBy: { serviceWeekStart: 'desc' },
  });

  const [total, allPaid, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where: { ...allTimeWhere, status: 'PAID' },
      select: { netSen: true, subsidySen: true },
    }),
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        cycle: { select: { serviceWeekStart: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const spent = allPaid.reduce((s, o) => s + o.netSen, 0);
  const showSubsidy = can(user.role, 'finance:view');
  const saved = allPaid.reduce((s, o) => s + o.subsidySen, 0);
  const currentMonth = todayInAppTz().toISOString().slice(0, 7);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        action={
          <Link href="/menu" className="btn-primary">
            {t('orderForNextWeek')}
          </Link>
        }
      />

      <div className={`mb-6 grid gap-4 ${showSubsidy ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <Stat label={t('ordersPlaced')} value={allPaid.length} />
        <Stat label={t('youHavePaid')} value={formatSen(spent)} />
        {showSubsidy ? (
          <Stat label={t('companyCovered')} value={formatSen(saved)} tone="positive" />
        ) : null}
      </div>

      <Section
        title={t('history')}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {availableWeeks.length > 0 && (
              <form method="get" className="flex items-center gap-2">
                <label htmlFor="week-filter" className="text-xs text-slate-500 whitespace-nowrap">
                  Service Week
                </label>
                <select
                  id="week-filter"
                  name="week"
                  defaultValue={selectedWeek ?? ''}
                  className="input !py-1 text-xs"
                >
                  <option value="">All weeks</option>
                  {availableWeeks.map((c) => {
                    const key = toDateKey(c.serviceWeekStart);
                    return (
                      <option key={key} value={key}>
                        {formatWeekRange(c.serviceWeekStart, locale)}
                      </option>
                    );
                  })}
                </select>
                <button type="submit" className="btn-secondary btn-sm">
                  Filter
                </button>
              </form>
            )}
            <form method="get" action="/api/exports/my-orders" className="flex items-center gap-2">
              <label htmlFor="export-month" className="text-xs text-slate-500">
                {t('exportMonthLabel')}
              </label>
              <input
                id="export-month"
                type="month"
                name="month"
                defaultValue={currentMonth}
                max={currentMonth}
                required
                className="input !w-36 !py-1 text-xs"
              />
              <button type="submit" className="btn-secondary btn-sm">
                {t('exportMonth')}
              </button>
            </form>
          </div>
        }
      >
        {orders.length === 0 ? (
          <EmptyState
            title={t('noOrdersYet')}
            hint={selectedWeek ? 'Try selecting a different week or clear the filter.' : t('noOrdersHint')}
            action={
              <Link href="/menu" className="btn-primary">
                {t('browseMenu')}
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('reference')}</th>
                  <th>{t('serviceWeek')}</th>
                  <th className="text-center">{t('meals')}</th>
                  {showSubsidy ? <th className="num">{t('foodTotal')}</th> : null}
                  {showSubsidy ? <th className="num">{t('subsidy')}</th> : null}
                  <th className="num">{t('youPaid')}</th>
                  <th>{t('status')}</th>
                  <th>{t('placed')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-xs text-slate-700">{o.reference}</td>
                    <td className="text-slate-900">{formatWeekRange(o.cycle.serviceWeekStart, locale)}</td>
                    <td className="text-center text-slate-600">{o._count.items}</td>
                    {showSubsidy ? (
                      <td className="num text-slate-600">{formatSen(o.grossSen)}</td>
                    ) : null}
                    {showSubsidy ? (
                      <td className="num text-emerald-700">−{formatSen(o.subsidySen)}</td>
                    ) : null}
                    <td className="num font-medium text-slate-900">{formatSen(o.netSen)}</td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="text-xs text-slate-500">
                      {o.submittedAt ? formatDateTime(o.submittedAt, locale) : '—'}
                    </td>
                    <td>
                      <div className="flex justify-end">
                        <Link href={`/orders/${o.reference}`} className="btn-secondary btn-sm">
                          {t('view')}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination basePath="/orders" page={page} pageSize={pageSize} total={total} />
          </div>
        )}
      </Section>
    </>
  );
}
