'use server';

import { requireUser } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { queueRefundRequest, canUserCancelOrder } from '@/lib/refund';
import { prisma } from '@/lib/prisma';

export type UserCancelResult =
  | { ok: true }
  | { ok: false; error: string };

export async function userCancelOrder(orderId: string): Promise<UserCancelResult> {
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      status: true,
      reference: true,
      cycle: { select: { orderOpenAt: true, orderCutoffAt: true } },
    },
  });

  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.userId !== user.id) return { ok: false, error: 'You can only cancel your own orders.' };

  const settings = await getSiteSettings();
  const check = canUserCancelOrder({ status: order.status }, settings, order.cycle);
  if (!check.allowed) {
    return { ok: false, error: check.reason ?? 'Cancellation is not allowed.' };
  }

  return queueRefundRequest(orderId, user.id, 'Cancelled by employee');
}
