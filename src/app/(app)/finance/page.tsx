import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatDateTime, formatWeekRange } from '@/lib/cycle';
import { departmentBreakdown, trailingWeeks, weeklyTotals } from '@/lib/reporting';
import { hitpayConfigured } from '@/lib/hitpay';
import { PageHeader, Section, Stat, StatusBadge, Alert, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const RANGES = [4, 8, 12, 26] as const;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const user = await requireCapability('finance:view');
  const params = await searchParams;
  const t = await getTranslations('financeAdmin');
  const locale = await getLocale();

  const requested = Number.parseInt(params.weeks ?? '', 10);
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 12;
  const window = trailingWeeks(weeks);

  const [weekly, departments, pending, recentPayments, failedCount] = await Promise.all([
    weeklyTotals(window, locale),
    departmentBreakdown(window),
    prisma.order.aggregate({
      where: { status: 'AWAITING_PAYMENT' },
      _count: { _all: true },
      _sum: { netSen: true },
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: {
        order: {
          select: {
            reference: true,
            user: { select: { name: true, staffId: true } },
            cycle: { select: { serviceWeekStart: true } },
          },
        },
      },
    }),
    prisma.payment.count({ where: { status: 'FAILED' } }),
  ]);

  const gross = weekly.reduce((s, w) => s + w.grossSen, 0);
  const subsidy = weekly.reduce((s, w) => s + w.subsidySen, 0);
  const net = weekly.reduce((s, w) => s + w.netSen, 0);
  const orders = weekly.reduce((s, w) => s + w.orders, 0);

  const exportable = can(user.role, 'finance:export');
  const latestCycle = weekly.length ? weekly[weekly.length - 1] : null;

  const rangeSwitcher = (
    <form method="get" className="flex items-center gap-2">
      <select name="weeks" defaultValue={String(weeks)} className="input !w-32 !py-1 text-xs">
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {t('lastNWeeks', { count: r })}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-secondary btn-sm">
        {t('apply')}
      </button>
    </form>
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { weeks })} action={rangeSwitcher} />

      <div className="mb-6 space-y-3">
        {!hitpayConfigured() ? (
          <Alert tone="warning">
            {t('hitpayNotConfigured', { apiKey: 'HITPAY_API_KEY', salt: 'HITPAY_SALT' })}
          </Alert>
        ) : null}

        {exportable ? <Alert tone="info">{t('exportWarning')}</Alert> : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('foodValue')} value={formatSen(gross)} hint={t('paidOrdersHint', { count: orders })} />
        <Stat
          label={t('companySubsidyCost')}
          value={formatSen(subsidy)}
          tone="positive"
          hint={gross ? t('percentOfFoodValue', { percent: Math.round((subsidy / gross) * 100) }) : undefined}
        />
        <Stat label={t('collectedFromStaff')} value={formatSen(net)} hint={t('viaHitpay')} />
        <Stat
          label={t('awaitingPayment')}
          value={formatSen(pending._sum.netSen ?? 0)}
          tone={pending._count._all > 0 ? 'warning' : 'default'}
          hint={t('ordersNotSettled', { count: pending._count._all })}
        />
      </div>

      {weekly.length === 0 ? (
        <EmptyState title={t('noWeeksInRange')} hint={t('tryLongerRange')} />
      ) : (
        <div className="grid gap-6">
          <Section
            title={t('byServiceWeek')}
            description={t('paidOrdersOnly')}
            action={
              exportable ? (
                <a href={`/api/exports/subsidy?weeks=${weeks}`} className="btn-secondary btn-sm">
                  {t('exportSummaryCsv')}
                </a>
              ) : null
            }
          >
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('serviceWeek')}</th>
                    <th>{t('status')}</th>
                    <th className="num">{t('orders')}</th>
                    <th className="num">{t('meals')}</th>
                    <th className="num">{t('foodValue')}</th>
                    <th className="num">{t('companyPays')}</th>
                    <th className="num">{t('staffPays')}</th>
                    <th className="num">{t('subsidyPercent')}</th>
                    {exportable ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {[...weekly].reverse().map((w) => (
                    <tr key={w.cycleId}>
                      <td className="font-medium text-slate-900">{w.label}</td>
                      <td className="text-xs text-slate-500">{w.status}</td>
                      <td className="num text-slate-600 text-left">{w.orders}</td>
                      <td className="num text-slate-600 text-left">{w.meals}</td>
                      <td className="num text-slate-900 text-left">{formatSen(w.grossSen)}</td>
                      <td className="num text-emerald-700 text-left">{formatSen(w.subsidySen)}</td>
                      <td className="num text-slate-900 text-left">{formatSen(w.netSen)}</td>
                      <td className="num text-slate-600 text-left">
                        {w.grossSen ? `${Math.round((w.subsidySen / w.grossSen) * 100)}%` : '—'}
                      </td>
                      {exportable ? (
                        <td>
                          <div className="flex justify-end gap-1.5">
                            <a href={`/api/exports/orders?cycle=${w.cycleId}`} className="btn-secondary btn-sm">
                              {t('ordersColumn')}
                            </a>
                            <a href={`/api/exports/payments?cycle=${w.cycleId}`} className="btn-secondary btn-sm">
                              {t('paymentsColumn')}
                            </a>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title={t('subsidyByDepartment')} description={t('subsidyByDepartmentDesc')}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('department')}</th>
                      <th className="num">{t('people')}</th>
                      <th className="num">{t('orders')}</th>
                      <th className="num">{t('companyPays')}</th>
                      <th className="num">{t('staffPays')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.department}>
                        <td className="font-medium text-slate-900">{d.department}</td>
                        <td className="num text-slate-600 text-left">{d.people}</td>
                        <td className="num text-slate-600 text-left">{d.orders}</td>
                        <td className="num text-emerald-700 text-left">{formatSen(d.subsidySen)}</td>
                        <td className="num text-slate-900 text-left">{formatSen(d.netSen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section
              title={t('recentActivity')}
              description={failedCount > 0 ? t('failedAttempts', { count: failedCount }) : t('last15Transactions')}
              action={
                exportable ? (
                  <a href="/api/exports/payments" className="btn-secondary btn-sm">
                    {t('exportAll')}
                  </a>
                ) : null
              }
            >
              {recentPayments.length === 0 ? (
                <EmptyState title={t('noPaymentsYet')} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('reference')}</th>
                        <th>{t('employee')}</th>
                        <th className="num">{t('amount')}</th>
                        <th>{t('status')}</th>
                        <th>{t('when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPayments.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link
                              href={`/orders/${p.order.reference}`}
                              className="font-mono text-xs text-slate-700 hover:text-brand-700"
                            >
                              {p.order.reference}
                            </Link>
                            <div className="text-xs text-slate-400">
                              {formatWeekRange(p.order.cycle.serviceWeekStart, locale)}
                            </div>
                          </td>
                          <td className="text-slate-700">
                            {p.order.user.name}
                            {p.order.user.staffId ? (
                              <div className="text-xs text-slate-400">{p.order.user.staffId}</div>
                            ) : null}
                          </td>
                          <td className="num text-slate-900 text-left">{formatSen(p.amountSen)}</td>
                          <td>
                            <StatusBadge status={p.status} />
                            {p.failureReason ? (
                              <div className="mt-0.5 text-xs text-red-600">{p.failureReason}</div>
                            ) : null}
                          </td>
                          <td className="text-xs text-slate-500">{formatDateTime(p.createdAt, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        </div>
      )}

      {latestCycle && exportable ? (
        <p className="mt-6 text-xs text-slate-500">{t('tip')}</p>
      ) : null}
    </>
  );
}
