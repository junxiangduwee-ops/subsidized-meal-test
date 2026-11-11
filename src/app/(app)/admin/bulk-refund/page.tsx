import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { formatDate, formatWeekRange, toDateKey } from '@/lib/cycle';
import { formatSen } from '@/lib/money';
import { PageHeader, Section, Alert } from '@/components/ui';
import { BulkRefundForm } from './bulk-refund-form';
import { BulkRefundFilters } from './bulk-refund-filters';

export const dynamic = 'force-dynamic';

export default async function BulkRefundPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string; day?: string; restaurant?: string; dish?: string }>;
}) {
  await requireCapability('menu:plan');
  const params = await searchParams;
  const t = await getTranslations('bulkRefund');
  const locale = await getLocale();

  const failedRefundOrders = await prisma.order.findMany({
    where: { status: 'REFUND_FAILED' },
    select: {
      id: true,
      reference: true,
      netSen: true,
      user: { select: { name: true, staffId: true } },
      cycle: { select: { serviceWeekStart: true } },
      items: { select: { dishName: true, restaurantName: true, quantity: true }, orderBy: { serviceDate: 'asc' } },
    },
    orderBy: { lastRefundAttemptAt: 'desc' },
  });
  const failedRefundCount = failedRefundOrders.length;

  const cycles = await prisma.menuCycle.findMany({
    where: { status: { in: ['PUBLISHED', 'CLOSED', 'FULFILLED'] } },
    orderBy: { serviceWeekStart: 'desc' },
    take: 20,
    select: { id: true, serviceWeekStart: true, status: true },
  });

  const selectedCycle = cycles.find((c) => c.id === params.cycle) ?? cycles[0] ?? null;

  const serviceDayRows = selectedCycle
    ? await prisma.orderItem.findMany({
        where: { order: { cycleId: selectedCycle.id, status: { in: ['PAID', 'REFUND_PENDING', 'REFUND_FAILED'] } } },
        select: { serviceDate: true },
        distinct: ['serviceDate'],
        orderBy: { serviceDate: 'asc' },
      })
    : [];
  const serviceDays = serviceDayRows.map((r) => r.serviceDate);

  const selectedDay = params.day
    ? serviceDays.find((d) => toDateKey(d) === params.day) ?? null
    : null;

  const restaurantRows = selectedCycle
    ? await prisma.orderItem.findMany({
        where: {
          order: { cycleId: selectedCycle.id, status: { in: ['PAID', 'REFUND_PENDING', 'REFUND_FAILED'] } },
          ...(selectedDay ? { serviceDate: selectedDay } : {}),
        },
        select: { restaurantName: true },
        distinct: ['restaurantName'],
        orderBy: { restaurantName: 'asc' },
      })
    : [];
  const restaurants = restaurantRows.map((r) => r.restaurantName);

  const selectedRestaurant =
    params.restaurant && restaurants.includes(params.restaurant) ? params.restaurant : null;

  // Dishes cascade from cycle + day + restaurant
  const dishRows = selectedCycle
    ? await prisma.orderItem.findMany({
        where: {
          order: { cycleId: selectedCycle.id, status: { in: ['PAID', 'REFUND_PENDING', 'REFUND_FAILED'] } },
          ...(selectedDay ? { serviceDate: selectedDay } : {}),
          ...(selectedRestaurant ? { restaurantName: selectedRestaurant } : {}),
        },
        select: { dishName: true },
        distinct: ['dishName'],
        orderBy: { dishName: 'asc' },
      })
    : [];
  const dishes = dishRows.map((r) => r.dishName);

  const selectedDish =
    params.dish && dishes.includes(params.dish) ? params.dish : null;

  const itemFilter = {
    ...(selectedDay ? { serviceDate: selectedDay } : {}),
    ...(selectedRestaurant ? { restaurantName: selectedRestaurant } : {}),
    ...(selectedDish ? { dishName: selectedDish } : {}),
  };
  const hasItemFilter = !!(selectedDay || selectedRestaurant || selectedDish);

  const orders = selectedCycle
    ? await prisma.order.findMany({
        where: {
          cycleId: selectedCycle.id,
          status: { in: ['PAID', 'REFUND_PENDING', 'REFUND_FAILED'] },
          ...(hasItemFilter ? { items: { some: itemFilter } } : {}),
        },
        include: {
          user: { select: { name: true, staffId: true } },
          items: {
            where: hasItemFilter ? itemFilter : undefined,
            select: { dishName: true, restaurantName: true, quantity: true, serviceDate: true },
            orderBy: { serviceDate: 'asc' },
          },
        },
        orderBy: { user: { name: 'asc' } },
      })
    : [];

  const orderRows = orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    userName: o.user.name,
    staffId: o.user.staffId,
    items: o.items.map((i) => ({
      dishName: i.dishName,
      restaurantName: i.restaurantName,
      quantity: i.quantity,
    })),
    amountLabel: formatSen(o.netSen),
  }));

  return (
    <>
      <div className="mb-4">
        <Link href="/admin/cycles" className="text-sm text-slate-500 hover:text-slate-800">
          ← {t('backToAdmin')}
        </Link>
      </div>

      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {failedRefundCount > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {failedRefundCount} order{failedRefundCount === 1 ? '' : 's'} failed to refund and need a manual retry.
            Select the cycle containing the order below, then check and refund.
          </p>
          <ul className="mt-3 divide-y divide-amber-100">
            {failedRefundOrders.map((o) => (
              <li key={o.id} className="py-2 text-xs">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/orders/${o.reference}`}
                      className="font-mono font-medium text-amber-800 underline hover:text-amber-900"
                    >
                      {o.reference}
                    </Link>
                    <span className="ml-2 text-amber-700">{o.user.name}</span>
                    {o.user.staffId && (
                      <span className="ml-1 text-amber-500">({o.user.staffId})</span>
                    )}
                    <div className="mt-1 space-y-0.5 text-amber-600">
                      {o.items.map((item, i) => (
                        <div key={i}>
                          {item.dishName} ×{item.quantity}
                          <span className="text-amber-400"> · {item.restaurantName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-amber-700">
                    <div className="font-medium">{formatSen(o.netSen)}</div>
                    <div className="text-amber-500">{formatWeekRange(o.cycle.serviceWeekStart, locale)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <Section title={t('filters')}>
          <BulkRefundFilters
            cycles={cycles.map((c) => ({
              id: c.id,
              label: formatWeekRange(c.serviceWeekStart, locale),
            }))}
            selectedCycleId={selectedCycle?.id ?? ''}
            days={serviceDays.map((d) => ({
              key: toDateKey(d),
              label: `${formatDate(d, 'weekday', locale)} · ${formatDate(d, 'long', locale)}`,
            }))}
            selectedDayKey={params.day ?? ''}
            restaurants={restaurants}
            selectedRestaurant={selectedRestaurant ?? ''}
            dishes={dishes}
            selectedDish={selectedDish ?? ''}
          />
        </Section>
      </div>

      {/* ── Orders table ────────────────────────────────────────────────── */}
      {selectedCycle ? (
        <Section
          title={t('ordersTitle')}
          description={t('ordersSubtitle', { count: orderRows.length })}
        >
          <BulkRefundForm
            key={`${selectedCycle?.id ?? ''}-${params.day ?? ''}-${params.restaurant ?? ''}-${params.dish ?? ''}`}
            orders={orderRows}
          />
        </Section>
      ) : (
        <p className="text-sm text-slate-500">{t('noCycles')}</p>
      )}
    </>
  );
}
