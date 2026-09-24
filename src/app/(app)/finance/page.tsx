import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatDateTime, formatWeekRange, toDateKey } from '@/lib/cycle';
import { departmentBreakdown, trailingWeeks, weeklyTotals } from '@/lib/reporting';
import { hitpayConfigured } from '@/lib/hitpay';
import { PageHeader, Section, Stat, StatusBadge, Alert, EmptyState } from '@/components/ui';
import { Pagination, parsePage, parsePageSize } from '@/components/pagination';

export const dynamic = 'force-dynamic';

const RANGES = [4, 8, 12, 26] as const;
const RECON_PAGE_SIZE = 25;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string; tab?: string; page?: string }>;
}) {
  const user = await requireCapability('finance:view');
  const params = await searchParams;
  const t = await getTranslations('financeAdmin');
  const locale = await getLocale();

  const activeTab = params.tab === 'reconciliation' ? 'reconciliation' : 'summary';

  const requested = Number.parseInt(params.weeks ?? '', 10);
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 12;
  const window = trailingWeeks(weeks);

  const exportable = can(user.role, 'finance:export');

  // ── Tab bar ────────────────────────────────────────────────────────────
  const tabBar = (
    <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
      <a
        href={`?weeks=${weeks}&tab=summary`}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === 'summary'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Summary
      </a>
      <a
        href={`?weeks=${weeks}&tab=reconciliation`}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === 'reconciliation'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Order &amp; Payment Matching
      </a>
    </div>
  );

  const rangeSwitcher = (
    <form method="get" className="flex items-center gap-2">
      <input type="hidden" name="tab" value={activeTab} />
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

  const header = (
    <PageHeader title={t('title')} subtitle={t('subtitle', { weeks })} action={rangeSwitcher} />
  );

  // ════════════════════════════════════════════════════════════════════════
  // TAB 1 — Summary (existing view, unchanged)
  // ════════════════════════════════════════════════════════════════════════
  if (activeTab === 'summary') {
    const [weekly, departments, pending, recentPayments, failedCount, unmatchedCount] =
      await Promise.all([
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
        // Unmatched webhooks — need manual reconciliation
        prisma.auditLog.count({ where: { action: 'payment.webhook_unmatched' } }),
      ]);

    const gross = weekly.reduce((s, w) => s + w.grossSen, 0);
    const subsidy = weekly.reduce((s, w) => s + w.subsidySen, 0);
    const net = weekly.reduce((s, w) => s + w.netSen, 0);
    const orders = weekly.reduce((s, w) => s + w.orders, 0);

    return (
      <>
        {header}
        {tabBar}

        <div className="mb-6 space-y-3">
          {!hitpayConfigured() ? (
            <Alert tone="warning">
              {t('hitpayNotConfigured', { apiKey: 'HITPAY_API_KEY', salt: 'HITPAY_SALT' })}
            </Alert>
          ) : null}
          {unmatchedCount > 0 ? (
            <Alert tone="warning">
              {unmatchedCount} HitPay webhook{unmatchedCount === 1 ? '' : 's'} could not be
              matched to an order and need manual reconciliation. Check the{' '}
              <a href="?tab=reconciliation" className="underline">
                Order &amp; Payment Matching
              </a>{' '}
              tab for details.
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
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // TAB 2 — Order & Payment Matching (reconciliation)
  //
  // Every PAID / AWAITING_PAYMENT / CANCELLED order in the window, joined
  // with its payment record and employee info. Finance can see at a glance
  // whether HitPay's payment_id matches the order reference, what channel
  // was used, and who the employee is.
  // ════════════════════════════════════════════════════════════════════════

  const page = parsePage(params.page);

  const reconWhere = {
    status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] },
    cycle: { serviceWeekStart: { gte: window.from, lt: window.to } },
  };

  const [reconTotal, reconOrders, unmatchedLogs] = await Promise.all([
    prisma.order.count({ where: reconWhere }),
    prisma.order.findMany({
      where: reconWhere,
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * RECON_PAGE_SIZE,
      take: RECON_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        status: true,
        grossSen: true,
        subsidySen: true,
        netSen: true,
        submittedAt: true,
        paidAt: true,
        cancelReason: true,
        user: {
          select: {
            name: true,
            staffId: true,
            department: true,
            email: true,
          },
        },
        cycle: { select: { serviceWeekStart: true } },
        deliverySite: { select: { name: true } },
        // All payments for this order — usually one, but retries create more
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            amountSen: true,
            paymentId: true,
            requestId: true,
            paymentMethod: true,
            failureReason: true,
            createdAt: true,
          },
        },
        // Item count + meal list summary
        items: {
          select: { dishName: true, quantity: true, serviceDate: true },
          orderBy: { serviceDate: 'asc' },
        },
      },
    }),
    // Unmatched webhook audit logs — HitPay sent a payment we couldn't link
    prisma.auditLog.findMany({
      where: { action: 'payment.webhook_unmatched' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, createdAt: true, metadata: true },
    }),
  ]);

  return (
    <>
      {header}
      {tabBar}

      {unmatchedLogs.length > 0 ? (
        <div className="mb-6">
          <Section
            title="Unmatched HitPay Webhooks"
            description="These payments arrived from HitPay but could not be linked to any order. Manual investigation required."
          >
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Received At</th>
                    <th>HitPay Payment ID</th>
                    <th>HitPay Request ID</th>
                    <th>Reference Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedLogs.map((log) => {
                    const meta = log.metadata as Record<string, string> | null;
                    return (
                      <tr key={log.id}>
                        <td className="text-xs text-slate-500 whitespace-nowrap">
                          {formatDateTime(log.createdAt, locale)}
                        </td>
                        <td className="font-mono text-xs text-slate-700">{meta?.paymentId ?? '—'}</td>
                        <td className="font-mono text-xs text-slate-700">{meta?.requestId ?? '—'}</td>
                        <td className="font-mono text-xs text-slate-700">{meta?.reference ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      ) : null}

      <Section
        title="Order & Payment Matching"
        description={`${reconTotal} orders in the last ${weeks} weeks — showing order reference, employee, meals ordered, and matched HitPay payment.`}
        action={
          exportable ? (
            <a href={`/api/exports/reconciliation?weeks=${weeks}`} className="btn-secondary btn-sm">
              Export CSV
            </a>
          ) : null
        }
      >
        {reconOrders.length === 0 ? (
          <EmptyState title="No orders in this period" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order Ref</th>
                    <th>Service Week</th>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Site</th>
                    <th>Meals Ordered</th>
                    <th className="num">Food Total</th>
                    <th className="num">Subsidy</th>
                    <th className="num">Staff Pays</th>
                    <th>Order Status</th>
                    <th>HitPay Payment ID</th>
                    <th>Payment Method</th>
                    <th className="num">Amount Paid</th>
                    <th>Payment Status</th>
                    <th>Paid At</th>
                  </tr>
                </thead>
                <tbody>
                  {reconOrders.map((o) => {
                    // The latest / most relevant payment — SUCCEEDED first, then
                    // latest by createdAt (which is the default sort).
                    const successPayment = o.payments.find((p) => p.status === 'SUCCEEDED');
                    const latestPayment = successPayment ?? o.payments[0] ?? null;

                    // Mismatch flag: order is PAID but no SUCCEEDED payment found
                    const mismatch = o.status === 'PAID' && !successPayment;

                    // Summarise meals: "Es Teh Manis ×2, Nasi Lemak ×1"
                    const mealSummary = o.items
                      .map((i) => `${i.dishName}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
                      .join(', ');

                    return (
                      <tr key={o.id} className={mismatch ? 'bg-amber-50' : undefined}>
                        <td>
                          <Link
                            href={`/orders/${o.reference}`}
                            className="font-mono text-xs font-medium text-brand-700 hover:underline"
                          >
                            {o.reference}
                          </Link>
                          {mismatch ? (
                            <div className="mt-0.5 text-xs text-amber-700">⚠ No matched payment</div>
                          ) : null}
                        </td>
                        <td className="text-xs text-slate-600 whitespace-nowrap">
                          {formatWeekRange(o.cycle.serviceWeekStart, locale)}
                        </td>
                        <td>
                          <div className="font-medium text-slate-900">{o.user.name}</div>
                          {o.user.staffId ? (
                            <div className="font-mono text-xs text-slate-400">{o.user.staffId}</div>
                          ) : null}
                          {o.user.email ? (
                            <div className="text-xs text-slate-400">{o.user.email}</div>
                          ) : null}
                        </td>
                        <td className="text-slate-600">{o.user.department ?? '—'}</td>
                        <td className="text-slate-600 whitespace-nowrap">
                          {o.deliverySite?.name ?? '—'}
                        </td>
                        <td className="text-xs text-slate-700 max-w-[200px]">
                          <span title={mealSummary} className="line-clamp-2">{mealSummary || '—'}</span>
                        </td>
                        <td className="num text-slate-700">{formatSen(o.grossSen)}</td>
                        <td className="num text-emerald-700">−{formatSen(o.subsidySen)}</td>
                        <td className="num font-medium text-slate-900">{formatSen(o.netSen)}</td>
                        <td><StatusBadge status={o.status} /></td>
                        <td className="font-mono text-xs text-slate-600">
                          {latestPayment?.paymentId ?? '—'}
                        </td>
                        <td className="text-xs text-slate-600 whitespace-nowrap">
                          {latestPayment?.paymentMethod ?? '—'}
                        </td>
                        <td className="num text-slate-900">
                          {latestPayment ? formatSen(latestPayment.amountSen) : '—'}
                        </td>
                        <td>
                          {latestPayment ? (
                            <>
                              <StatusBadge status={latestPayment.status} />
                              {latestPayment.failureReason ? (
                                <div className="mt-0.5 text-xs text-red-600">
                                  {latestPayment.failureReason}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-xs text-slate-400">No payment</span>
                          )}
                        </td>
                        <td className="text-xs text-slate-500 whitespace-nowrap">
                          {o.paidAt ? formatDateTime(o.paidAt, locale) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              basePath="/finance"
              page={page}
              pageSize={RECON_PAGE_SIZE}
              total={reconTotal}
              searchParams={{ tab: 'reconciliation', weeks: String(weeks) }}
            />
          </>
        )}
      </Section>
    </>
  );
}
