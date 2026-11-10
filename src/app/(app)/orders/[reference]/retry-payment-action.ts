'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { createPaymentRequest } from '@/lib/hitpay';
import { getEntityCredentials } from '@/lib/entity-config';
import { formatWeekRange } from '@/lib/cycle';
import type { ActionState } from '@/components/action-form';

export type RetryPaymentResult = ActionState & {
  checkoutUrl?: string;
};

/**
 * Create a fresh HitPay payment request for an existing AWAITING_PAYMENT order.
 * Called when the user retries after a timeout/expiry.
 */
export async function retryPayment(reference: string): Promise<RetryPaymentResult> {
  const user = await assertCapability('order:place');

  const order = await prisma.order.findFirst({
    where: { reference, userId: user.id, status: 'AWAITING_PAYMENT' },
    include: {
      cycle: true,
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!order) {
    return { error: 'Order not found or already paid.' };
  }

  const entityId = order.entityId ?? 'trading';

  const appBase = (
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null) ??
    'http://localhost:3000'
  ).replace(/\/$/, '');

  void appBase; // used by other gateways; kept for parity
  const paymentEmail = user.email ?? order.payments?.[0]?.receiptEmail ?? '';

  let checkoutUrl!: string;
  let requestId: string | undefined;

  try {
    const creds = await getEntityCredentials(entityId);
    const request = await createPaymentRequest({
      amountSen: order.netSen,
      reference: order.reference,
      purpose:   `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
      email:     paymentEmail,
      name:      user.name,
      credentials: creds,
    });
    checkoutUrl = request.url;
    requestId   = request.id;

    await prisma.payment.create({
      data: {
        orderId:      order.id,
        requestId,
        status:       'PENDING',
        amountSen:    order.netSen,
        currency:     'MYR',
        checkoutUrl,
        receiptEmail: paymentEmail,
        provider:     `hitpay_${entityId}`,
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[retryPayment] Gateway error:', msg);
    return { error: `Could not reach the payment gateway: ${msg}` };
  }

  if (user.embed) {
    return { checkoutUrl };
  }

  redirect(checkoutUrl);
}
