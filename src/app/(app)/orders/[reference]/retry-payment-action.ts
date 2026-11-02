'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { createPaymentRequest } from '@/lib/hitpay';
import { createBetterpayBill } from '@/lib/betterpay';
import { createAdaptisPayment } from '@/lib/adaptis';
import { getEntityCredentials, getBetterpayCredentials, getAdaptisCredentials, getGatewayType } from '@/lib/entity-config';
import { formatWeekRange } from '@/lib/cycle';
import type { ActionState } from '@/components/action-form';

export type RetryPaymentResult = ActionState & {
  checkoutUrl?: string;
  adaptisFormData?: Record<string, string>;
  adaptisPaymentUrl?: string;
};

/**
 * Create a fresh payment request for an existing AWAITING_PAYMENT order.
 * Called when the user retries after a timeout/expiry.
 */
export async function retryPayment(reference: string): Promise<RetryPaymentResult> {
  const user = await assertCapability('order:place');

  const order = await prisma.order.findFirst({
    where: { reference, userId: user.id, status: 'AWAITING_PAYMENT' },
    include: { cycle: true },
  });

  if (!order) {
    return { error: 'Order not found or already paid.' };
  }

  const entityId = order.entityId ?? 'retail';
  const gateway  = getGatewayType(entityId);

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

  const paymentEmail = user.email ?? order.payments?.[0]?.receiptEmail ?? '';

  let checkoutUrl!: string;
  let requestId: string | undefined;
  let adaptisFormData: Record<string, string> | undefined;
  let adaptisPaymentUrl: string | undefined;

  try {
    if (gateway === 'betterpay') {
      const creds = getBetterpayCredentials(entityId);
      const bill = await createBetterpayBill({
        amountSen: order.netSen,
        reference: order.reference,
        purpose:   `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email:     paymentEmail,
        name:      user.name ?? '',
        credentials: creds,
        callbackUrlBe:     `${appBase}/api/webhooks/betterpay`,
        callbackUrlFeSucc: `${appBase}/api/payment/betterpay/return`,
        callbackUrlFeFail: `${appBase}/api/payment/betterpay/return`,
      });
      checkoutUrl = bill.url;
      requestId   = bill.invoice;

    } else if (gateway === 'adaptis') {
      const creds = getAdaptisCredentials(entityId);
      const adData = await createAdaptisPayment({
        amountSen: order.netSen,
        reference: order.reference,
        purpose:   `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email:     paymentEmail,
        name:      user.name ?? '',
        credentials: creds,
        approvalUrl:   `${appBase}/api/payment/adaptis/return`,
        unApprovalUrl: `${appBase}/api/payment/adaptis/return`,
        callbackUrl:   `${appBase}/api/webhooks/adaptis`,
      });
      const { paymentUrl: pUrl, ...formFields } = adData;
      adaptisFormData   = formFields as Record<string, string>;
      adaptisPaymentUrl = pUrl;
      checkoutUrl       = pUrl;
      requestId         = formFields.PaymentID;

    } else {
      const creds = getEntityCredentials(entityId);
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
    }

    // Create a new payment record for this attempt
    await prisma.payment.create({
      data: {
        orderId:      order.id,
        requestId,
        status:       'PENDING',
        amountSen:    order.netSen,
        currency:     'MYR',
        checkoutUrl:  gateway === 'adaptis' ? adaptisPaymentUrl : checkoutUrl,
        receiptEmail: paymentEmail,
        provider:     `${gateway}_${entityId}`,
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[retryPayment] Gateway error:', msg);
    return { error: `Could not reach the payment gateway: ${msg}` };
  }

  if (gateway === 'adaptis') {
    return { adaptisFormData, adaptisPaymentUrl };
  }

  return { checkoutUrl };
}
