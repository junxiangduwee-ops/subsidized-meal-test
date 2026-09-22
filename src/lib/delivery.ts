import 'server-only';

import { prisma } from './prisma';
import { toDateKey } from './cycle';

/**
 * Reception's view of a weekly cycle: for every (delivery site, service
 * date) pair that has at least one PAID order, how many meals/orders are
 * expected there. This is the same slice of data `kitchenSheet` uses (see
 * lib/reporting.ts) grouped a different way - by site and day rather than
 * by restaurant and dish - because reception cares about *where* food is
 * due, not what's in it.
 *
 * Confirmation status is deliberately not joined in here: this function
 * only answers "what's expected", and the reception page overlays whatever
 * DeliveryConfirmation rows exist on top of it. Keeping the two separate
 * means an order placed/cancelled after a site was confirmed doesn't
 * retroactively rewrite what reception already attested to - see
 * DeliveryConfirmation.expectedMeals/expectedOrders in schema.prisma.
 */
export type DeliverySiteDay = {
  deliverySiteId: string;
  deliverySiteName: string;
  serviceDate: Date;
  mealCount: number;
  orderCount: number;
};

export async function deliverySiteSheet(cycleId: string): Promise<DeliverySiteDay[]> {
  const items = await prisma.orderItem.findMany({
    where: { order: { cycleId, status: 'PAID' } },
    select: {
      orderId: true,
      quantity: true,
      serviceDate: true,
      order: { select: { deliverySiteId: true, deliverySite: { select: { name: true } } } },
    },
  });

  const map = new Map<
    string,
    {
      deliverySiteId: string;
      deliverySiteName: string;
      serviceDate: Date;
      mealCount: number;
      orderIds: Set<string>;
    }
  >();

  for (const item of items) {
    // Orders placed before validateForCheckout required a delivery site (or
    // seeded without one) have no site to attribute this meal to - nothing
    // for reception to confirm against, so they're excluded rather than
    // bucketed under a fake "Unassigned" row.
    if (!item.order.deliverySiteId) continue;

    const key = `${item.order.deliverySiteId}|${toDateKey(item.serviceDate)}`;
    const row = map.get(key) ?? {
      deliverySiteId: item.order.deliverySiteId,
      deliverySiteName: item.order.deliverySite?.name ?? 'Unknown site',
      serviceDate: item.serviceDate,
      mealCount: 0,
      orderIds: new Set<string>(),
    };
    row.mealCount += item.quantity;
    row.orderIds.add(item.orderId);
    map.set(key, row);
  }

  return [...map.values()]
    .map((r) => ({
      deliverySiteId: r.deliverySiteId,
      deliverySiteName: r.deliverySiteName,
      serviceDate: r.serviceDate,
      mealCount: r.mealCount,
      orderCount: r.orderIds.size,
    }))
    .sort(
      (a, b) =>
        a.deliverySiteName.localeCompare(b.deliverySiteName) ||
        toDateKey(a.serviceDate).localeCompare(toDateKey(b.serviceDate)),
    );
}

/** Photo proof: keep the DB row reasonable and the upload fast on a warehouse wifi. */
export const DELIVERY_PHOTO_MAX_BYTES = 3 * 1024 * 1024; // 3MB raw file (~4MB once base64-encoded)
export const DELIVERY_PHOTO_ACCEPT = 'image/*';
