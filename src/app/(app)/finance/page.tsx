import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatDate, formatDateTime, formatWeekRange, toDateKey } from '@/lib/cycle';
import { departmentBreakdown, trailingWeeks, weeklyTotals } from '@/lib/reporting';
import { hitpayConfigured } from '@/lib/hitpay';
import { PageHeader, Section, Stat, StatusBadge, Alert, EmptyState } from '@/components/ui';
import { ActionForm } from '@/components/action-form';
import { InlineSubmit } from '@/components/action-form';
import { Pagination, parsePage } from '@/components/pagination';

import { uploadInvoice, approveInvoice, deleteInvoice } from './invoices/actions';

export const dynamic = 'force-dynamic';

const RANGES = [4, 8, 12, 26] as const;
const RECON_PAGE_SIZE = 25;
const LOOKUP_PAGE_SIZE = 20;

type SearchParams = {
  weeks?: string;
  tab?: string;
  page?: string;
  cycle?: string;
  q?: string;
  date?: string;
};

const TABS = ['summary', 'lookup', 'reconciliation', 'invoices'] as const;
type Tab = typeof TABS[number];

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireCapability('finance:view');
  const params = await searchParams;
  const t = await getTranslations('financeAdmin');
  const locale = await getLocale();

  const activeTab: Tab = (TABS as readonly string[]).includes(params.tab ?? '') ? params.tab as Tab : 'summary';

  const requested = Number.parseInt(params.weeks ?? '', 10);
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : 12;
  const window = trailingWeeks(weeks);

  const exportable = can(user.role, 'finance:export');
  const isAdmin    = can(user.role, 'menu:plan');
  const page = parsePage(params.page);
  const selectedCycleId = params.cycle ?? null;

  // ── Shared: cycles list used by multiple tabs ────────────────────────────
  const allCycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] as const } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 52,
    select: { id: true, serviceWeekStart: true, status: true },
  });

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = (
    <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
      {([
        ['summary', 'Summary'],
        ['lookup', 'Order Lookup'],
        ['reconciliation', 'Reconciliation'],
        ['invoices', 'Vendor Invoices'],
      ] as [Tab, string][]).map(([key, label]) => (
        <a
          key={key}
          href={`?weeks=${weeks}&tab=${key}`}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
            activeTab === key
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {label}
        </a>
      ))}
    </div>
  );

  const rangeSwitcher = (
    <form method="get" className="flex items-center gap-2">
      <input type="hidden" name="tab" value={activeTab} />
      <select name="weeks" defaultValue={String(weeks)} className="input !w-32 !py-1 text-xs">
        {RANGES.map((r) => (
          <option key={r} value={r}>{t('lastNWeeks', { count: r })}</option>
        ))}
      </select>
      <button type="submit" className="btn-secondary btn-sm">{t('apply')}</button>
    </form>
  );

  const header = (
    <PageHeader title={t('title')} subtitle={t('subtitle', { weeks })} action={rangeSwitcher} />
  );

  // ════════════════════════════════════════════════════════════════════════
  // TAB 1 — Summary
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
        prisma.auditLog.count({ where: { action: 'payment.webhook_unmatched' } }),
      ]);

    const gross   = weekly.reduce((s, w) => s + w.grossSen, 0);
    const subsidy = weekly.reduce((s, w) => s + w.subsidySen, 0);
    const net     = weekly.reduce((s, w) => s + w.netSen, 0);
    const orders  = weekly.reduce((s, w) => s + w.orders, 0);

    return (
      <>
        {header}
        {tabBar}

        <div className="mb-6 space-y-3">
          {!hitpayConfigured() && (
            <Alert tone="warning">
              {t('hitpayNotConfigured', { apiKey: 'HITPAY_API_KEY', salt: 'HITPAY_SALT' })}
            </Alert>
          )}
          {unmatchedCount > 0 && (
            <Alert tone="warning">
              {unmatchedCount} unmatched HitPay webhook{unmatchedCount === 1 ? '' : 's'} — check the{' '}
              <a href="?tab=reconciliation" className="underline">Reconciliation</a> tab.
            </Alert>
          )}
          {exportable && <Alert tone="info">{t('exportWarning')}</Alert>}
        </div>

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('foodValue')} value={formatSen(gross)} hint={t('paidOrdersHint', { count: orders })} />
          <Stat label={t('companySubsidyCost')} value={formatSen(subsidy)} tone="positive"
            hint={gross ? t('percentOfFoodValue', { percent: Math.round((subsidy / gross) * 100) }) : undefined} />
          <Stat label={t('collectedFromStaff')} value={formatSen(net)} hint={t('viaHitpay')} />
          <Stat label={t('awaitingPayment')} value={formatSen(pending._sum.netSen ?? 0)}
            tone={pending._count._all > 0 ? 'warning' : 'default'}
            hint={t('ordersNotSettled', { count: pending._count._all })} />
        </div>

        {weekly.length === 0 ? (
          <EmptyState title={t('noWeeksInRange')} hint={t('tryLongerRange')} />
        ) : (
          <div className="grid gap-6">
            <Section title={t('byServiceWeek')} description={t('paidOrdersOnly')}
              action={exportable ? (
                <a href={`/api/exports/subsidy?weeks=${weeks}`} className="btn-secondary btn-sm">
                  {t('exportSummaryCsv')}
                </a>
              ) : null}
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
                      {exportable && <th />}
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
                        {exportable && (
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
                        )}
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

              <Section title={t('recentActivity')}
                description={failedCount > 0 ? t('failedAttempts', { count: failedCount }) : t('last15Transactions')}
                action={exportable ? (
                  <a href="/api/exports/payments" className="btn-secondary btn-sm">{t('exportAll')}</a>
                ) : null}
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
                              <Link href={`/orders/${p.order.reference}`}
                                className="font-mono text-xs text-slate-700 hover:text-brand-700">
                                {p.order.reference}
                              </Link>
                              <div className="text-xs text-slate-400">
                                {formatWeekRange(p.order.cycle.serviceWeekStart, locale)}
                              </div>
                            </td>
                            <td className="text-slate-700">
                              {p.order.user.name}
                              {p.order.user.staffId && (
                                <div className="text-xs text-slate-400">{p.order.user.staffId}</div>
                              )}
                            </td>
                            <td className="num text-slate-900 text-left">{formatSen(p.amountSen)}</td>
                            <td>
                              <StatusBadge status={p.status} />
                              {p.failureReason && (
                                <div className="mt-0.5 text-xs text-red-600">{p.failureReason}</div>
                              )}
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
  // TAB 2 — Order Lookup (row-level on demand)
  // ════════════════════════════════════════════════════════════════════════
  if (activeTab === 'lookup') {
    const q    = params.q?.trim() ?? '';
    const date = params.date ?? '';

    // Only query when a filter is provided — on-demand, not routine
    const hasFilter = q.length > 0 || date.length > 0;

    let lookupTotal = 0;
    let lookupItems: {
      id: string;
      serviceDate: Date;
      dishName: string;
      restaurantName: string;
      grossSen: number;
      subsidySen: number;
      netSen: number;
      receivedAt: Date | null;
      order: {
        reference: string;
        status: string;
        user: { name: string; staffId: string | null; department: string | null };
        deliverySite: { name: string } | null;
        cycle: { serviceWeekStart: Date };
      };
    }[] = [];

    if (hasFilter) {
      // Find matching users for the text search
      let userIds: string[] = [];
      if (q) {
        const users = await prisma.user.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { staffId: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        userIds = users.map((u) => u.id);
        if (userIds.length === 0) {
          lookupTotal = 0;
          lookupItems = [];
        }
      }

      const itemWhere = {
        order: {
          status: 'PAID' as const,
          ...(userIds.length > 0 ? { userId: { in: userIds } } : {}),
        },
        ...(date ? { serviceDate: new Date(date + 'T00:00:00.000Z') } : {}),
      };

      if (!q || userIds.length > 0) {
        [lookupTotal, lookupItems] = await Promise.all([
          prisma.orderItem.count({ where: itemWhere }),
          prisma.orderItem.findMany({
            where: itemWhere,
            orderBy: [{ serviceDate: 'desc' }, { order: { user: { name: 'asc' } } }],
            skip: (page - 1) * LOOKUP_PAGE_SIZE,
            take: LOOKUP_PAGE_SIZE,
            select: {
              id: true,
              serviceDate: true,
              dishName: true,
              restaurantName: true,
              grossSen: true,
              subsidySen: true,
              netSen: true,
              receivedAt: true,
              order: {
                select: {
                  reference: true,
                  status: true,
                  user: { select: { name: true, staffId: true, department: true } },
                  deliverySite: { select: { name: true } },
                  cycle: { select: { serviceWeekStart: true } },
                },
              },
            },
          }),
        ]);
      }
    }

    return (
      <>
        {header}
        {tabBar}

        <Section
          title="Order Lookup"
          description="Search by employee name, staff ID, or specific service date. Results show row-level order details on demand."
          action={hasFilter && exportable && lookupTotal > 0 ? (
            <a
              href={`/api/exports/order-lookup?q=${encodeURIComponent(q)}&date=${date}`}
              className="btn-secondary btn-sm"
            >
              Export CSV
            </a>
          ) : null}
        >
          {/* Filter form */}
          <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
            <input type="hidden" name="tab" value="lookup" />
            <div>
              <label className="label">Employee name or staff ID</label>
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="e.g. Ahmad or E001"
                className="input !py-1.5 text-sm w-56"
              />
            </div>
            <div>
              <label className="label">Service date</label>
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="input !py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="label invisible">Go</label>
              <div className="flex items-center gap-2">
                <button type="submit" className="btn-primary btn-sm">Search</button>
                {hasFilter && (
                  <a href="?tab=lookup" className="text-xs text-slate-400 hover:text-slate-600">Clear</a>
                )}
              </div>
            </div>
          </form>

          {!hasFilter ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              Enter a name, staff ID, or date above to look up specific order details.
            </div>
          ) : lookupTotal === 0 ? (
            <EmptyState title="No results" hint="Try a different name, staff ID, or date." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Service Date</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Site</th>
                      <th>Dish</th>
                      <th>Restaurant</th>
                      <th className="num">Food Price</th>
                      <th className="num">Subsidy</th>
                      <th className="num">Staff Pays</th>
                      <th>Receipt</th>
                      <th>Order Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lookupItems.map((item) => (
                      <tr key={item.id}>
                        <td className="whitespace-nowrap text-slate-700">
                          {formatDate(item.serviceDate, 'long', locale)}
                          <div className="text-xs text-slate-400">
                            {formatWeekRange(item.order.cycle.serviceWeekStart, locale)}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium text-slate-900">{item.order.user.name}</div>
                          {item.order.user.staffId && (
                            <div className="font-mono text-xs text-slate-400">{item.order.user.staffId}</div>
                          )}
                        </td>
                        <td className="text-slate-600">{item.order.user.department ?? '—'}</td>
                        <td className="text-slate-600">{item.order.deliverySite?.name ?? '—'}</td>
                        <td className="font-medium text-slate-900">{item.dishName}</td>
                        <td className="text-slate-600">{item.restaurantName}</td>
                        <td className="num text-slate-700">{formatSen(item.grossSen)}</td>
                        <td className="num text-emerald-700">−{formatSen(item.subsidySen)}</td>
                        <td className="num font-medium text-slate-900">{formatSen(item.netSen)}</td>
                        <td>
                          {item.receivedAt ? (
                            <span className="badge bg-emerald-100 text-emerald-800">Confirmed</span>
                          ) : (
                            <span className="badge bg-amber-100 text-amber-800">Pending</span>
                          )}
                        </td>
                        <td>
                          <Link href={`/orders/${item.order.reference}`}
                            className="font-mono text-xs text-brand-700 hover:underline">
                            {item.order.reference}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                basePath="/finance"
                page={page}
                pageSize={LOOKUP_PAGE_SIZE}
                total={lookupTotal}
                searchParams={{ tab: 'lookup', q, date }}
              />
            </>
          )}
        </Section>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // TAB 3 — Reconciliation
  // ════════════════════════════════════════════════════════════════════════
  if (activeTab === 'reconciliation') {
    const reconWhere = selectedCycleId
      ? { status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] }, cycleId: selectedCycleId }
      : { status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] }, cycle: { serviceWeekStart: { gte: window.from, lt: window.to } } };

    const reconAggWhere = selectedCycleId
      ? { cycleId: selectedCycleId }
      : { cycle: { serviceWeekStart: { gte: window.from, lt: window.to } } };

    const [reconTotal, reconOrders, unmatchedLogs, reconAgg, paymentAgg] = await Promise.all([
      prisma.order.count({ where: reconWhere }),
      prisma.order.findMany({
        where: reconWhere,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * RECON_PAGE_SIZE,
        take: RECON_PAGE_SIZE,
        select: {
          id: true, reference: true, status: true,
          grossSen: true, subsidySen: true, netSen: true,
          submittedAt: true, paidAt: true,
          user: { select: { name: true, staffId: true, department: true, email: true } },
          cycle: { select: { serviceWeekStart: true } },
          deliverySite: { select: { name: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, amountSen: true, paymentId: true, requestId: true, paymentMethod: true, failureReason: true, createdAt: true },
          },
          items: { select: { dishName: true, quantity: true, serviceDate: true }, orderBy: { serviceDate: 'asc' } },
        },
      }),
      prisma.auditLog.findMany({
        where: { action: 'payment.webhook_unmatched' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, createdAt: true, metadata: true },
      }),
      prisma.order.aggregate({ where: { status: 'PAID', ...reconAggWhere }, _sum: { netSen: true }, _count: { _all: true } }),
      prisma.payment.aggregate({ where: { status: 'SUCCEEDED', order: reconAggWhere }, _sum: { amountSen: true }, _count: { _all: true } }),
    ]);

    const totalOrdersSen = reconAgg._sum.netSen ?? 0;
    const totalPaidSen   = paymentAgg._sum.amountSen ?? 0;
    const diffSen        = totalPaidSen - totalOrdersSen;
    const isReconciled   = diffSen === 0;

    return (
      <>
        {header}
        {tabBar}

        {/* Reconciliation indicator */}
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Reconciliation Status</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Comparing PAID order amounts vs SUCCEEDED HitPay payments
                {selectedCycleId
                  ? ` for ${formatWeekRange(allCycles.find(c => c.id === selectedCycleId)?.serviceWeekStart ?? new Date(), locale)}`
                  : ` for the last ${weeks} weeks`}.
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
                Discrepancy
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
              <p className="text-xs text-slate-400">{isReconciled ? 'Fully matched' : diffSen > 0 ? 'Over-collected' : 'Under-collected'}</p>
            </div>
            <div className={`rounded-lg px-4 py-3 ${unmatchedLogs.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
              <p className="text-xs text-slate-500">Unmatched Webhooks</p>
              <p className={`mt-1 text-lg font-semibold ${unmatchedLogs.length > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{unmatchedLogs.length}</p>
              <p className="text-xs text-slate-400">{unmatchedLogs.length === 0 ? 'None' : 'Need investigation'}</p>
            </div>
          </div>
          {!isReconciled && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              <strong>Action required:</strong> {diffSen > 0 ? 'Excess' : 'Shortfall'} of{' '}
              <strong>{formatSen(Math.abs(diffSen))}</strong>.{' '}
              {diffSen > 0 ? 'Check for duplicate payments below.' : 'Check for failed payments or unmatched webhooks.'}
            </div>
          )}
        </div>

        {/* Unmatched webhooks */}
        {unmatchedLogs.length > 0 && (
          <div className="mb-6">
            <Section title="Unmatched HitPay Webhooks" description="These payments arrived from HitPay but could not be linked to any order.">
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
                          <td className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(log.createdAt, locale)}</td>
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
        )}

        {/* Order & payment table */}
        <Section
          title="Order & Payment Matching"
          description={selectedCycleId ? `${reconTotal} orders for the selected week` : `${reconTotal} orders — last ${weeks} weeks`}
          action={
            <div className="flex items-center gap-2">
              <form method="get" className="flex items-center gap-2">
                <input type="hidden" name="tab" value="reconciliation" />
                <input type="hidden" name="weeks" value={String(weeks)} />
                <select name="cycle" defaultValue={selectedCycleId ?? ''} className="input !w-48 !py-1 text-xs">
                  <option value="">Last {weeks} weeks</option>
                  {allCycles.map((c) => (
                    <option key={c.id} value={c.id}>{formatWeekRange(c.serviceWeekStart, locale)}</option>
                  ))}
                </select>
                <button type="submit" className="btn-secondary btn-sm">Filter</button>
                {selectedCycleId && (
                  <a href={`?tab=reconciliation&weeks=${weeks}`} className="text-xs text-slate-400 hover:text-slate-600">Clear</a>
                )}
              </form>
              {exportable && (
                <a
                  href={selectedCycleId ? `/api/exports/reconciliation?cycle=${selectedCycleId}` : `/api/exports/reconciliation?weeks=${weeks}`}
                  className="btn-secondary btn-sm"
                >
                  Export CSV
                </a>
              )}
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
                      <th>Meals</th>
                      <th className="num">Food Total</th>
                      <th className="num">Subsidy</th>
                      <th className="num">Staff Pays</th>
                      <th>Order Status</th>
                      <th>HitPay Payment ID</th>
                      <th>Method</th>
                      <th className="num">Paid</th>
                      <th>Payment Status</th>
                      <th>Paid At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconOrders.map((o) => {
                      const successPayment = o.payments.find((p) => p.status === 'SUCCEEDED');
                      const latestPayment  = successPayment ?? o.payments[0] ?? null;
                      const mismatch       = o.status === 'PAID' && !successPayment;
                      const mealSummary    = o.items.map((i) => `${i.dishName}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ');

                      return (
                        <tr key={o.id} className={mismatch ? 'bg-amber-50' : undefined}>
                          <td>
                            <Link href={`/orders/${o.reference}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">
                              {o.reference}
                            </Link>
                            {mismatch && <div className="mt-0.5 text-xs text-amber-700">⚠ No matched payment</div>}
                          </td>
                          <td className="text-xs text-slate-600 whitespace-nowrap">{formatWeekRange(o.cycle.serviceWeekStart, locale)}</td>
                          <td>
                            <div className="font-medium text-slate-900">{o.user.name}</div>
                            {o.user.staffId && <div className="font-mono text-xs text-slate-400">{o.user.staffId}</div>}
                          </td>
                          <td className="text-slate-600">{o.user.department ?? '—'}</td>
                          <td className="text-slate-600 whitespace-nowrap">{o.deliverySite?.name ?? '—'}</td>
                          <td className="text-xs text-slate-700 max-w-[180px]">
                            <span title={mealSummary} className="line-clamp-2">{mealSummary || '—'}</span>
                          </td>
                          <td className="num text-slate-700">{formatSen(o.grossSen)}</td>
                          <td className="num text-emerald-700">−{formatSen(o.subsidySen)}</td>
                          <td className="num font-medium text-slate-900">{formatSen(o.netSen)}</td>
                          <td><StatusBadge status={o.status} /></td>
                          <td className="font-mono text-xs text-slate-600">{latestPayment?.paymentId ?? '—'}</td>
                          <td className="text-xs text-slate-600 whitespace-nowrap">{latestPayment?.paymentMethod ?? '—'}</td>
                          <td className="num text-slate-900">{latestPayment ? formatSen(latestPayment.amountSen) : '—'}</td>
                          <td>
                            {latestPayment ? (
                              <>
                                <StatusBadge status={latestPayment.status} />
                                {latestPayment.failureReason && <div className="mt-0.5 text-xs text-red-600">{latestPayment.failureReason}</div>}
                              </>
                            ) : <span className="text-xs text-slate-400">No payment</span>}
                          </td>
                          <td className="text-xs text-slate-500 whitespace-nowrap">{o.paidAt ? formatDateTime(o.paidAt, locale) : '—'}</td>
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
                searchParams={{ tab: 'reconciliation', weeks: String(weeks), ...(selectedCycleId ? { cycle: selectedCycleId } : {}) }}
              />
            </>
          )}
        </Section>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // TAB 4 — Vendor Invoices
  // ════════════════════════════════════════════════════════════════════════

  const invoiceCycleId = selectedCycleId;

  const [invoices, restaurants] = await Promise.all([
    prisma.vendorInvoice.findMany({
      where: invoiceCycleId
        ? { cycleId: invoiceCycleId }
        : { cycle: { serviceWeekStart: { gte: window.from, lt: window.to } } },
      orderBy: { uploadedAt: 'desc' },
      include: {
        restaurant: { select: { id: true, name: true } },
        cycle: { select: { serviceWeekStart: true } },
        uploadedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    }),
    prisma.restaurant.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const statusColour: Record<string, string> = {
    MATCHED:     'bg-emerald-100 text-emerald-800',
    DISCREPANCY: 'bg-red-100 text-red-700',
    APPROVED:    'bg-blue-100 text-blue-800',
    PENDING:     'bg-amber-100 text-amber-800',
  };

  return (
    <>
      {header}
      {tabBar}

      {/* Upload form — admin only */}
      {isAdmin && <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Upload Vendor Invoice</h2>
        <ActionForm action={uploadInvoice} submitLabel="Upload Invoice" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Restaurant / Vendor</label>
              <select name="restaurantId" required className="input">
                <option value="">Select vendor…</option>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Service Week</label>
              <select name="cycleId" required className="input">
                <option value="">Select week…</option>
                {allCycles.map((c) => (
                  <option key={c.id} value={c.id}>{formatWeekRange(c.serviceWeekStart, locale)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Invoice Number</label>
              <input type="text" name="invoiceNumber" required maxLength={80} className="input" placeholder="e.g. INV-2024-001" />
            </div>
            <div>
              <label className="label">Invoice Date</label>
              <input type="date" name="invoiceDate" required className="input" />
            </div>
            <div>
              <label className="label">Invoiced Amount (RM)</label>
              <input
                type="number"
                name="invoicedAmountSen"
                required
                min="0.01"
                step="0.01"
                className="input"
                placeholder="0.00"
                onChange={undefined}
                // We receive RM from the form but store sen — convert in action
              />
              <p className="mt-1 text-xs text-slate-400">Enter in RM (e.g. 1200.50)</p>
            </div>
            <div>
              <label className="label">PDF Invoice (optional)</label>
              <input type="file" name="pdf" accept="application/pdf" className="input" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="label">Note (optional)</label>
              <textarea name="note" rows={2} maxLength={500} className="input" placeholder="Any notes for Finance…" />
            </div>
          </div>
        </ActionForm>
      </div>}

      {/* Invoice list */}
      <Section
        title="Vendor Invoices"
        description={invoiceCycleId
          ? `Invoices for ${formatWeekRange(allCycles.find(c => c.id === invoiceCycleId)?.serviceWeekStart ?? new Date(), locale)}`
          : `Invoices for the last ${weeks} weeks`}
        action={
          <div className="flex items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="tab" value="invoices" />
              <input type="hidden" name="weeks" value={String(weeks)} />
              <select name="cycle" defaultValue={invoiceCycleId ?? ''} className="input !w-48 !py-1 text-xs">
                <option value="">Last {weeks} weeks</option>
                {allCycles.map((c) => (
                  <option key={c.id} value={c.id}>{formatWeekRange(c.serviceWeekStart, locale)}</option>
                ))}
              </select>
              <button type="submit" className="btn-secondary btn-sm">Filter</button>
              {invoiceCycleId && (
                <a href={`?tab=invoices&weeks=${weeks}`} className="text-xs text-slate-400 hover:text-slate-600">Clear</a>
              )}
            </form>
          </div>
        }
      >
        {invoices.length === 0 ? (
          <EmptyState title="No invoices uploaded yet" hint="Use the form above to upload a vendor invoice." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Vendor</th>
                  <th>Invoice No.</th>
                  <th>Invoice Date</th>
                  <th className="num">Invoiced (RM)</th>
                  <th className="num">Expected (RM)</th>
                  <th className="num">Difference</th>
                  <th>Status</th>
                  <th>PDF</th>
                  <th>Uploaded By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const diff = inv.discrepancySen;
                  return (
                    <tr key={inv.id}>
                      <td className="whitespace-nowrap text-xs text-slate-600">
                        {formatWeekRange(inv.cycle.serviceWeekStart, locale)}
                      </td>
                      <td className="font-medium text-slate-900">{inv.restaurant.name}</td>
                      <td className="font-mono text-xs text-slate-700">{inv.invoiceNumber}</td>
                      <td className="text-xs text-slate-600 whitespace-nowrap">
                        {formatDate(inv.invoiceDate, 'long', locale)}
                      </td>
                      <td className="num text-slate-900">{formatSen(inv.invoicedAmountSen)}</td>
                      <td className="num text-slate-600">{formatSen(inv.expectedAmountSen)}</td>
                      <td className={`num font-medium ${diff === 0 ? 'text-emerald-700' : diff > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                        {diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${formatSen(diff)}`}
                      </td>
                      <td>
                        <span className={`badge ${statusColour[inv.status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {inv.status}
                        </span>
                        {inv.status === 'APPROVED' && inv.approvedBy && (
                          <div className="text-xs text-slate-400 mt-0.5">by {inv.approvedBy.name}</div>
                        )}
                      </td>
                      <td>
                        {inv.pdfDataUrl ? (
                          <a href={inv.pdfDataUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-brand-700 hover:underline">
                            View PDF
                          </a>
                        ) : '—'}
                      </td>
                      <td className="text-xs text-slate-500">
                        {inv.uploadedBy?.name ?? '—'}
                        <div className="text-slate-400">{formatDateTime(inv.uploadedAt, locale)}</div>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          {isAdmin && inv.status === 'DISCREPANCY' && (
                            <form action={approveInvoice}>
                              <input type="hidden" name="id" value={inv.id} />
                              <InlineSubmit label="Approve" variant="primary" />
                            </form>
                          )}
                          {isAdmin && (
                            <form action={deleteInvoice}>
                              <input type="hidden" name="id" value={inv.id} />
                              <InlineSubmit label="Delete" variant="danger"
                                confirm={`Delete invoice "${inv.invoiceNumber}"?`} />
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
