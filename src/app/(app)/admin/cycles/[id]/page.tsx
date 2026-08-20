import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { prisma } from '@/lib/prisma';
import { requireCapability } from '@/lib/session';
import { formatSen } from '@/lib/money';
import {
  addWeeks,
  cyclePhase,
  dateOnly,
  formatDate,
  formatDateTime,
  formatWeekRange,
  timeUntil,
  toDateKey,
  toLocalInputValue,
} from '@/lib/cycle';
import { PageHeader, PhaseBadge, Section, Stat, Alert } from '@/components/ui';
import { InlineSubmit } from '@/components/action-form';
import type { DayTab } from '@/components/day-tabs';

import { cancelCycle, closeCycle, copyPreviousWeek, publishCycle, unpublishCycle } from '../actions';
import { DayPlanner, type DishOption, type PlannerItem } from './planner';
import { ScheduleForm } from './schedule-form';

export const dynamic = 'force-dynamic';

export default async function CycleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  await requireCapability('menu:plan');
  const { id } = await params;
  const { day: requestedDay } = await searchParams;
  const t = await getTranslations('cyclesAdmin');
  const locale = await getLocale();

  const cycle = await prisma.menuCycle.findUnique({ where: { id } });
  if (!cycle) notFound();

  const phase = cyclePhase(cycle);
  const editable = cycle.status === 'DRAFT';

  // Tabs need dates and counts only - dishes are loaded for one day below.
  const days = await prisma.menuDay.findMany({
    where: { cycleId: id },
    orderBy: { serviceDate: 'asc' },
    select: { id: true, serviceDate: true, _count: { select: { items: true } } },
  });

  const totalItems = days.reduce((n, d) => n + d._count.items, 0);
  const emptyDays = days.filter((d) => d._count.items === 0);

  const [orderStats, committedOrders, previousWeek] = await Promise.all([
    prisma.order.aggregate({
      where: { cycleId: id, status: 'PAID' },
      _count: { _all: true },
      _sum: { grossSen: true, subsidySen: true, netSen: true },
    }),
    prisma.order.count({
      where: { cycleId: id, status: { in: ['AWAITING_PAYMENT', 'PAID'] } },
    }),
    prisma.menuCycle.findFirst({
      where: {
        serviceWeekStart: addWeeks(dateOnly(cycle.serviceWeekStart), -1),
        status: { not: 'CANCELLED' },
      },
      select: { id: true },
    }),
  ]);

  const header = (
    <>
      <div className="mb-4">
        <Link href="/admin/cycles" className="text-sm text-slate-500 hover:text-slate-800">
          {t('allWeeklyMenus')}
        </Link>
      </div>

      <PageHeader
        title={formatWeekRange(cycle.serviceWeekStart, locale)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            {cycle.title ? <span>{cycle.title}</span> : null}
            {phase === 'OPEN' ? (
              <span className="font-medium text-emerald-700">
                {t('cutoffIn', { time: timeUntil(cycle.orderCutoffAt) })}
              </span>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap gap-2">
            {editable && previousWeek ? (
              <form action={copyPreviousWeek}>
                <input type="hidden" name="id" value={cycle.id} />
                <InlineSubmit label={t('copyLastWeek')} />
              </form>
            ) : null}

            {editable ? (
              <form action={publishCycle}>
                <input type="hidden" name="id" value={cycle.id} />
                <button type="submit" className="btn-primary btn-sm" disabled={totalItems === 0}>
                  {t('publishMenu')}
                </button>
              </form>
            ) : null}

            {cycle.status === 'PUBLISHED' && committedOrders === 0 ? (
              <form action={unpublishCycle}>
                <input type="hidden" name="id" value={cycle.id} />
                <InlineSubmit label={t('unpublish')} confirm={t('unpublishConfirm')} />
              </form>
            ) : null}

            {cycle.status === 'PUBLISHED' ? (
              <form action={closeCycle}>
                <input type="hidden" name="id" value={cycle.id} />
                <InlineSubmit label={t('closeOrderingNow')} confirm={t('closeOrderingConfirm')} />
              </form>
            ) : null}

            {cycle.status !== 'CANCELLED' && cycle.status !== 'FULFILLED' ? (
              <form action={cancelCycle}>
                <input type="hidden" name="id" value={cycle.id} />
                <InlineSubmit
                  label={t('cancelWeek')}
                  variant="danger"
                  confirm={t('cancelWeekConfirm')}
                />
              </form>
            ) : null}
          </div>
        }
      />
    </>
  );

  if (days.length === 0) {
    return (
      <>
        {header}
        <Alert tone="warning">{t('noServiceDays')}</Alert>
      </>
    );
  }

  const fallback = days.find((d) => d._count.items > 0) ?? days[0];
  const activeDay = days.find((d) => toDateKey(d.serviceDate) === requestedDay) ?? fallback;
  const activeDayKey = toDateKey(activeDay.serviceDate);

  const tabs: DayTab[] = days.map((d) => ({
    key: toDateKey(d.serviceDate),
    label: formatDate(d.serviceDate, 'weekday', locale).slice(0, 3),
    sublabel: formatDate(d.serviceDate, undefined, locale),
    badge: d._count.items || null,
    muted: d._count.items === 0,
  }));

  // ---- Dishes for the open tab only. ----
  const menuItems = await prisma.menuItem.findMany({
    where: { menuDayId: activeDay.id },
    orderBy: { sortOrder: 'asc' },
    include: { dish: { include: { restaurant: { select: { name: true } } } } },
  });

  const committed = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: {
      menuItemId: { in: menuItems.map((i) => i.id) },
      order: { status: { in: ['AWAITING_PAYMENT', 'PAID'] } },
    },
    _sum: { quantity: true },
  });
  const orderedByItem = new Map(committed.map((c) => [c.menuItemId, c._sum.quantity ?? 0]));

  const items: PlannerItem[] = menuItems.map((item) => ({
    id: item.id,
    dishId: item.dishId,
    dishName: item.dish.name,
    restaurantName: item.dish.restaurant.name,
    priceSen: item.priceSen,
    catalogPriceSen: item.dish.priceSen,
    capacity: item.capacity,
    ordered: orderedByItem.get(item.id) ?? 0,
  }));

  // The picker is only needed while the menu is still editable.
  const dishOptions: DishOption[] = editable
    ? (
        await prisma.dish.findMany({
          where: { active: true, restaurant: { active: true } },
          orderBy: [{ restaurant: { name: 'asc' } }, { name: 'asc' }],
          select: { id: true, name: true, priceSen: true, restaurant: { select: { name: true } } },
        })
      ).map((d) => ({
        id: d.id,
        name: d.name,
        priceSen: d.priceSen,
        restaurantName: d.restaurant.name,
      }))
    : [];

  return (
    <>
      {header}

      <div className="mb-6 space-y-3">
        {editable && totalItems === 0 ? (
          <Alert>{t('addDishBeforePublish')}</Alert>
        ) : null}

        {editable && totalItems > 0 && emptyDays.length > 0 ? (
          <Alert tone="warning">
            {t('nothingPlannedFor', {
              days: emptyDays.map((d) => formatDate(d.serviceDate, 'weekday', locale)).join(', '),
            })}
          </Alert>
        ) : null}

        {!editable ? (
          <Alert tone="info">
            {t('menuLockedNotice', {
              status: cycle.status.toLowerCase(),
              committed: committedOrders > 0 ? t('ordersAlreadyCommitted', { count: committedOrders }) : '.',
            })}
          </Alert>
        ) : null}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('dishesPlanned')} value={totalItems} hint={t('acrossDays', { count: days.length })} />
        <Stat label={t('paidOrders')} value={orderStats._count._all} hint={t('committedCount', { count: committedOrders })} />
        <Stat label={t('staffPays')} value={formatSen(orderStats._sum.netSen ?? 0)} />
        <Stat
          label={t('companySubsidy')}
          value={formatSen(orderStats._sum.subsidySen ?? 0)}
          tone="positive"
          hint={t('ofGross', { amount: formatSen(orderStats._sum.grossSen ?? 0) })}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <DayPlanner
          tabs={tabs}
          activeDay={activeDayKey}
          dayHeading={formatDate(activeDay.serviceDate, 'full', locale)}
          menuDayId={activeDay.id}
          items={items}
          dishes={dishOptions}
          editable={editable}
        />

        <div className="space-y-4">
          <Section title={t('schedule')}>
            <div className="p-5">
              <ScheduleForm
                cycleId={cycle.id}
                title={cycle.title}
                notes={cycle.notes}
                orderOpenAt={toLocalInputValue(cycle.orderOpenAt)}
                orderCutoffAt={toLocalInputValue(cycle.orderCutoffAt)}
                disabled={cycle.status === 'CANCELLED' || cycle.status === 'FULFILLED'}
              />
            </div>
          </Section>

          <Section title={t('timeline')}>
            <dl className="divide-y divide-slate-100 text-sm">
              <Row label={t('orderingOpens')} value={formatDateTime(cycle.orderOpenAt, locale)} />
              <Row label={t('orderingCloses')} value={formatDateTime(cycle.orderCutoffAt, locale)} />
              <Row label={t('firstServiceDay')} value={formatDate(days[0].serviceDate, 'long', locale)} />
              <Row label={t('published')} value={cycle.publishedAt ? formatDateTime(cycle.publishedAt, locale) : t('notYet')} />
              <Row label={t('closed')} value={cycle.closedAt ? formatDateTime(cycle.closedAt, locale) : '—'} />
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}
