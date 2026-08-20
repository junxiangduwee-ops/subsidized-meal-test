import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/session';
import { can } from '@/lib/rbac';
import { formatSen } from '@/lib/money';
import { formatDate, formatDateTime, formatWeekRange, toDateKey } from '@/lib/cycle';
import { PageHeader, Section, Alert, StatusBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ status?: string; from?: string }>;
}) {
  const user = await requireUser();
  const t = await getTranslations('orderDetail');
  const locale = await getLocale();
  const { reference } = await params;
  const query = await searchParams;

  const order = await prisma.order.findUnique({
    where: { reference: decodeURIComponent(reference) },
    include: {
      cycle: true,
      user: { select: { id: true, name: true, email: true, staffId: true, department: true } },
      items: { orderBy: [{ serviceDate: 'asc' }, { dishName: 'asc' }] },
      payments: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!order) notFound();

  // Employees see only their own order; Finance and Admin can open any.
  const isOwner = order.userId === user.id;
  if (!isOwner && !can(user.role, 'finance:view')) notFound();

  const byDay = new Map<string, typeof order.items>();
  for (const item of order.items) {
    const key = toDateKey(item.serviceDate);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  // Employees see what they paid; only finance roles see the split.
  const showSubsidy = can(user.role, 'finance:view');
  const latestPayment = order.payments[0];
  const awaiting = order.status === 'AWAITING_PAYMENT';

  return (
    <>
      <div className="mb-4">
        <Link href={isOwner ? '/orders' : '/finance'} className="text-sm text-slate-500 hover:text-slate-800">
          ← {t('back')}
        </Link>
      </div>

      <PageHeader
        title={`Order ${order.reference}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <span>{formatWeekRange(order.cycle.serviceWeekStart, locale)}</span>
            {!isOwner ? <span>· {order.user.name}</span> : null}
          </span>
        }
      />

      {query.status === 'confirmed' ? (
        <div className="mb-6">
          <Alert tone="success">{t('orderConfirmed')}</Alert>
        </div>
      ) : null}

      {awaiting ? (
        <div className="mb-6">
          <Alert tone="warning">
            <p>{t('awaitingPayment', { amount: formatSen(order.netSen) })}</p>
            {latestPayment?.checkoutUrl ? (
              <p className="mt-2">
                <a href={latestPayment.checkoutUrl} className="btn-primary btn-sm">
                  {t('continueToPayment')}
                </a>
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {order.status === 'CANCELLED' ? (
        <div className="mb-6">
          <Alert tone="error">
            {t('cancelled')}
            {order.cancelReason ? `: ${order.cancelReason}` : '.'}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Section title={t('meals')} description={t('lineItems', { count: order.items.length })}>
          <div className="divide-y divide-slate-100">
            {[...byDay.entries()].map(([dateKey, items]) => (
              <div key={dateKey} className="px-5 py-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {formatDate(items[0].serviceDate, 'weekday', locale)} · {formatDate(items[0].serviceDate, 'long', locale)}
                </div>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-baseline justify-between gap-4 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-slate-900">{item.dishName}</span>
                        <span className="ml-2 text-slate-500">×{item.quantity}</span>
                        <div className="text-xs text-slate-500">{item.restaurantName}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="tabular-nums text-slate-900">{formatSen(item.netSen)}</div>
                        {showSubsidy && item.subsidySen > 0 ? (
                          <div className="text-xs tabular-nums text-emerald-700">
                            {formatSen(item.grossSen)} − {formatSen(item.subsidySen)} {t('subsidyInline')}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <div className="space-y-4">
          <Section title={t('summary')}>
            <dl className="divide-y divide-slate-100 text-sm">
              {showSubsidy ? <Row label={t('foodTotal')} value={formatSen(order.grossSen)} /> : null}
              {showSubsidy ? (
                <Row
                  label={t('companySubsidy')}
                  value={`− ${formatSen(order.subsidySen)}`}
                  tone="positive"
                />
              ) : null}
              <Row
                label={isOwner ? t('youPay') : t('staffPays')}
                value={formatSen(order.netSen)}
                strong
              />
              <Row
                label={t('submitted')}
                value={order.submittedAt ? formatDateTime(order.submittedAt, locale) : '—'}
              />
              <Row label={t('paid')} value={order.paidAt ? formatDateTime(order.paidAt, locale) : '—'} />
            </dl>
          </Section>

          {order.payments.length > 0 ? (
            <Section title={t('payments')}>
              <div className="divide-y divide-slate-100 text-sm">
                {order.payments.map((p) => (
                  <div key={p.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <StatusBadge status={p.status} />
                      <span className="tabular-nums text-slate-900">{formatSen(p.amountSen)}</span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                      <div>{formatDateTime(p.createdAt, locale)}</div>
                      {p.paymentMethod ? <div>{t('via', { method: p.paymentMethod })}</div> : null}
                      {p.paymentId ? (
                        // Safe to show: it is the payer's own reference, and
                        // Finance needs it to reconcile.
                        <div className="font-mono">{t('ref', { id: p.paymentId })}</div>
                      ) : null}
                      {p.failureReason ? <div className="text-red-600">{p.failureReason}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {!isOwner ? (
            <Section title={t('employee')}>
              <dl className="divide-y divide-slate-100 text-sm">
                <Row label={t('name')} value={order.user.name} />
                <Row label={t('staffId')} value={order.user.staffId ?? '—'} />
                <Row label={t('department')} value={order.user.department ?? '—'} />
              </dl>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: 'positive';
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd
        className={`text-right tabular-nums ${tone === 'positive' ? 'text-emerald-700' : 'text-slate-900'} ${
          strong ? 'text-base font-semibold' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
