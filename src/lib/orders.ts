import 'server-only';

import { randomBytes } from 'node:crypto';
import type { Order, Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { isOrderingOpen, toDateKey } from './cycle';
import { calculateSubsidy, type SubsidyLineInput } from './subsidy';

/** Statuses that hold a portion against a menu item's capacity. */
const COMMITTED_STATUSES = ['AWAITING_PAYMENT', 'PAID'] as const;

export function newOrderReference(): string {
  const d = new Date();
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
  return `MRD-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function getOrCreateCart(userId: string, cycleId: string): Promise<Order> {
  const existing = await prisma.order.findFirst({
    where: { userId, cycleId, status: 'CART' },
  });
  if (existing) return existing;

  return prisma.order.create({
    data: { userId, cycleId, reference: newOrderReference(), status: 'CART' },
  })
}

/** Portions already committed for a menu item by everyone. */
export async function committedQuantity(
  menuItemId: string,
  excludeOrderId?: string,
): Promise<number> {
  const agg = await prisma.orderItem.aggregate({
    _sum: { quantity: true },
    where: {
      menuItemId,
      orderId: excludeOrderId ? { not: excludeOrderId } : undefined,
      order: { status: { in: [...COMMITTED_STATUSES] } },
    },
  });
  return agg._sum.quantity ?? 0;
}

export async function remainingCapacity(
  menuItemId: string,
  excludeOrderId?: string,
): Promise<number | null> {
  const item = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { capacity: true },
  });
  if (!item || item.capacity == null) return null; // unlimited
  return Math.max(0, item.capacity - (await committedQuantity(menuItemId, excludeOrderId)));
}

/**
 * Remaining capacity for many menu items in one query.
 *
 * `null` means unlimited. Pass the viewer's own order id so their existing
 * lines are not counted against the allowance they are about to change.
 */
export async function remainingCapacityMap(
  items: Array<{ id: string; capacity: number | null }>,
  excludeOrderId?: string,
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  for (const item of items) map.set(item.id, null);

  const capped = items.filter((i) => i.capacity != null);
  if (capped.length === 0) return map;

  const rows = await prisma.orderItem.groupBy({
    by: ['menuItemId'],
    where: {
      menuItemId: { in: capped.map((i) => i.id) },
      orderId: excludeOrderId ? { not: excludeOrderId } : undefined,
      order: { status: { in: [...COMMITTED_STATUSES] } },
    },
    _sum: { quantity: true },
  });

  const used = new Map(rows.map((r) => [r.menuItemId, r._sum.quantity ?? 0]));
  for (const item of capped) {
    map.set(item.id, Math.max(0, item.capacity! - (used.get(item.id) ?? 0)));
  }
  return map;
}

export type CartMutationResult = { ok: true } | { ok: false; error: string };

/**
 * How many meals one person may order for a single service day.
 *
 * The rule is enforced here rather than in the UI, so it holds for every
 * caller. Raising this alone will not enable multi-meal ordering - the
 * ordering screen is a single-choice control by design - but it keeps the
 * constraint in one named place.
 */
export const MEALS_PER_DAY = 1;

/**
 * Choose the meal for one service day.
 *
 * Selecting a dish replaces whatever was previously chosen for that date:
 * one person, one meal per day. Idempotent - re-selecting the same dish is
 * a no-op rather than an error.
 */
export async function selectMeal(userId: string, menuItemId: string): Promise<CartMutationResult> {
  const menuItem = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    include: {
      dish: { include: { restaurant: true } },
      menuDay: { include: { cycle: true } },
    },
  });
  if (!menuItem) return { ok: false, error: 'That dish is no longer on the menu.' };

  const cycle = menuItem.menuDay.cycle;
  if (!isOrderingOpen(cycle)) {
    return { ok: false, error: 'Ordering for that week is not open.' };
  }

  const lockedSameDay = await prisma.orderItem.findFirst({
    where: {
      serviceDate: menuItem.menuDay.serviceDate,
      order: { userId, cycleId: cycle.id, status: { not: 'CART' } },
    },
  });

  if (lockedSameDay) {
    return { ok: false, error: 'Your order for this day has already been submitted.' }
  }

  const order = await getOrCreateCart(userId, cycle.id);

  if (menuItem.capacity != null) {
    const others = await committedQuantity(menuItemId, order.id);
    if (others + MEALS_PER_DAY > menuItem.capacity) {
      return { ok: false, error: 'That dish is sold out for the day.' };
    }
  }

  const gross = menuItem.priceSen * MEALS_PER_DAY;

  await prisma.$transaction([
    // One meal per day: anything else already chosen for this date makes way.
    prisma.orderItem.deleteMany({
      where: {
        orderId: order.id,
        serviceDate: menuItem.menuDay.serviceDate,
        NOT: { menuItemId },
      },
    }),
    prisma.orderItem.upsert({
      where: { orderId_menuItemId: { orderId: order.id, menuItemId } },
      create: {
        orderId: order.id,
        menuItemId,
        quantity: MEALS_PER_DAY,
        unitPriceSen: menuItem.priceSen,
        grossSen: gross,
        subsidySen: 0,
        netSen: gross,
        serviceDate: menuItem.menuDay.serviceDate,
        dishName: menuItem.dish.name,
        restaurantName: menuItem.dish.restaurant.name,
      },
      update: {
        quantity: MEALS_PER_DAY,
        unitPriceSen: menuItem.priceSen,
        grossSen: gross,
      },
    }),
  ]);

  await repriceOrder(order.id);
  return { ok: true };
}

/** Drop the meal chosen for a day, leaving that day unordered. */
export async function clearMeal(userId: string, menuItemId: string): Promise<CartMutationResult> {
  const menuItem = await prisma.menuItem.findUnique({
    where: { id: menuItemId },
    select: { menuDay: { select: { cycle: true } } },
  });
  if (!menuItem) return { ok: false, error: 'That dish is no longer on the menu.' };

  const cycle = menuItem.menuDay.cycle;
  if (!isOrderingOpen(cycle)) {
    return { ok: false, error: 'Ordering for that week is not open.' };
  }

  const order = await prisma.order.findFirst({
    where: { userId, cycleId: cycle.id, status: 'CART' },
  });
  if (!order) return { ok: true };

  await prisma.orderItem.deleteMany({ where: { orderId: order.id, menuItemId } });
  await repriceOrder(order.id);
  return { ok: true };
}

/**
 * Recompute subsidy and totals for an order from its current lines.
 * Called after every cart mutation and again at checkout.
 */
export async function repriceOrder(orderId: string): Promise<Order> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, user: { select: { department: true } } },
  });

  const rules = await prisma.subsidyRule.findMany({ where: { active: true } });

  const inputs: SubsidyLineInput[] = order.items.map((i) => ({
    key: i.id,
    serviceDate: i.serviceDate,
    unitPriceSen: i.unitPriceSen,
    quantity: i.quantity,
  }));

  const outcome = calculateSubsidy(inputs, rules, order.user.department);
  const byKey = new Map(outcome.lines.map((l) => [l.key, l]));

  await prisma.$transaction([
    ...order.items.map((item) => {
      const line = byKey.get(item.id)!;
      return prisma.orderItem.update({
        where: { id: item.id },
        data: {
          grossSen: line.grossSen,
          subsidySen: line.subsidySen,
          netSen: line.netSen,
        },
      });
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        grossSen: outcome.grossSen,
        subsidySen: outcome.subsidySen,
        netSen: outcome.netSen,
        subsidySnapshot: outcome.snapshot as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

export type CheckoutValidation = { ok: true } | { ok: false; error: string };

export async function setDeliverySite(
  userId: string,
  cycleId: string,
  deliverySiteId: string,
): Promise<CartMutationResult> {
  const site = await prisma.deliverySite.findUnique({ where: { id: deliverySiteId } });
  if (!site || !site.active) return { ok: false, error: 'That delivery site is not available.' };

  const order = await prisma.order.findFirst({ where: { userId, cycleId, status: 'CART' } });
  if (!order) return { ok: false, error: 'Add a meal to your cart first.' };

  await prisma.order.update({ where: { id: order.id }, data: { deliverySiteId } });
  return { ok: true };
}

/** Re-run every guard immediately before money is involved. */
export async function validateForCheckout(orderId: string): Promise<CheckoutValidation> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, cycle: true },
  });
  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.status !== 'CART')
    return { ok: false, error: 'This order has already been submitted.' };
  if (order.items.length === 0) return { ok: false, error: 'Your cart is empty.' };
  if (!order.deliverySiteId) return { ok: false, error: 'Choose a delivery site before paying.' };
  if (!isOrderingOpen(order.cycle)) return { ok: false, error: 'The ordering window has closed.' };

  // One meal per day, re-checked here so a cart built before the rule
  // changed - or by anything other than selectMeal - cannot slip through.
  const perDay = new Map<string, number>();
  for (const item of order.items) {
    const key = toDateKey(item.serviceDate);
    perDay.set(key, (perDay.get(key) ?? 0) + item.quantity);
  }
  for (const [key, count] of perDay) {
    if (count > MEALS_PER_DAY) {
      return {
        ok: false,
        error: `Only ${MEALS_PER_DAY} meal per day is allowed, but ${count} are selected for ${key}. Remove the extras and try again.`,
      };
    }
  }

  for (const item of order.items) {
    const menuItem = await prisma.menuItem.findUnique({
      where: { id: item.menuItemId },
      select: { capacity: true },
    });
    if (!menuItem) return { ok: false, error: `"${item.dishName}" is no longer on the menu.` };
    if (menuItem.capacity != null) {
      const others = await committedQuantity(item.menuItemId, order.id);
      if (others + item.quantity > menuItem.capacity) {
        return { ok: false, error: `"${item.dishName}" sold out while you were ordering.` };
      }
    }
  }

  return { ok: true };
}

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { actorId, action, entityType, entityId: entityId ?? null, metadata },
  });
}
