import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

import { Prisma } from '@prisma/client';
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
  if (type === 'vendor-orders' && !can(user.role, 'kitchen:view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (type === 'admin-orders' && !can(user.role, 'kitchen:view')) {
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
  if (type === 'audit' && !can(user.role, 'settings:manage')) {
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
    case 'vendor-orders':
      return exportVendorOrders(user.id, cycleId, url.searchParams.get('vendor'));
    case 'admin-orders':
      return exportAdminOrders(user.id, cycleId);
    case 'kitchen':
      return exportKitchen(user.id, cycleId);
    case 'kitchen-employees':
      return exportKitchenEmployees(user.id, cycleId);
    case 'reconciliation':
      return exportReconciliation(user.id, url.searchParams.get('weeks'), url.searchParams.get('cycle'));
    case 'audit':
      return exportAudit(user.id, url.searchParams);
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
      user: { select: { staffId: true } },
      cycle: { select: { serviceWeekStart: true } },
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const rows = orders.map((o) => [
    o.user.staffId ?? '',
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
      'Staff ID',
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

async function exportReconciliation(actorId: string, weeksRaw: string | null, cycleId: string | null = null) {
  // If a specific cycleId is provided, export just that service week.
  // Otherwise fall back to the trailing-weeks window.
  const byCycle = Boolean(cycleId);
  const weeks = clampWeeks(weeksRaw);
  const window = trailingWeeks(weeks);

  const whereFilter = byCycle
    ? { cycleId: cycleId! }
    : { cycle: { serviceWeekStart: { gte: window.from, lt: window.to } } };

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['PAID', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED'] as ('PAID' | 'AWAITING_PAYMENT' | 'CANCELLED' | 'REFUNDED')[] },
      ...whereFilter,
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

  // Fetch cycle label for filename when exporting by cycle
  let filenameLabel = `last-${weeks}-weeks`;
  let auditMeta: Prisma.JsonObject = { weeks, rows: rows.length };
  if (byCycle && cycleId) {
    const cycle = await prisma.menuCycle.findUnique({
      where: { id: cycleId },
      select: { serviceWeekStart: true },
    });
    if (cycle) {
      filenameLabel = toDateKey(cycle.serviceWeekStart);
      auditMeta = { cycleId, serviceWeek: filenameLabel, rows: rows.length };
    }
  }
  await audit(actorId, 'export.reconciliation', 'Report', cycleId, auditMeta);
  return csvResponse(`reconciliation-${filenameLabel}.csv`, csv);
}

async function exportAudit(actorId: string, params: URLSearchParams) {
  const toDate   = params.get('to')   ? new Date(params.get('to')! + 'T23:59:59Z')   : new Date();
  const fromDate = params.get('from') ? new Date(params.get('from')! + 'T00:00:00Z') : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const category = params.get('category') ?? '';
  const q = params.get('q')?.trim() ?? '';

  const CATEGORY_PREFIXES: Record<string, string[]> = {
    Orders:   ['order.', 'meal.'],
    Payments: ['payment.'],
    Exports:  ['export.'],
    Cycles:   ['cycle.', 'menuitem.'],
    Delivery: ['delivery.'],
    Users:    ['user.', 'auth.'],
    Settings: ['settings.', 'subsidy.', 'dish.', 'restaurant.', 'delivery_site.'],
  };

  const prefixes = category ? (CATEGORY_PREFIXES[category] ?? []) : [];

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: fromDate, lte: toDate },
    ...(prefixes.length > 0
      ? { OR: prefixes.map((p) => ({ action: { startsWith: p } })) }
      : {}),
  };

  if (q) {
    const matchingUsers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { staffId: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    where.OR = [
      ...(matchingUsers.length > 0 ? [{ actorId: { in: matchingUsers.map((u) => u.id) } }] : []),
      { entityId: { contains: q, mode: 'insensitive' } },
    ];
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50000,
    include: { actor: { select: { name: true, staffId: true, role: true } } },
  });

  const rows = logs.map((log) => [
    log.createdAt.toISOString(),
    log.actor?.name ?? 'System',
    log.actor?.staffId ?? '',
    log.actor?.role ?? '',
    log.action,
    log.entityType,
    log.entityId ?? '',
    JSON.stringify(log.metadata ?? {}),
  ]);

  const csv = toCsv(
    ['Timestamp (UTC)', 'Actor', 'Staff ID', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Metadata'],
    rows,
  );

  await audit(actorId, 'export.audit', 'AuditLog', null, { rows: rows.length, from: fromDate.toISOString(), to: toDate.toISOString() } as Prisma.JsonObject);
  return csvResponse(`audit-log-${toDateKey(fromDate)}-to-${toDateKey(toDate)}.csv`, csv);
}

// ── Shared constant ───────────────────────────────────────────────────────────

const WH_ORDER = [
  'Warehouse A', 'Warehouse B', 'Warehouse H', 'Warehouse P',
  'Warehouse Q', 'Warehouse X3', 'Warehouse Y1', 'Warehouse Y2',
  'Mines 2 Office (International)', 'Training Academy (X4)',
];

// ── VENDOR EXPORT (fixed) ────────────────────────────────────────────────────
// Exact format of PAKLOONG_19102026-23102026_1.xlsx
async function exportVendorOrders(
  actorId: string,
  cycleId: string | null,
  vendor: string | null,
) {
  if (!cycleId) return NextResponse.json({ error: 'Missing cycle' }, { status: 400 });
  if (!vendor)  return NextResponse.json({ error: 'Missing vendor' }, { status: 400 });

  const cycle = await prisma.menuCycle.findUnique({
    where: { id: cycleId },
    select: { serviceWeekStart: true },
  });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  const items = await prisma.orderItem.findMany({
    where: {
      order: { cycleId, status: 'PAID' },
      restaurantName: { equals: vendor, mode: 'insensitive' },
    },
    orderBy: [
      { serviceDate: 'asc' },
      { order: { deliverySite: { name: 'asc' } } },
      { order: { user: { name: 'asc' } } },
    ],
    select: {
      serviceDate: true,
      dishName: true,
      quantity: true,
      order: {
        select: {
          user: { select: { name: true, department: true } },
          deliverySite: { select: { name: true } },
          payments: {
            where: { status: 'SUCCEEDED' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { provider: true },
          },
        },
      },
    },
  });

  type ERow = {
    serviceDate: Date; dishName: string; company: string;
    name: string; department: string; warehouse: string;
  };

  const entities = await prisma.entity.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } });
  const entityNameMap = new Map(entities.map((e) => [e.code, e.name]));
  const CO_ORDER = entities.map((e) => e.name);

  function companyFromProvider(p: string): string {
    const code = p.split('_').slice(1).join('_').toLowerCase();
    return entityNameMap.get(code) ?? p;
  }

  // Expand by quantity
  const expanded: ERow[] = [];
  for (const item of items) {
    const base: ERow = {
      serviceDate: item.serviceDate,
      dishName:    item.dishName,
      company:     companyFromProvider(item.order.payments[0]?.provider ?? 'hitpay_trading'),
      name:        item.order.user.name,
      department:  item.order.user.department ?? '',
      warehouse:   item.order.deliverySite?.name ?? 'Unassigned',
    };
    for (let q = 0; q < item.quantity; q++) expanded.push(base);
  }

  // Sort: warehouse order then name
  expanded.sort((a, b) => {
    const wa = WH_ORDER.indexOf(a.warehouse); const wb_ = WH_ORDER.indexOf(b.warehouse);
    const ia = wa === -1 ? 99 : wa;          const ib = wb_ === -1 ? 99 : wb_;
    return ia !== ib ? ia - ib : a.name.localeCompare(b.name);
  });

  // Group by service date
  const byDay = new Map<string, ERow[]>();
  for (const row of expanded) {
    const key = toDateKey(row.serviceDate);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(row);
  }

  const wb = XLSX.utils.book_new();

  for (const [dateKey, dayRows] of [...byDay.entries()].sort()) {
    const nData  = dayRows.length;
    const nWH    = WH_ORDER.length;   // 10 warehouses → TOTAL at row nWH+2 (row 12 when header=1)
    const nCO    = CO_ORDER.length;   // 4 companies  → TOTAL at row nCO+2  (row 6  when header=1)
    const maxRows = Math.max(nData, nWH + 1, nCO + 1); // +1 for TOTAL row

    const ws: XLSX.WorkSheet = {};

    // ── Helper to set a cell ──────────────────────────────────────────────────
    function sc(addr: string, value: string | number | null, isFormula = false) {
      if (value === null) return;
      if (isFormula && typeof value === 'string') {
        ws[addr] = { t: 'n', f: value.replace(/^=/, ''), v: 0 };
      } else if (typeof value === 'number') {
        ws[addr] = { t: 'n', v: value };
      } else {
        ws[addr] = { t: 's', v: value };
      }
    }

    // ── Row 1: Headers ────────────────────────────────────────────────────────
    sc('A1', 'No');
    sc('B1', '👤 Employee Company/Group :');
    sc('C1', '👤 Employee Full Name :');
    sc('D1', '🏢 Department :');
    sc('E1', 'Menu Listing');
    sc('F1', 'Warehouse to Pickup');
    sc('G1', 'Vendor');
    // H1: empty separator
    sc('I1', 'Warehouse');
    sc('J1', 'Qty');
    // K1: empty separator
    sc('L1', '👤 Employee Company/Group :');
    sc('M1', 'Qty');

    // Make summary headers bold
    for (const addr of ['I1', 'J1', 'L1', 'M1']) {
      if (ws[addr]) ws[addr].s = { font: { bold: true } };
    }

    // ── Data + Summary rows ───────────────────────────────────────────────────
    for (let i = 0; i < maxRows; i++) {
      const r = i + 2; // Excel row (1-indexed, +1 for header)
      const dr = dayRows[i]; // employee row (may be undefined)

      // Employee columns A–G
      if (dr) {
        sc(`A${r}`, i + 1);
        sc(`B${r}`, dr.company);
        sc(`C${r}`, dr.name);
        sc(`D${r}`, dr.department);
        sc(`E${r}`, dr.dishName);
        sc(`F${r}`, dr.warehouse);
        sc(`G${r}`, vendor);
      }

      // ── Warehouse summary (col I, J) ──
      // Rows 2–11: one per warehouse (10 warehouses)
      // Row 12: TOTAL with SUM(J2:J11)
      if (i < nWH) {
        sc(`I${r}`, WH_ORDER[i]);
        sc(`J${r}`, `COUNTIFS(F:F,I${r})`, true); // no leading = for f property
      } else if (i === nWH) {
        sc(`I${r}`, 'TOTAL');
        sc(`J${r}`, `SUM(J2:J${nWH + 1})`, true);
      }

      // ── Company summary (col L, M) ──
      // Rows 2–5: one per company (4 companies)
      // Row 6: TOTAL with SUM(M2:M5)
      if (i < nCO) {
        sc(`L${r}`, CO_ORDER[i]);
        sc(`M${r}`, `COUNTIFS(B$1:B$64417,L${r})`, true);
      } else if (i === nCO) {
        sc(`L${r}`, 'TOTAL');
        sc(`M${r}`, `SUM(M2:M${nCO + 1})`, true);
      }

      // Yellow fill on Qty formula cells
      const jAddr = `J${r}`;
      const mAddr = `M${r}`;
      if (ws[jAddr]) ws[jAddr].s = { fill: { fgColor: { rgb: 'FFFF00' }, patternType: 'solid' } };
      if (ws[mAddr]) ws[mAddr].s = { fill: { fgColor: { rgb: 'FFFF00' }, patternType: 'solid' } };
    }

    // Set sheet ref
    const lastRow = maxRows + 1;
    ws['!ref'] = `A1:M${lastRow}`;

    // Column widths (exact match to template)
    ws['!cols'] = [
      { wch: 7.7 },   // A: No
      { wch: 32.1 },  // B: Company
      { wch: 27.9 },  // C: Name
      { wch: 43.6 },  // D: Dept
      { wch: 111.4 }, // E: Menu Listing
      { wch: 27.7 },  // F: Warehouse to Pickup
      { wch: 11.0 },  // G: Vendor
      { wch: 0 },     // H: hidden separator
      { wch: 27.7 },  // I: Warehouse summary
      { wch: 8.7 },   // J: Qty
      { wch: 0 },     // K: hidden separator
      { wch: 34.9 },  // L: Company summary
      { wch: 8.7 },   // M: Qty
    ];

    const sheetName = dateKey.replace(/-/g, '');
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const vendorSlug = vendor.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const weekKey    = toDateKey(cycle.serviceWeekStart).replace(/-/g, '');

  await audit(actorId, 'export.vendor_orders', 'MenuCycle', cycleId, { vendor, rows: items.length });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${vendorSlug}-${weekKey}.xlsx"`,
    },
  });
}

// ── ADMIN EXPORT ────────────────────────────────────────────────────────────
// Exact format of 19102026-23102026_V2_1.xlsx:
//
// Sheet 1 "New Lunch Subsidy V3" — one row per order (form submission):
//   Col 1:  Date (payment submission date)
//   Col 2-11: Mon/Tue/Wed/Thu/Fri menu + vendor pick (blank if no order that day)
//   Col 12: Total weekly subsidy (RM)
//   Col 13: Payment method | Col 14: Payment account | Col 15: Payment date
//   Col 16: Transaction ref | Col 17: Receipt URL
//   Col 18: Name | Col 19: Staff ID | Col 20: Email | Col 21: Dept | Col 22: Warehouse
//   Col 23-35: Quiz Score, Ref ID, IP, Country, Amt, Currency, Completed, Coupons,
//              Browser, Referrer, Form Host, Entry ID, Status
//
// Sheets 2-6 "Mon"/"Tues"/"Wed"/"Thurs"/"Fri" — one row per order that ordered that day:
//   Col 1: Date | Col 2: That day's menu | Col 3: That day's vendor
//   Col 4: Daily amount (RM4) | Col 5: Total weekly subsidy
//   Col 6-10: Payment method/account/date/ref/receipt
//   Col 11-15: Name/StaffID/Email/Dept/Warehouse
//   Col 16-29: Quiz Score, Ref ID, IP, Country, Amt, Currency, Completed,
//               Coupons, Browser, Referrer, Form Host, Entry ID, Status, Chargeback
async function exportAdminOrders(actorId: string, cycleId: string | null) {
  if (!cycleId) return NextResponse.json({ error: 'Missing cycle' }, { status: 400 });

  const cycle = await prisma.menuCycle.findUnique({
    where: { id: cycleId },
    select: { serviceWeekStart: true },
  });
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });

  // Fetch all PAID orders with items and payment
  const orders = await prisma.order.findMany({
    where: { cycleId, status: 'PAID' },
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, staffId: true, email: true, department: true } },
      deliverySite: { select: { name: true } },
      items: {
        orderBy: { serviceDate: 'asc' },
        select: { serviceDate: true, restaurantName: true, dishName: true, quantity: true },
      },
      payments: {
        where: { status: 'SUCCEEDED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { provider: true, paymentMethod: true, paymentId: true, requestId: true, createdAt: true },
      },
    },
  });

  // 5 service dates (Mon–Fri) from cycle start
  const serviceDates: Date[] = Array.from({ length: 5 }, (_, d) => {
    const date = new Date(cycle.serviceWeekStart);
    date.setUTCDate(date.getUTCDate() + d);
    return date;
  });
  const dayKeys  = serviceDates.map(d => toDateKey(d));
  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const tabNames = ['Mon', 'Tues', 'Wed', 'Thurs', 'Fri'];

  function fmtDate(d: Date | null | undefined): string {
    if (!d) return '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getUTCFullYear()}`;
  }

  const [exportEntities, exportCompanies] = await Promise.all([
    prisma.entity.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.companyInfo.findMany({ select: { entityId: true, bankName: true, bankAccountName: true, bankAccountNumber: true } }),
  ]);
  const exportEntityNameMap = new Map(exportEntities.map((e) => [e.code, e.name]));
  const bankMap = new Map<string, string>();
  for (const c of exportCompanies) {
    if (!bankMap.has(c.entityId) && c.bankAccountNumber) {
      bankMap.set(c.entityId, [c.bankAccountName, c.bankName, c.bankAccountNumber].filter(Boolean).join(' - '));
    }
  }

  function paymentAccount(provider: string): string {
    const code = provider.split('_').slice(1).join('_').toLowerCase();
    return bankMap.get(code) ?? exportEntityNameMap.get(code) ?? provider;
  }

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: "New Lunch Subsidy V3" ─────────────────────────────────────────
  const s1Headers = [
    'Date',
    `${dayNames[0]} (${fmtDate(serviceDates[0])}) Menu :`, `${dayNames[0]}'s Pick`,
    `${dayNames[1]} (${fmtDate(serviceDates[1])}) Menu :`, `${dayNames[1]}'s Pick`,
    `${dayNames[2]} (${fmtDate(serviceDates[2])}) Menu :`, `${dayNames[2]}'s Pick`,
    `${dayNames[3]} (${fmtDate(serviceDates[3])}) Menu :`, `${dayNames[3]}'s Pick`,
    `${dayNames[4]} (${fmtDate(serviceDates[4])}) Menu :`, `${dayNames[4]}'s Pick`,
    'Total Weekly Subsidy Lunch : - RM',
    '📲 1. Make Your Payment & Submit Transaction Details :',
    '💳2. Select Your Payment Account',
    '📅 3. Payment Date :',
    '🔢 4. Transaction Reference Number :',
    '📎 5. Attach a screenshot or saved copy of your successful transaction receipt.',
    '👤 Employee Full Name :',
    '🆔 Employee ID :',
    '📧 Email Address :',
    '🏢 Department :',
    '🏬 Select Your Warehouse for Pickup :',
    'Quiz Score', 'Reference ID', 'IP', 'Country',
    'Payment Amount', 'Payment Currency', 'Payment Completed',
    'Coupon codes', 'Browser', 'Referrer', 'Form Host', 'Entry ID', 'Status',
  ];

  const s1Rows: (string | number | null)[][] = [s1Headers];

  for (const order of orders) {
    const pmt = order.payments[0];
    const subsidyRm = order.subsidySen / 100;

    // Build day menu/pick columns (blank if no order that day)
    const dayMenuPick: (string | null)[] = [];
    for (const dk of dayKeys) {
      const dayItems = order.items.filter(i => toDateKey(i.serviceDate) === dk);
      if (dayItems.length === 0) {
        dayMenuPick.push(null, null);
      } else {
        dayMenuPick.push(
          dayItems.map(i => i.dishName).join('; '),
          [...new Set(dayItems.map(i => i.restaurantName))].join(', '),
        );
      }
    }

    s1Rows.push([
      fmtDate(pmt?.createdAt ?? cycle.serviceWeekStart), // submission date
      ...dayMenuPick,                                      // cols 2–11 (10 values)
      subsidyRm,                                          // col 12
      pmt?.paymentMethod ?? null,                         // col 13
      pmt ? paymentAccount(pmt.provider) : null,          // col 14
      pmt?.createdAt ? fmtDate(pmt.createdAt) : null,     // col 15
      pmt?.requestId ?? pmt?.paymentId ?? null,           // col 16
      null,  // col 17 receipt URL (not stored)
      order.user.name,                                    // col 18
      order.user.staffId ?? null,                         // col 19
      order.user.email ?? null,                           // col 20
      order.user.department ?? null,                      // col 21
      order.deliverySite?.name ?? null,                   // col 22
      null, null, null, null,  // cols 23-26 Quiz/RefID/IP/Country
      null, null,              // cols 27-28 Payment Amount/Currency
      'no',                    // col 29 Payment Completed
      null,                    // col 30 Coupon codes
      null, null, null,        // cols 31-33 Browser/Referrer/FormHost
      null,                    // col 34 Entry ID
      'Finished',              // col 35 Status
    ]);
  }

  const ws1 = XLSX.utils.aoa_to_sheet(s1Rows);
  ws1['!cols'] = [
    { wch: 18.1 }, // Date
    { wch: 38.4 }, // Mon menu
    { wch: 15.4 }, // Mon pick
    { wch: 17.9 }, // Tue menu
    { wch: 16.0 }, // Tue pick
    { wch: 14.0 }, // Wed menu
    { wch: 9.1 },  // Wed pick
    { wch: 28.3 }, // Thu menu
    { wch: 9.1 },  // Thu pick
    { wch: 98.3 }, // Fri menu
    { wch: 9.1 },  // Fri pick
    { wch: 9.1 },  // Total weekly
    { wch: 9.1 },  // Payment method
    { wch: 51.7 }, // Payment account
    { wch: 9.1 },  // Payment date
    { wch: 50.1 }, // Transaction ref
    { wch: 9.1 },  // Receipt
    { wch: 54.7 }, // Name
    { wch: 18.3 }, // Staff ID
    { wch: 9.1 },  // Email
    { wch: 9.1 },  // Dept
    { wch: 9.1 },  // Warehouse
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'New Lunch Subsidy V3');

  // ── Sheets 2–6: Daily tabs ──────────────────────────────────────────────────
  for (let di = 0; di < 5; di++) {
    const dayKey   = dayKeys[di];
    const dayName  = dayNames[di];
    const tabName  = tabNames[di];
    const svcDate  = serviceDates[di];

    const dailyHeaders = [
      'Date',
      `${dayName} (${fmtDate(svcDate)}) Menu :`,
      `${dayName}'s Vendor`,
      'Daily Amount: ',
      'Total Weekly Subsidy Lunch : - RM',
      '📲 1. Make Your Payment & Submit Transaction Details :',
      '💳2. Select Your Payment Account',
      '📅 3. Payment Date :',
      '🔢 4. Transaction Reference Number :',
      '📎 5. Attach a screenshot or saved copy of your successful transaction receipt.',
      '👤 Employee Full Name :',
      '🆔 Employee ID :',
      '📧 Email Address :',
      '🏢 Department :',
      '🏬 Select Your Warehouse for Pickup :',
      'Quiz Score', 'Reference ID', 'IP', 'Country',
      'Payment Amount', 'Payment Currency', 'Payment Completed',
      'Coupon codes', 'Browser', 'Referrer', 'Form Host', 'Entry ID', 'Status', 'Chargeback',
    ];

    const dailyRows: (string | number | null)[][] = [dailyHeaders];

    for (const order of orders) {
      // Only include this order if it has items for this day
      const dayItems = order.items.filter(i => toDateKey(i.serviceDate) === dayKey);
      if (dayItems.length === 0) continue;

      const pmt = order.payments[0];
      const subsidyRm = order.subsidySen / 100;
      const menuText   = dayItems.map(i => i.dishName).join('; ');
      const vendorText = [...new Set(dayItems.map(i => i.restaurantName))].join(', ');
      const dailyQty   = dayItems.reduce((s, i) => s + i.quantity, 0);
      const dailyAmt   = dailyQty * 4; // RM4 per meal

      dailyRows.push([
        fmtDate(pmt?.createdAt ?? cycle.serviceWeekStart), // col 1: submission date
        menuText,                                           // col 2: that day's menu
        vendorText,                                         // col 3: that day's vendor
        dailyAmt,                                           // col 4: daily amount (RM4 × qty)
        subsidyRm,                                          // col 5: total weekly subsidy
        pmt?.paymentMethod ?? null,                         // col 6
        pmt ? paymentAccount(pmt.provider) : null,          // col 7
        pmt?.createdAt ? fmtDate(pmt.createdAt) : null,     // col 8
        pmt?.requestId ?? pmt?.paymentId ?? null,           // col 9
        null,                                               // col 10: receipt URL
        order.user.name,                                    // col 11
        order.user.staffId ?? null,                         // col 12
        order.user.email ?? null,                           // col 13
        order.user.department ?? null,                      // col 14
        order.deliverySite?.name ?? null,                   // col 15
        null, null, null, null,  // cols 16-19 Quiz/RefID/IP/Country
        null, null,              // cols 20-21 Amt/Currency
        'no',                    // col 22 Payment Completed
        null,                    // col 23 Coupons
        null, null, null,        // cols 24-26 Browser/Referrer/FormHost
        null,                    // col 27 Entry ID
        'Finished',              // col 28 Status
        null,                    // col 29 Chargeback
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(dailyRows);
    ws['!cols'] = [
      { wch: 18.1 },  // Date
      { wch: 124.4 }, // Day menu
      { wch: 15.4 },  // Vendor
      { wch: 16.0 },  // Daily amount
      { wch: 9.1 },   // Total weekly
      { wch: 9.1 },   // Payment method
      { wch: 51.7 },  // Payment account
      { wch: 9.1 },   // Payment date
      { wch: 50.1 },  // Ref number
      { wch: 9.1 },   // Receipt
      { wch: 54.7 },  // Name
      { wch: 18.3 },  // Staff ID
      { wch: 9.1 },   // Email
      { wch: 9.1 },   // Dept
      { wch: 9.1 },   // Warehouse
      { wch: 9.1 },   // Quiz score
      { wch: 15.4 },  // Ref ID
      { wch: 9.1 },   // IP
      { wch: 9.1 },   // Country
      { wch: 9.1 },   // Amt
      { wch: 9.1 },   // Currency
      { wch: 9.1 },   // Completed
      { wch: 9.1 },   // Coupons
      { wch: 9.1 },   // Browser
      { wch: 9.1 },   // Referrer
      { wch: 9.1 },   // Form host
      { wch: 9.1 },   // Entry ID
      { wch: 9.1 },   // Status
      { wch: 35.4 },  // Chargeback
    ];
    XLSX.utils.book_append_sheet(wb, ws, tabName);
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
  const weekKey = toDateKey(cycle.serviceWeekStart).replace(/-/g, '');

  await audit(actorId, 'export.admin_orders', 'MenuCycle', cycleId, { rows: orders.length });

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="admin-orders-${weekKey}.xlsx"`,
    },
  });
}
