import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { decodeTags } from '@/lib/db-compat';
import { employeePriceFor } from '@/lib/subsidy';
import { formatDate, formatDateTime, formatWeekRange, timeUntil, toDateKey } from '@/lib/cycle';
import { remainingCapacityMap, subsidyRulesForCycle } from '@/lib/orders';
import { getActiveDeliverySites } from '@/lib/cache';
import { PageHeader, EmptyState, Alert } from '@/components/ui';
import type { DayTab } from '@/components/day-tabs';

import { MenuOrdering, type CartLine, type MenuDish } from './menu-ordering';
import { TodayReceiptPanel } from './today-receipt-panel';

export const dynamic = 'force-dynamic';

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const now = new Date();

  const [user, cycle, deliverySites, t, locale, { day: requestedDay }] = await Promise.all([
    requireCapability('order:place'),
    prisma.menuCycle.findFirst({
      where: { status: 'PUBLISHED', orderOpenAt: { lte: now }, orderCutoffAt: { gt: now } },
      orderBy: { serviceWeekStart: 'asc' },
    }),
    getActiveDeliverySites(),
    getTranslations('menu'),
    getLocale(),
    searchParams,
  ]);

  if (!cycle) {
    const upcoming = await prisma.menuCycle.findFirst({
      where: { status: 'PUBLISHED', orderOpenAt: { gt: now } },
      orderBy: { serviceWeekStart: 'asc' },
    });

    return (
      <>
        <PageHeader title={t('nextWeeksMenu')} />
        {/* Show receipt panel even when ordering is closed — the service
            week runs AFTER the order cutoff, so this is the normal case
            when food is being served. */}
        <TodayReceiptPanel userId={user.id} locale={locale} />
        <EmptyState
          title={t('closedTitle')}
          hint={
            upcoming
              ? t('closedHintWithUpcoming', {
                  week: formatWeekRange(upcoming.serviceWeekStart, locale),
                  date: formatDateTime(upcoming.orderOpenAt, locale),
                })
              : t('closedHintDefault')
          }
          action={
            <Link href="/orders" className="btn-secondary">
              {t('viewPastOrders')}
            </Link>
          }
        />
      </>
    );
  }

  const rules = await subsidyRulesForCycle(cycle);

  const [orders, days] = await Promise.all([
    prisma.order.findMany({
      where: { userId: user.id, cycleId: cycle.id },
      include: { items: { orderBy: [{ serviceDate: 'asc' }, { dishName: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.menuDay.findMany({
      where: { cycleId: cycle.id },
      orderBy: { serviceDate: 'asc' },
      select: { id: true, serviceDate: true, _count: { select: { items: true } } },
    }),
  ]);

  const cart = orders.find((o) => o.status === 'CART');
  const settledOrders = orders.filter((o) => o.status !== 'CART');

  const orderItems = orders.flatMap((o) =>
    o.items.map((item) => ({ ...item, orderStatus: o.status, orderReference: o.reference })),
  );

  if (days.length === 0) {
    return (
      <>
        <PageHeader
          title={t('title', { range: formatWeekRange(cycle.serviceWeekStart, locale) })}
          action={
            <Link href="/orders" className="btn-secondary">
              {t('myOrdersLink')}
            </Link>
          }
        />
        <EmptyState title={t('noDays')} />
      </>
    );
  }

  const chosenMenuItemIds = new Set(orderItems.map((item) => item.menuItemId));
  const orderStatusByMenuItemId = new Map(orderItems.map((item) => [item.menuItemId, item.orderStatus]));
  const lockedDayKeys = new Set(
    orderItems.filter((item) => item.orderStatus !== 'CART').map((item) => toDateKey(item.serviceDate)),
  );
  const chosenDayKeys = new Set(orderItems.map((item) => toDateKey(item.serviceDate)));

  const allOrderableDaysLocked = days
    .filter((d) => d._count.items > 0)
    .every((d) => lockedDayKeys.has(toDateKey(d.serviceDate)));

  const lockedItems = orderItems.filter((item) => item.orderStatus !== 'CART');
  const anyLockedAwaitingPayment = lockedItems.some((item) => item.orderStatus === 'AWAITING_PAYMENT');

  const header = (
    <PageHeader
      title={t('title', { range: formatWeekRange(cycle.serviceWeekStart, locale) })}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {allOrderableDaysLocked ? (
            anyLockedAwaitingPayment ? (
              <span className="badge bg-amber-100 text-amber-800">{t('awaitingPayment')}</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-800">{t('orderPlaced')}</span>
            )
          ) : (
            <>
              <span className="badge bg-emerald-100 text-emerald-800">{t('orderingOpen')}</span>
              <span>
                {t('closes', { date: formatDateTime(cycle.orderCutoffAt, locale) })} ·{' '}
                <span className="font-medium text-slate-700">{timeUntil(cycle.orderCutoffAt)}</span>
              </span>
            </>
          )}
        </span>
      }
      action={
        <Link href="/orders" className="btn-secondary">
          {t('myOrdersLink')}
        </Link>
      }
    />
  );

  const fallback =
    days.find((d) => d._count.items > 0 && !lockedDayKeys.has(toDateKey(d.serviceDate))) ??
    days.find((d) => d._count.items > 0) ??
    days[0];
  const activeDay = days.find((d) => toDateKey(d.serviceDate) === requestedDay) ?? fallback;
  const activeDayKey = toDateKey(activeDay.serviceDate);
  const activeDayLocked = lockedDayKeys.has(activeDayKey);

  const tabs: DayTab[] = days.map((d) => ({
    key: toDateKey(d.serviceDate),
    label: formatDate(d.serviceDate, 'weekday', locale).slice(0, 3),
    sublabel: formatDate(d.serviceDate, undefined, locale),
    check: chosenDayKeys.has(toDateKey(d.serviceDate)),
    muted: d._count.items === 0,
  }));

  const menuItems = await prisma.menuItem.findMany({
    where: { menuDayId: activeDay.id },
    orderBy: { sortOrder: 'asc' },
    include: { dish: { include: { restaurant: { select: { name: true } } } } },
  });

  const remaining = activeDayLocked
    ? new Map<string, number | null>()
    : await remainingCapacityMap(
        menuItems.map((i) => ({ id: i.id, capacity: i.capacity })),
        cart?.id,
      );

  const dishes: MenuDish[] = menuItems.map((item) => ({
    menuItemId: item.id,
    dishName: item.dish.name,
    restaurantName: item.dish.restaurant.name,
    description: item.dish.description,
    tags: decodeTags(item.dish.tags),
    priceSen: employeePriceFor(item.priceSen, activeDay.serviceDate, rules, user.department),
    remaining: remaining.get(item.id) ?? null,
    orderStatus: orderStatusByMenuItemId.get(item.id) ?? null,
    chosen: chosenMenuItemIds.has(item.id),
  }));

  const cartLines: CartLine[] = orderItems.map((item) => ({
    id: item.id,
    dayKey: toDateKey(item.serviceDate),
    dayLabel: `${formatDate(item.serviceDate, 'weekday', locale)} · ${formatDate(item.serviceDate, undefined, locale)}`,
    dishName: item.dishName,
    netSen: item.netSen,
    status: item.orderStatus,
    locked: item.orderStatus !== 'CART',
  }));

  const awaitingPayment = settledOrders.some((o) => o.status === 'AWAITING_PAYMENT');

  return (
    <>
      {header}

      {/* Receipt confirmation panel — only shows on service days when the
          employee has a paid meal. Returns null silently on all other days. */}
      <TodayReceiptPanel userId={user.id} locale={locale} />

      {awaitingPayment ? (
        <div className="mb-4">
          <Alert tone="warning">{t('awaitingPaymentBanner')}</Alert>
        </div>
      ) : null}

      <MenuOrdering
        cycleId={cycle.id}
        tabs={tabs}
        activeDay={activeDayKey}
        dayHeading={formatDate(activeDay.serviceDate, 'full', locale)}
        dishes={dishes}
        cartLines={cartLines}
        notes={cycle.notes}
        totalSen={cart?.netSen ?? 0}
        readOnly={activeDayLocked}
        hasSettledOrders={settledOrders.length > 0}
        deliverySites={deliverySites}
        selectedDeliverySiteId={cart?.deliverySiteId ?? null}
        needsReceiptEmail={!user.email}
      />
    </>
  );
}
