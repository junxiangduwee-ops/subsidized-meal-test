import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatWeekRange, formatDateTime } from '@/lib/cycle';
import { PageHeader, Section, EmptyState, StatusBadge, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const user = await requireCapability('order:place');
  const t = await getTranslations('orders');
  const locale = await getLocale();

  const orders = await prisma.order.findMany({
    where: { userId: user.id, status: { not: 'CART' } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      cycle: { select: { serviceWeekStart: true } },
      _count: { select: { items: true } },
    },
  });

  const paid = orders.filter((o) => o.status === 'PAID');
  const spent = paid.reduce((s, o) => s + o.netSen, 0);

  // The company's contribution is not the employee's business - only roles
  // that already have finance access see it.
  const showSubsidy = can(user.role, 'finance:view');
  const saved = paid.reduce((s, o) => s + o.subsidySen, 0);

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
        <Stat label={t('ordersPlaced')} value={paid.length} />
        <Stat label={t('youHavePaid')} value={formatSen(spent)} />
        {showSubsidy ? (
          <Stat label={t('companyCovered')} value={formatSen(saved)} tone="positive" />
        ) : null}
      </div>

      <Section title={t('history')}>
        {orders.length === 0 ? (
          <EmptyState
            title={t('noOrdersYet')}
            hint={t('noOrdersHint')}
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
                  <th className="num">{t('meals')}</th>
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
                    <td className="num text-slate-600">{o._count.items}</td>
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
          </div>
        )}
      </Section>
    </>
  );
}
