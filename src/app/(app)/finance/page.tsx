import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { InvoiceStatus } from '@prisma/client';

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
  searchParams: Promise<{ weeks?: string; tab?: string; page?: string; cycle?: string; restaurant?: string; status?: string }>;
}) {
  const user = await requireCapability('finance:view');
  const params = await searchParams;
  const t = await getTranslations('financeAdmin');
  const locale = await getLocale();

  const activeTab =
    params.tab === 'reconciliation'
      ? 'reconciliation'
      : params.tab === 'invoices'
      ? 'invoices'
      : 'summary';

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
      <a
        href={`?weeks=${weeks}&tab=invoices`}
        className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
          activeTab === 'invoices'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Vendor Invoices
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
  // TAB 3 — Vendor Invoices (finance read-only view)
  // ════════════════════════════════════════════════════════════════════════

  if (activeTab === 'invoices') {
    const invoicePage = parsePage(params.page);
    const invoicePageSize = parsePageSize(params.page, 25);
    const invCycleId = params.cycle ?? '';
    const invRestaurantId = params.restaurant ?? '';
    const invStatus = params.status ?? '';

    const INVOICE_STATUS_LABEL: Record<string, string> = {
      PENDING: 'Pending', APPROVED: 'Approved', PAID: 'Paid', DISPUTED: 'Disputed',
    };
    const INVOICE_STATUS_BADGE: Record<string, string> = {
      PENDING: 'bg-amber-100 text-amber-800',
      APPROVED: 'bg-emerald-100 text-emerald-800',
      PAID: 'bg-blue-100 text-blue-800',
      DISPUTED: 'bg-red-100 text-red-800',
    };

    const invWhere = {
      ...(invCycleId ? { cycleId: invCycleId } : {}),
      ...(invRestaurantId ? { restaurantId: invRestaurantId } : {}),
      ...(invStatus ? { status: invStatus as InvoiceStatus } : {}),
    };

    const [invCycles, invRestaurants, invTotal, invSummary, invoices] = await Promise.all([
      prisma.menuCycle.findMany({
        where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
        orderBy: { serviceWeekStart: 'desc' },
        take: 26,
        select: { id: true, serviceWeekStart: true },
      }),
      prisma.restaurant.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.vendorInvoice.count({ where: invWhere }),
      prisma.vendorInvoice.groupBy({
        by: ['status'],
        where: invWhere,
        _count: { _all: true },
        _sum: { amountSen: true },
      }),
      prisma.vendorInvoice.findMany({
        where: invWhere,
        orderBy: [{ cycle: { serviceWeekStart: 'desc' } }, { restaurant: { name: 'asc' } }],
        skip: (invoicePage - 1) * 25,
        take: 25,
        include: {
          restaurant: { select: { name: true } },
          cycle: { select: { serviceWeekStart: true } },
          uploadedBy: { select: { name: true } },
          reviewedBy: { select: { name: true } },
        },
      }),
    ]);

    const invTotalAmount = invSummary.reduce((s, g) => s + (g._sum.amountSen ?? 0), 0);
    const pendingAmount = invSummary.find((g) => g.status === 'PENDING')?._sum.amountSen ?? 0;
    const pendingCount = invSummary.find((g) => g.status === 'PENDING')?._count._all ?? 0;
    const approvedAmount = invSummary.find((g) => g.status === 'APPROVED')?._sum.amountSen ?? 0;

    const invFilterParams = {
      tab: 'invoices',
      weeks: String(weeks),
      ...(invCycleId ? { cycle: invCycleId } : {}),
      ...(invRestaurantId ? { restaurant: invRestaurantId } : {}),
      ...(invStatus ? { status: invStatus } : {}),
    };

    return (
      <>
        {header}
        {tabBar}

        {/* Summary strip */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs text-slate-500">Total Invoiced</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatSen(invTotalAmount)}</p>
            <p className="text-xs text-slate-400">{invTotal} invoice{invTotal !== 1 ? 's' : ''}</p>
          </div>
          <div className={`rounded-xl border px-5 py-4 ${pendingCount > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
            <p className="text-xs text-slate-500">Pending Review</p>
            <p className={`mt-1 text-2xl font-semibold ${pendingCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {formatSen(pendingAmount)}
            </p>
            <p className="text-xs text-slate-400">{pendingCount} invoice{pendingCount !== 1 ? 's' : ''} awaiting approval</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-xs text-slate-500">Approved (Pending Payment)</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{formatSen(approvedAmount)}</p>
            <p className="text-xs text-slate-400">
              {invSummary.find((g) => g.status === 'APPROVED')?._count._all ?? 0} approved
            </p>
          </div>
        </div>

        <Section
          title={`${invTotal} Vendor Invoice${invTotal !== 1 ? 's' : ''}`}
          description="Invoices uploaded by admin — review status and cross-reference with order summaries."
          action={
            <form method="get" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value="invoices" />
              <input type="hidden" name="weeks" value={String(weeks)} />
              <select name="cycle" defaultValue={invCycleId} className="input !w-44 !py-1 text-xs">
                <option value="">All weeks</option>
                {invCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatWeekRange(c.serviceWeekStart, locale)}
                  </option>
                ))}
              </select>
              <select name="restaurant" defaultValue={invRestaurantId} className="input !w-40 !py-1 text-xs">
                <option value="">All restaurants</option>
                {invRestaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <select name="status" defaultValue={invStatus} className="input !w-32 !py-1 text-xs">
                <option value="">All statuses</option>
                {Object.entries(INVOICE_STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <button type="submit" className="btn-secondary btn-sm">Filter</button>
              {Object.keys(invFilterParams).length > 3 && (
                <a href="?tab=invoices" className="text-xs text-slate-400 hover:text-slate-600">Clear</a>
              )}
            </form>
          }
        >
          {invoices.length === 0 ? (
            <EmptyState
              title="No invoices found"
              hint="Admin hasn't uploaded any invoices yet, or your filters returned no results."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Restaurant</th>
                      <th>Service Week</th>
                      <th>Invoice No.</th>
                      <th>Invoice Date</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                      <th>File</th>
                      <th>Review Note</th>
                      <th>Reviewed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-medium text-slate-900">{inv.restaurant.name}</td>
                        <td className="whitespace-nowrap text-sm text-slate-600">
                          {formatWeekRange(inv.cycle.serviceWeekStart, locale)}
                        </td>
                        <td className="font-mono text-xs text-slate-700">
                          {inv.invoiceNumber ?? '—'}
                        </td>
                        <td className="text-xs text-slate-600 whitespace-nowrap">
                          {inv.invoiceDate
                            ? new Date(inv.invoiceDate).toLocaleDateString(locale)
                            : '—'}
                        </td>
                        <td className="num font-semibold text-slate-900">{formatSen(inv.amountSen)}</td>
                        <td>
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_BADGE[inv.status] ?? ''}`}>
                            {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                          </span>
                        </td>
                        <td>
                          {inv.fileUrl ? (
                            <a
                              href={inv.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-brand-700 hover:underline"
                            >
                              {inv.fileName ?? 'View'}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="max-w-[200px] text-xs text-slate-500 truncate" title={inv.reviewNote ?? ''}>
                          {inv.reviewNote ?? '—'}
                        </td>
                        <td className="text-xs text-slate-600">
                          {inv.reviewedBy?.name ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                basePath="/finance"
                page={invoicePage}
                pageSize={25}
                total={invTotal}
                searchParams={invFilterParams}
              />
            </>
          )}
        </Section>
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
  const selectedCycleId = params.cycle ?? null;

  // Table filter: if a specific cycle is selected use it, otherwise fall
  // back to the trailing-weeks window. Both the table and the aggregate
  // stats use the same filter so the reconciliation indicator always
  // matches what the table shows.
  const reconWhere = selectedCycleId
    ? {
        status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] },
        cycleId: selectedCycleId,
      }
    : {
        status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] },
        cycle: { serviceWeekStart: { gte: window.from, lt: window.to } },
      };

  // Same filter shape for the aggregate queries (no status filter needed there)
  const reconAggWhere = selectedCycleId
    ? { cycleId: selectedCycleId }
    : { cycle: { serviceWeekStart: { gte: window.from, lt: window.to } } };

  // Cycles for the per-cycle export picker
  const exportCycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] as const } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 26,
    select: { id: true, serviceWeekStart: true },
  });

  const [reconTotal, reconOrders, unmatchedLogs, reconAgg, paymentAgg] = await Promise.all([
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
    // Aggregate: sum of netSen for PAID orders matching current filter
    prisma.order.aggregate({
      where: { status: 'PAID', ...reconAggWhere },
      _sum: { netSen: true },
      _count: { _all: true },
    }),
    // Aggregate: sum of SUCCEEDED payments matching current filter
    prisma.payment.aggregate({
      where: {
        status: 'SUCCEEDED',
        order: reconAggWhere,
      },
      _sum: { amountSen: true },
      _count: { _all: true },
    }),
  ]);

  // Reconciliation indicator
  const totalOrdersSen = reconAgg._sum.netSen ?? 0;
  const totalPaidSen = paymentAgg._sum.amountSen ?? 0;
  const diffSen = totalPaidSen - totalOrdersSen;
  const isReconciled = diffSen === 0;
  const hasOrphanPayments = paymentAgg._count._all > reconAgg._count._all;

  return (
    <>
      {header}
      {tabBar}

      {/* ── Live reconciliation indicator ───────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Reconciliation Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Comparing total PAID order amounts vs total SUCCEEDED HitPay payments
              for the last {weeks} weeks.
            </p>
          </div>
          {isReconciled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Reconciled
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Discrepancy Detected
            </span>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">PAID Orders Total</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatSen(totalOrdersSen)}</p>
            <p className="text-xs text-slate-400">{reconAgg._count._all} orders</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">HitPay Collected</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{formatSen(totalPaidSen)}</p>
            <p className="text-xs text-slate-400">{paymentAgg._count._all} payments</p>
          </div>
          <div className={`rounded-lg px-4 py-3 ${isReconciled ? 'bg-emerald-50' : 'bg-red-50'}`}>
            <p className="text-xs text-slate-500">Difference</p>
            <p className={`mt-1 text-lg font-semibold ${isReconciled ? 'text-emerald-700' : 'text-red-700'}`}>
              {diffSen === 0 ? 'RM 0.00' : `${diffSen > 0 ? '+' : ''}${formatSen(diffSen)}`}
            </p>
            <p className="text-xs text-slate-400">
              {isReconciled ? 'Fully matched' : diffSen > 0 ? 'HitPay collected more' : 'HitPay collected less'}
            </p>
          </div>
          <div className={`rounded-lg px-4 py-3 ${unmatchedLogs.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
            <p className="text-xs text-slate-500">Unmatched Webhooks</p>
            <p className={`mt-1 text-lg font-semibold ${unmatchedLogs.length > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
              {unmatchedLogs.length}
            </p>
            <p className="text-xs text-slate-400">
              {unmatchedLogs.length === 0 ? 'None — all matched' : 'Need investigation'}
            </p>
          </div>
        </div>

        {!isReconciled && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <strong>Action required:</strong> The {diffSen > 0 ? 'excess' : 'shortfall'} of{' '}
            <strong>{formatSen(Math.abs(diffSen))}</strong> needs investigation.
            {diffSen > 0
              ? ' HitPay received more than the order total — check for duplicate payments or unmatched webhooks below.'
              : ' HitPay received less than the order total — check for failed payments or orders marked PAID without a matching HitPay SUCCEEDED record.'}
            {' '}Export the CSV below and cross-reference with your HitPay dashboard.
          </div>
        )}
      </div>
      {/* ─────────────────────────────────────────────────────────────────── */}

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
        description={`${reconTotal} order${reconTotal === 1 ? '' : 's'} — ${selectedCycleId ? `week of ${formatWeekRange(exportCycles.find((c) => c.id === selectedCycleId)?.serviceWeekStart ?? new Date(), locale)}` : `last ${weeks} weeks`}`}
        action={
          <div className="flex items-center gap-2">
            {/* Single filter form — table + export both follow this selection */}
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="reconciliation" />
              <input type="hidden" name="weeks" value={String(weeks)} />
              <select
                name="cycle"
                defaultValue={selectedCycleId ?? ''}
                className="input !w-48 !py-1 text-xs"
              >
                <option value="">Last {weeks} weeks</option>
                {exportCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatWeekRange(c.serviceWeekStart, locale)}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary btn-sm">Filter</button>
            </form>
            {exportable ? (
              <a
                href={
                  selectedCycleId
                    ? `/api/exports/reconciliation?cycle=${selectedCycleId}`
                    : `/api/exports/reconciliation?weeks=${weeks}`
                }
                className="btn-secondary btn-sm"
              >
                Export CSV
              </a>
            ) : null}
          </div>
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
              searchParams={{
                tab: 'reconciliation',
                weeks: String(weeks),
                ...(selectedCycleId ? { cycle: selectedCycleId } : {}),
              }}
            />
          </>
        )}
      </Section>
    </>
  );
}
