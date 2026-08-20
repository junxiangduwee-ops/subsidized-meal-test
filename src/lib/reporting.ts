import 'server-only';

import { prisma } from './prisma';
import { addWeeks, dateOnly, formatDate, formatWeekRange, mondayOf, todayInAppTz, toDateKey } from './cycle';

/**
 * Read-only aggregates shared by the Analytics, Finance and Kitchen views.
 * Everything counts PAID orders only unless stated otherwise - unpaid carts
 * are intent, not demand.
 */

export type WeekWindow = { from: Date; to: Date };

/** The last `weeks` service weeks up to and including the current one. */
export function trailingWeeks(weeks = 12, now: Date = new Date()): WeekWindow {
  const thisMonday = mondayOf(todayInAppTz(now));
  return { from: addWeeks(thisMonday, -(weeks - 1)), to: addWeeks(thisMonday, 1) };
}

export async function weeklyTotals(window: WeekWindow, locale?: string) {
  const cycles = await prisma.menuCycle.findMany({
    where: { serviceWeekStart: { gte: window.from, lt: window.to } },
    orderBy: { serviceWeekStart: 'asc' },
    select: { id: true, serviceWeekStart: true, status: true },
  });

  if (cycles.length === 0) return [];

  const grouped = await prisma.order.groupBy({
    by: ['cycleId'],
    where: { cycleId: { in: cycles.map((c) => c.id) }, status: 'PAID' },
    _count: { _all: true },
    _sum: { grossSen: true, subsidySen: true, netSen: true },
  });
  const byCycle = new Map(grouped.map((g) => [g.cycleId, g]));

  const meals = await prisma.orderItem.groupBy({
    by: ['orderId'],
    where: { order: { cycleId: { in: cycles.map((c) => c.id) }, status: 'PAID' } },
    _sum: { quantity: true },
  });
  // orderId -> cycleId, so meal counts can roll up per week.
  const orders = await prisma.order.findMany({
    where: { id: { in: meals.map((m) => m.orderId) } },
    select: { id: true, cycleId: true },
  });
  const cycleOfOrder = new Map(orders.map((o) => [o.id, o.cycleId]));
  const mealsByCycle = new Map<string, number>();
  for (const m of meals) {
    const cid = cycleOfOrder.get(m.orderId);
    if (!cid) continue;
    mealsByCycle.set(cid, (mealsByCycle.get(cid) ?? 0) + (m._sum.quantity ?? 0));
  }

  return cycles.map((c) => {
    const g = byCycle.get(c.id);
    return {
      cycleId: c.id,
      weekStart: toDateKey(c.serviceWeekStart),
      label: formatWeekRange(c.serviceWeekStart, locale),
      status: c.status,
      orders: g?._count._all ?? 0,
      meals: mealsByCycle.get(c.id) ?? 0,
      grossSen: g?._sum.grossSen ?? 0,
      subsidySen: g?._sum.subsidySen ?? 0,
      netSen: g?._sum.netSen ?? 0,
    };
  });
}

export async function topDishes(window: WeekWindow, limit = 10) {
  const rows = await prisma.orderItem.groupBy({
    by: ['dishName', 'restaurantName'],
    where: {
      order: { status: 'PAID' },
      serviceDate: { gte: window.from, lt: window.to },
    },
    _sum: { quantity: true, grossSen: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  return rows.map((r) => ({
    dishName: r.dishName,
    restaurantName: r.restaurantName,
    quantity: r._sum.quantity ?? 0,
    grossSen: r._sum.grossSen ?? 0,
  }));
}

export async function restaurantShare(window: WeekWindow) {
  const rows = await prisma.orderItem.groupBy({
    by: ['restaurantName'],
    where: {
      order: { status: 'PAID' },
      serviceDate: { gte: window.from, lt: window.to },
    },
    _sum: { quantity: true, grossSen: true },
    orderBy: { _sum: { grossSen: 'desc' } },
  });

  return rows.map((r) => ({
    name: r.restaurantName,
    quantity: r._sum.quantity ?? 0,
    grossSen: r._sum.grossSen ?? 0,
  }));
}


export async function demandByWeekday(window: WeekWindow, locale?: string) {
  const rows = await prisma.orderItem.groupBy({
    by: ['serviceDate'],
    where: {
      order: { status: 'PAID' },
      serviceDate: { gte: window.from, lt: window.to },
    },
    _sum: { quantity: true },
  });

  const totals = new Map<number, number>();
  for (const r of rows) {
    const dow = dateOnly(r.serviceDate).getUTCDay();
    totals.set(dow, (totals.get(dow) ?? 0) + (r._sum.quantity ?? 0));
  }

  // Monday-first, Monday..Friday.
  return [1, 2, 3, 4, 5].map((dow) => ({
    weekday: formatDate(new Date(Date.UTC(2024, 0, dow)), 'weekday', locale).slice(0, 3),
    meals: totals.get(dow) ?? 0,
  }));
}

export async function departmentBreakdown(window: WeekWindow) {
  const orders = await prisma.order.findMany({
    where: {
      status: 'PAID',
      cycle: { serviceWeekStart: { gte: window.from, lt: window.to } },
    },
    select: {
      grossSen: true,
      subsidySen: true,
      netSen: true,
      userId: true,
      user: { select: { department: true } },
    },
  });

  const map = new Map<
    string,
    {
      department: string;
      orders: number;
      people: Set<string>;
      grossSen: number;
      subsidySen: number;
      netSen: number;
    }
  >();

  for (const o of orders) {
    const key = o.user.department ?? 'Unassigned';
    const row = map.get(key) ?? {
      department: key,
      orders: 0,
      people: new Set<string>(),
      grossSen: 0,
      subsidySen: 0,
      netSen: 0,
    };
    row.orders += 1;
    row.people.add(o.userId);
    row.grossSen += o.grossSen;
    row.subsidySen += o.subsidySen;
    row.netSen += o.netSen;
    map.set(key, row);
  }

  return [...map.values()]
    .map((r) => ({ ...r, people: r.people.size }))
    .sort((a, b) => b.grossSen - a.grossSen);
}

/** Share of active employees who ordered in the given window. */
export async function participation(window: WeekWindow) {
  const [eligible, orderedRows] = await Promise.all([
    prisma.user.count({ where: { active: true } }),
    prisma.order.findMany({
      where: {
        status: 'PAID',
        cycle: { serviceWeekStart: { gte: window.from, lt: window.to } },
      },
      distinct: ['userId'],
      select: { userId: true },
    }),
  ]);

  const ordered = orderedRows.length;
  return { eligible, ordered, rate: eligible === 0 ? 0 : ordered / eligible };
}

/** Production counts a restaurant needs, for one service week. */
export async function kitchenSheet(cycleId: string) {
  const items = await prisma.orderItem.findMany({
    where: { order: { cycleId, status: 'PAID' } },
    select: { restaurantName: true, dishName: true, serviceDate: true, quantity: true, order: { select: { deliverySite: { select: { name: true } } } }, },
  });

  const map = new Map<
    string,
    { restaurantName: string; serviceDate: Date; dishName: string; quantity: number; deliverySiteName: string; }
  >();

  for (const i of items) {
    const deliverySiteName = i.order.deliverySite?.name ?? 'Unassigned';
    const key = `${i.restaurantName}|${toDateKey(i.serviceDate)}|${i.dishName}|${deliverySiteName}`; const row = map.get(key) ?? {
      restaurantName: i.restaurantName,
      serviceDate: i.serviceDate,
      dishName: i.dishName,
      deliverySiteName,
      quantity: 0,
    };
    row.quantity += i.quantity;
    map.set(key, row);
  }

  return [...map.values()].sort(
    (a, b) =>
      a.restaurantName.localeCompare(b.restaurantName) ||
      toDateKey(a.serviceDate).localeCompare(toDateKey(b.serviceDate)) ||
      a.dishName.localeCompare(b.dishName) ||
      a.deliverySiteName.localeCompare(b.deliverySiteName),
  );
}
