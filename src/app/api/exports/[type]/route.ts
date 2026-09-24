import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/rbac';
import { csvAmount, csvResponse, toCsv } from '@/lib/csv';
import { decodeTags } from '@/lib/db-compat';
import { formatWeekRange, toDateKey, zonedToUtc } from '@/lib/cycle';
import { kitchenSheet, trailingWeeks, weeklyTotals } from '@/lib/reporting';
import { audit } from '@/lib/orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * CSV exports for Finance, Kitchen, Catalogue admin, and employees' own
 * order history.
 *
 * The Finance/Kitchen exports contain other employees' names and staff IDs.
 * They are personal data: store them on approved systems only and do not
 * forward them outside Finance/HR. `my-orders` is scoped to the signed-in
 * user's own orders only, so no extra capability is required for it.
 *
 * `restaurants`/`dishes` are catalogue reference data (no personal data) -
 * they exist so an admin can round-trip the current catalogue into a
 * spreadsheet, including each row's `code`, which is the stable key a
 * future weekly-menu import will validate against.
 */
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { type } = await params;
  const url = new URL(request.url);
  const cycleId = url.searchParams.get('cycle');

  const needsFinance = type === 'orders' || type === 'subsidy' || type === 'payments';
  if (needsFinance && !can(user.role, 'finance:export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (type === 'kitchen' && !can(user.role, 'kitchen:view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (type === 'kitchen-employees' && !can(user.role, 'kitchen:view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (type === 'reconciliation' && !can(user.role, 'finance:export')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if ((type === 'restaurants' || type === 'dishes') && !can(user.role, 'catalogue:manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (type === 'weekly-menu-template' && !can(user.role, 'menu:plan')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  switch (type) {
    case 'orders':
      return exportOrders(user.id, cycleId);
    case 'payments':
      return exportPayments(user.id, cycleId);
    case 'subsidy':
      return exportSubsidy(user.id, url.searchParams.get('weeks'));
    case 'kitchen':
      return exportKitchen(user.id, cycleId);
    case 'kitchen-employees':
      return exportKitchenEmployees(user.id, cycleId);
    case 'reconciliation':
      return exportReconciliation(user.id, url.searchParams.get('weeks'));
    case 'my-orders':
      return exportMyOrders(user.id, url.searchParams.get('month'));
    case 'restaurants':
      return exportRestaurants(user.id);
    case 'dishes':
      return exportDishes(user.id);
    case 'weekly-menu-template':
      return exportWeeklyMenuTemplate(user.id);
    default:
      return NextResponse.json({ error: 'Unknown export' }, { status: 404 });
  }
}

async function exportOrders(actorId: string, cycleId: string | null) {
  if (!cycleId) return NextResponse.json({ error: 'Missing cycle' }, { status: 400 });

  const cycle = await prisma.menuCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  const orders = await prisma.order.findMany({
    where: { cycleId, status: { in: ['PAID', 'AWAITING_PAYMENT'] } },
    orderBy: [{ user: { staffId: 'asc' } }, { createdAt: 'asc' }],
    include: {
      user: { select: { name: true, staffId: true, department: true } },
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const rows = orders.map((o) => [
    o.reference,
    o.user.staffId ?? '',
    o.user.name,
    o.user.department ?? '',
    o.status,
    csvAmount(o.grossSen),
    csvAmount(o.subsidySen),
    csvAmount(o.netSen),
    o.payments[0]?.paymentId ?? '',
    o.payments[0]?.paymentMethod ?? '',
    o.paidAt ? o.paidAt.toISOString() : '',
  ]);

  const csv = toCsv(
    [
      'Order reference',
      'Staff ID',
      'Name',
      'Department',
      'Status',
      'Food total (RM)',
      'Company subsidy (RM)',
      'Staff paid (RM)',
      'HitPay payment ID',
      'Payment method',
      'Paid at (UTC)',
    ],
    rows,
  );

  await audit(actorId, 'export.orders', 'MenuCycle', cycleId, { rows: rows.length });
  return csvResponse(`orders-${toDateKey(cycle.serviceWeekStart)}.csv`, csv);
}

async function exportPayments(actorId: string, cycleId: string | null) {
  const payments = await prisma.payment.findMany({
    where: cycleId ? { order: { cycleId } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 5000,
    include: {
      order: {
        select: {
          reference: true,
          netSen: true,
          user: { select: { name: true, staffId: true } },
          cycle: { select: { serviceWeekStart: true } },
        },
      },
    },
  });

  const rows = payments.map((p) => [
    p.order.reference,
    formatWeekRange(p.order.cycle.serviceWeekStart),
    p.order.user.staffId ?? '',
    p.order.user.name,
    p.status,
    csvAmount(p.amountSen),
    csvAmount(p.order.netSen),
    p.currency,
    p.paymentId ?? '',
    p.requestId ?? '',
    p.paymentMethod ?? '',
    p.failureReason ?? '',
    p.createdAt.toISOString(),
  ]);

  const csv = toCsv(
    [
      'Order reference',
      'Service week',
      'Staff ID',
      'Name',
      'Payment status',
      'Amount charged (RM)',
      'Order net (RM)',
      'Currency',
      'HitPay payment ID',
      'HitPay request ID',
      'Method',
      'Failure reason',
      'Created at (UTC)',
    ],
    rows,
  );

  await audit(actorId, 'export.payments', 'Payment', cycleId, { rows: rows.length });
  return csvResponse('hitpay-reconciliation.csv', csv);
}

async function exportSubsidy(actorId: string, weeksRaw: string | null) {
  const weeks = clampWeeks(weeksRaw);
  const window = trailingWeeks(weeks);
  const totals = await weeklyTotals(window);

  const rows = totals.map((w) => [
    w.label,
    w.status,
    w.orders,
    w.meals,
    csvAmount(w.grossSen),
    csvAmount(w.subsidySen),
    csvAmount(w.netSen),
  ]);

  const csv = toCsv(
    [
      'Service week',
      'Cycle status',
      'Paid orders',
      'Meals',
      'Food total (RM)',
      'Company subsidy (RM)',
      'Staff paid (RM)',
    ],
    rows,
  );

  await audit(actorId, 'export.subsidy', 'Report', null, { weeks });
  return csvResponse(`subsidy-cost-last-${weeks}-weeks.csv`, csv);
}

async function exportKitchen(actorId: string, cycleId: string | null) {
  if (!cycleId) return NextResponse.json({ error: 'Missing cycle' }, { status: 400 });

  const cycle = await prisma.menuCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  const sheet = await kitchenSheet(cycleId);
  const rows = sheet.map((r) => [
    r.restaurantName,
    toDateKey(r.serviceDate),
    r.dishName,
    r.deliverySiteName,
    r.quantity,
  ]);

  const csv = toCsv(['Restaurant', 'Service date', 'Dish', 'Delivery site', 'Portions'], rows);
  await audit(actorId, 'export.kitchen', 'MenuCycle', cycleId, { rows: rows.length });
  return csvResponse(`kitchen-counts-${toDateKey(cycle.serviceWeekStart)}.csv`, csv);
}

function clampWeeks(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 12;
  return Math.min(52, Math.max(1, n));
}

/** Parses a `?month=YYYY-MM` param into a [start, end) UTC instant range in APP_TIMEZONE. */
function parseMonth(raw: string | null): { year: number; month1: number; start: Date; end: Date } | null {
  const match = raw?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month1 = Number(match[2]);
  if (month1 < 1 || month1 > 12) return null;

  const start = zonedToUtc(year, month1, 1);
  const end = month1 === 12 ? zonedToUtc(year + 1, 1, 1) : zonedToUtc(year, month1 + 1, 1);
  return { year, month1, start, end };
}

async function exportMyOrders(userId: string, monthRaw: string | null) {
  const month = parseMonth(monthRaw);
  if (!month) {
    return NextResponse.json({ error: 'Missing or invalid month (expected YYYY-MM)' }, { status: 400 });
  }

  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: { not: 'CART' },
      createdAt: { gte: month.start, lt: month.end },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      cycle: { select: { serviceWeekStart: true } },
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const rows = orders.map((o) => [
    o.reference,
    formatWeekRange(o.cycle.serviceWeekStart),
    o.status,
    csvAmount(o.netSen),
    o.payments[0]?.paymentMethod ?? '',
    o.submittedAt ? o.submittedAt.toISOString() : '',
    o.paidAt ? o.paidAt.toISOString() : '',
  ]);

  const csv = toCsv(
    [
      'Order reference',
      'Service week',
      'Status',
      'Amount paid (RM)',
      'Payment method',
      'Placed at (UTC)',
      'Paid at (UTC)',
    ],
    rows,
  );

  const monthKey = `${month.year}-${String(month.month1).padStart(2, '0')}`;
  await audit(userId, 'export.my-orders', 'Order', null, { month: monthKey, rows: rows.length });
  return csvResponse(`my-orders-${monthKey}.csv`, csv);
}

/**
 * Catalogue exports.
 *
 * These double as the template for the (future) weekly-menu CSV/Excel
 * import: `code` is the stable key an importer will validate rows against,
 * so every column here matches what admins see and edit in
 * Admin > Restaurants / Admin > Dishes.
 */
async function exportRestaurants(actorId: string) {
  const restaurants = await prisma.restaurant.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });

  const rows = restaurants.map((r) => [
    r.code ?? '',
    r.name,
    r.cuisine ?? '',
    r.contactName ?? '',
    r.contactPhone ?? '',
    r.address ?? '',
    r.description ?? '',
    r.active ? 'ACTIVE' : 'INACTIVE',
  ]);

  const csv = toCsv(
    ['Code', 'Name', 'Cuisine', 'Contact name', 'Contact phone', 'Address', 'Description', 'Status'],
    rows,
  );

  await audit(actorId, 'export.restaurants', 'Restaurant', null, { rows: rows.length });
  return csvResponse('restaurants.csv', csv);
}

async function exportDishes(actorId: string) {
  const dishes = await prisma.dish.findMany({
    orderBy: [{ active: 'desc' }, { restaurant: { name: 'asc' } }, { name: 'asc' }],
    include: { restaurant: { select: { code: true, name: true } } },
  });

  const rows = dishes.map((d) => [
    d.restaurant.code ?? '',
    d.restaurant.name,
    d.code ?? '',
    d.name,
    d.category ?? '',
    csvAmount(d.priceSen),
    decodeTags(d.tags).join(', '),
    d.description ?? '',
    d.imageUrl ?? '',
    d.active ? 'ACTIVE' : 'INACTIVE',
  ]);

  const csv = toCsv(
    [
      'Restaurant code',
      'Restaurant name',
      'Dish code',
      'Dish name',
      'Category',
      'Price (RM)',
      'Tags',
      'Description',
      'Image URL',
      'Status',
    ],
    rows,
  );

  await audit(actorId, 'export.dishes', 'Dish', null, { rows: rows.length });
  return csvResponse('dishes.csv', csv);
}

/**
 * Template for the weekly-menu bulk import (Admin > a draft cycle >
 * "Upload CSV/Excel"). Column order matches the restaurants/dishes exports
 * above so codes copy-paste cleanly between the two. Example rows use the
 * first couple of real, active dishes when there are any, so a new admin
 * sees codes that actually exist rather than made-up placeholders.
 */
async function exportWeeklyMenuTemplate(actorId: string) {
  const sample = await prisma.dish.findMany({
    where: { active: true, restaurant: { active: true } },
    take: 2,
    orderBy: { createdAt: 'asc' },
    include: { restaurant: { select: { code: true, name: true } } },
  });

  const headers = ['Day', 'Restaurant code', 'Restaurant name', 'Dish code', 'Dish name', 'Price (RM)', 'Capacity'];

  const rows =
    sample.length > 0
      ? sample.map((d, i) => [
          i === 0 ? 'Mon' : 'Tue',
          d.restaurant.code ?? '',
          d.restaurant.name,
          d.code ?? '',
          d.name,
          csvAmount(d.priceSen),
          '',
        ])
      : [
          ['Mon', 'R-001', 'Example Restaurant', 'D-001', 'Example Dish', '12.50', ''],
          ['Mon', 'R-001', 'Example Restaurant', 'D-002', 'Another Dish', '10.00', '50'],
        ];

  const csv = toCsv(headers, rows);
  await audit(actorId, 'export.weekly_menu_template', 'MenuCycle', null, {});
  return csvResponse('weekly-menu-template.csv', csv);
}

async function exportKitchenEmployees(actorId: string, cycleId: string | null) {
  if (!cycleId) return NextResponse.json({ error: 'Missing cycle' }, { status: 400 });

  const cycle = await prisma.menuCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  // One row per employee per dish per service date — the full per-person breakdown
  // the kitchen can use to check off individual orders on delivery day.
  const items = await prisma.orderItem.findMany({
    where: { order: { cycleId, status: 'PAID' } },
    orderBy: [
      { serviceDate: 'asc' },
      { restaurantName: 'asc' },
      { dishName: 'asc' },
      { order: { user: { name: 'asc' } } },
    ],
    select: {
      serviceDate: true,
      restaurantName: true,
      dishName: true,
      quantity: true,
      order: {
        select: {
          user: { select: { name: true, staffId: true, department: true } },
          deliverySite: { select: { name: true } },
        },
      },
    },
  });

  const rows = items.map((i) => [
    toDateKey(i.serviceDate),
    i.restaurantName,
    i.dishName,
    i.quantity,
    i.order.user.staffId ?? '',
    i.order.user.name,
    i.order.user.department ?? '',
    i.order.deliverySite?.name ?? 'Unassigned',
  ]);

  const csv = toCsv(
    ['Service date', 'Restaurant', 'Dish', 'Qty', 'Staff ID', 'Name', 'Department', 'Delivery site'],
    rows,
  );

  await audit(actorId, 'export.kitchen_employees', 'MenuCycle', cycleId, { rows: rows.length });
  return csvResponse(`kitchen-employees-${toDateKey(cycle.serviceWeekStart)}.csv`, csv);
}

async function exportReconciliation(actorId: string, weeksRaw: string | null) {
  const weeks = clampWeeks(weeksRaw);
  const window = trailingWeeks(weeks);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] },
      cycle: { serviceWeekStart: { gte: window.from, lt: window.to } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 10000,
    select: {
      reference: true,
      status: true,
      grossSen: true,
      subsidySen: true,
      netSen: true,
      submittedAt: true,
      paidAt: true,
      user: { select: { name: true, staffId: true, department: true, email: true } },
      cycle: { select: { serviceWeekStart: true } },
      deliverySite: { select: { name: true } },
      items: { select: { dishName: true, quantity: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          status: true,
          amountSen: true,
          paymentId: true,
          requestId: true,
          paymentMethod: true,
          failureReason: true,
          createdAt: true,
        },
      },
    },
  });

  const rows = orders.map((o) => {
    const p = o.payments[0] ?? null;
    const mealSummary = o.items
      .map((i) => (i.quantity > 1 ? `${i.dishName} x${i.quantity}` : i.dishName))
      .join('; ');

    return [
      o.reference,
      formatWeekRange(o.cycle.serviceWeekStart),
      o.user.staffId ?? '',
      o.user.name,
      o.user.email ?? '',
      o.user.department ?? '',
      o.deliverySite?.name ?? 'Unassigned',
      mealSummary,
      o.status,
      csvAmount(o.grossSen),
      csvAmount(o.subsidySen),
      csvAmount(o.netSen),
      p?.status ?? '',
      csvAmount(p?.amountSen ?? 0),
      p?.paymentId ?? '',
      p?.requestId ?? '',
      p?.paymentMethod ?? '',
      p?.failureReason ?? '',
      o.submittedAt ? o.submittedAt.toISOString() : '',
      o.paidAt ? o.paidAt.toISOString() : '',
    ];
  });

  const csv = toCsv(
    [
      'Order reference',
      'Service week',
      'Staff ID',
      'Name',
      'Email',
      'Department',
      'Delivery site',
      'Meals ordered',
      'Order status',
      'Food total (RM)',
      'Subsidy (RM)',
      'Staff paid (RM)',
      'Payment status',
      'Amount charged (RM)',
      'HitPay payment ID',
      'HitPay request ID',
      'Payment method',
      'Failure reason',
      'Submitted at (UTC)',
      'Paid at (UTC)',
    ],
    rows,
  );

  await audit(actorId, 'export.reconciliation', 'Report', null, { weeks, rows: rows.length });
  return csvResponse(`reconciliation-last-${weeks}-weeks.csv`, csv);
}
