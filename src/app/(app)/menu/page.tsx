import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { decodeTags } from '@/lib/db-compat';
import { employeePriceFor } from '@/lib/subsidy';
import { formatDate, formatDateTime, formatWeekRange, timeUntil, toDateKey } from '@/lib/cycle';
import { remainingCapacityMap } from '@/lib/orders';
import { getActiveDeliverySites, getActiveSubsidyRules } from '@/lib/cache';
import { PageHeader, EmptyState, Alert } from '@/components/ui';
import type { DayTab } from '@/components/day-tabs';

import { MenuOrdering, type CartLine, type MenuDish } from './menu-ordering';

export const dynamic = 'force-dynamic';

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const now = new Date();

  // Independent of everything else on this page - user identity, the open
  // cycle, delivery site options, subsidy rules, translations/locale, and
  // the day query param don't depend on one another, so there is no reason
  // to fetch them one after another. This is a read-only page: running
  // these concurrently carries none of the atomicity/timeout risk that
  // wrapping a write in a transaction would.
  const [user, cycle, deliverySites, rules, t, locale, { day: requestedDay }] = await Promise.all([
    requireCapability('order:place'),
    prisma.menuCycle.findFirst({
      where: { status: 'PUBLISHED', orderOpenAt: { lte: now }, orderCutoffAt: { gt: now } },
      orderBy: { serviceWeekStart: 'asc' },
    }),
    getActiveDeliverySites(),
    getActiveSubsidyRules(),
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

  // Both of these only need cycle.id (orders also needs user.id) - neither
  // depends on the other's result, so they run together instead of one
  // after another.
  const [orders, days] = await Promise.all([
    // A person may have several orders for this cycle - the open cart, plus
    // any earlier ones they already paid for. Pulling all of them, rather
    // than assuming there is exactly one, is what lets a paid Mon-Wed order
    // sit alongside an untouched Thu/Fri instead of locking the whole week.
    prisma.order.findMany({
      where: { userId: user.id, cycleId: cycle.id },
      include: { items: { orderBy: [{ serviceDate: 'asc' }, { dishName: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    }),
    // Day tabs: dates and per-day dish counts only - not the dishes themselves.
    prisma.menuDay.findMany({
      where: { cycleId: cycle.id },
      orderBy: { serviceDate: 'asc' },
      select: { id: true, serviceDate: true, _count: { select: { items: true } } },
    }),
  ]);

  // The cart is created on first add, not on first view, so browsing alone
  // does not litter the table with empty orders.
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

  // Per-day state, derived from every order rather than one. A day is
  // "locked" once a submitted (non-CART) order already has an item for it -
  // that item is paid for and done. A day with no item at all is always
  // still open, regardless of how many other days are locked.
  const chosenMenuItemIds = new Set(orderItems.map((item) => item.menuItemId));
  const lockedDayKeys = new Set(
    orderItems.filter((item) => item.orderStatus !== 'CART').map((item) => toDateKey(item.serviceDate)),
  );
  const chosenDayKeys = new Set(orderItems.map((item) => toDateKey(item.serviceDate)));

  const allOrderableDaysLocked = days
    .filter((d) => d._count.items > 0)
    .every((d) => lockedDayKeys.has(toDateKey(d.serviceDate)));

  const header = (
    <PageHeader
      title={t('title', { range: formatWeekRange(cycle.serviceWeekStart, locale) })}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {allOrderableDaysLocked ? (
            <span className="badge bg-emerald-100 text-emerald-800">{t('orderPlaced')}</span>
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

  // Honour ?day= when it names a real day, otherwise land on the first day
  // that still needs a choice, or failing that the first day with dishes.
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

  // ---- The only query that loads dishes, and only for the open tab. ----
  const menuItems = await prisma.menuItem.findMany({
    where: { menuDayId: activeDay.id },
    orderBy: { sortOrder: 'asc' },
    include: { dish: { include: { restaurant: { select: { name: true } } } } },
  });

  // Stock only matters while this specific day can still be changed.
  const remaining = activeDayLocked
    ? new Map<string, number | null>()
    : await remainingCapacityMap(
        menuItems.map((i) => ({ id: i.id, capacity: i.capacity })),
        cart?.id,
      );

  // `rules` was already fetched at the top, in parallel with the cycle
  // lookup - employees see their own price, never the list price or the
  // company's contribution, computed here per dish since it is one meal
  // per service day.

  const dishes: MenuDish[] = menuItems.map((item) => ({
    menuItemId: item.id,
    dishName: item.dish.name,
    restaurantName: item.dish.restaurant.name,
    description: item.dish.description,
    tags: decodeTags(item.dish.tags),
    priceSen: employeePriceFor(item.priceSen, activeDay.serviceDate, rules, user.department),
    remaining: remaining.get(item.id) ?? null,
    chosen: chosenMenuItemIds.has(item.id),
  }));

  const cartLines: CartLine[] = orderItems.map((item) => ({
    id: item.id,
    dayKey: toDateKey(item.serviceDate),
    dayLabel: `${formatDate(item.serviceDate, 'weekday', locale)} · ${formatDate(item.serviceDate, undefined, locale)}`,
    dishName: item.dishName,
    netSen: item.netSen,
    locked: item.orderStatus !== 'CART',
  }));

  const awaitingPayment = settledOrders.some((o) => o.status === 'AWAITING_PAYMENT');

  return (
    <>
      {header}

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
      />
    </>
  );
}
