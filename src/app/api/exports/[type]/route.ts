import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/rbac';
import { csvAmount, csvResponse, toCsv } from '@/lib/csv';
import { formatWeekRange, toDateKey } from '@/lib/cycle';
import { kitchenSheet, trailingWeeks, weeklyTotals } from '@/lib/reporting';
import { audit } from '@/lib/orders';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * CSV exports for Finance and Kitchen.
 *
 * These files contain employee names and staff IDs. They are personal data:
 * store them on approved systems only and do not forward them outside
 * Finance/HR.
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

  switch (type) {
    case 'orders':
      return exportOrders(user.id, cycleId);
    case 'payments':
      return exportPayments(user.id, cycleId);
    case 'subsidy':
      return exportSubsidy(user.id, url.searchParams.get('weeks'));
    case 'kitchen':
      return exportKitchen(user.id, cycleId);
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
