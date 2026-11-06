'use server';

import { assertCapability } from '@/lib/session';
import { processRefund } from '@/lib/refund';
import { prisma } from '@/lib/prisma';

export type BulkRefundItemResult = {
  orderId: string;
  reference: string;
  ok: boolean;
  refundId?: string;
  error?: string;
};

export type BulkRefundResult =
  | { ok: false; error: string }
  | { ok: true; total: number; succeeded: number; failed: number; results: BulkRefundItemResult[] };

export async function bulkRefundOrders(orderIds: string[]): Promise<BulkRefundResult> {
  const actor = await assertCapability('menu:plan');

  if (orderIds.length === 0) {
    return { ok: true, total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds }, status: { in: ['PAID', 'REFUND_PENDING'] } },
    select: { id: true, reference: true },
  });

  const refundResults = await Promise.allSettled(
    orders.map((o) => processRefund(o.id, actor.id, 'Admin bulk refund')),
  );

  const results: BulkRefundItemResult[] = orders.map((o, i) => {
    const r = refundResults[i];
    if (r.status === 'fulfilled' && r.value.ok) {
      return { orderId: o.id, reference: o.reference, ok: true, refundId: r.value.refundId };
    }
    const error =
      r.status === 'rejected'
        ? String(r.reason)
        : !r.value.ok
          ? r.value.error
          : 'Unknown error';
    return { orderId: o.id, reference: o.reference, ok: false, error };
  });

  return {
    ok: true,
    total: orders.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
