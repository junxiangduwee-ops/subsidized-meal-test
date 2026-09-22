import 'server-only';

import { prisma } from './prisma';
import { toDateKey } from './cycle';

/**
 * Reception's view of a weekly cycle: for every (delivery site, service
 * date) pair that has at least one PAID order, how many meals/orders are
 * expected there, and which restaurants they're coming from. This is the
 * same slice of data `kitchenSheet` uses (see lib/reporting.ts) grouped a
 * different way - by site and day rather than by restaurant and dish -
 * because reception cares about *where* food is due and *who it's coming
 * from*, not what's in it dish-by-dish.
 *
 * Confirmation status is deliberately not joined in here: this function
 * only answers "what's expected", and the reception page overlays whatever
 * DeliveryConfirmation rows exist on top of it. Keeping the two separate
 * means an order placed/cancelled after a site was confirmed doesn't
 * retroactively rewrite what reception already attested to - see
 * DeliveryConfirmation.expectedMeals/expectedOrders in schema.prisma.
 */
export type DeliverySiteDayRestaurant = {
  restaurantName: string;
  quantity: number;
};

export type DeliverySiteDay = {
  deliverySiteId: string;
  deliverySiteName: string;
  serviceDate: Date;
  mealCount: number;
  orderCount: number;
  /** Meals expected from each restaurant that day, most meals first. */
  restaurants: DeliverySiteDayRestaurant[];
};

/**
 * `options.deliverySiteId` scopes the query to one site - used for a
 * reception account restricted to a single site (User.receptionSiteId), so
 * their page never even fetches rows for a site they can't act on.
 */
export async function deliverySiteSheet(
  cycleId: string,
  options?: { deliverySiteId?: string },
): Promise<DeliverySiteDay[]> {
  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        cycleId,
        status: 'PAID',
        ...(options?.deliverySiteId ? { deliverySiteId: options.deliverySiteId } : {}),
      },
    },
    select: {
      orderId: true,
      quantity: true,
      serviceDate: true,
      restaurantName: true,
      order: { select: { deliverySiteId: true, deliverySite: { select: { name: true } } } },
    },
  });

  type Row = {
    deliverySiteId: string;
    deliverySiteName: string;
    serviceDate: Date;
    mealCount: number;
    orderIds: Set<string>;
    restaurantCounts: Map<string, number>;
  };

  const map = new Map<string, Row>();

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
      restaurantCounts: new Map<string, number>(),
    };
    row.mealCount += item.quantity;
    row.orderIds.add(item.orderId);
    row.restaurantCounts.set(
      item.restaurantName,
      (row.restaurantCounts.get(item.restaurantName) ?? 0) + item.quantity,
    );
    map.set(key, row);
  }

  return [...map.values()]
    .map((r) => ({
      deliverySiteId: r.deliverySiteId,
      deliverySiteName: r.deliverySiteName,
      serviceDate: r.serviceDate,
      mealCount: r.mealCount,
      orderCount: r.orderIds.size,
      restaurants: [...r.restaurantCounts.entries()]
        .map(([restaurantName, quantity]) => ({ restaurantName, quantity }))
        .sort((a, b) => b.quantity - a.quantity || a.restaurantName.localeCompare(b.restaurantName)),
    }))
    .sort(
      (a, b) =>
        a.deliverySiteName.localeCompare(b.deliverySiteName) ||
        toDateKey(a.serviceDate).localeCompare(toDateKey(b.serviceDate)),
    );
}

/**
 * The one delivery site this person is confined to, or null if they can
 * see/act on every site. Only ever non-null for a RECEPTION account with
 * User.receptionSiteId set - looked up fresh (not carried in the session
 * JWT) so an admin narrowing someone's assignment takes effect immediately,
 * the same way a role change does.
 */
export async function receptionSiteRestriction(userId: string): Promise<{ id: string; name: string } | null> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, receptionSiteId: true, receptionSite: { select: { id: true, name: true } } },
  });
  if (me?.role !== 'RECEPTION' || !me.receptionSite) return null;
  return me.receptionSite;
}

/** Photo proof: keep the DB row reasonable and the upload fast on a warehouse wifi. */
export const DELIVERY_PHOTO_MAX_BYTES = 3 * 1024 * 1024; // 3MB raw file (~4MB once base64-encoded)
export const DELIVERY_PHOTO_ACCEPT = 'image/*';
