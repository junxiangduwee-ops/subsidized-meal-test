import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { mapPaymentStatus, parseAmountToSen, verifyWebhookSignature, fetchPaymentType } from '@/lib/hitpay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * HitPay payment webhook.
 *
 * This is the ONLY path that may move an order to PAID - the browser
 * redirect is cosmetic and can be forged. Everything here is defensive:
 * verify the HMAC, match the amount we expect, and stay idempotent because
 * HitPay retries until it gets a 200.
 */
export async function POST(request: Request) {
  let fields: Record<string, string>;

  try {
    const raw = await request.text();
    fields = Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 });
  }

  if (!verifyWebhookSignature(fields)) {
    console.warn('[hitpay] Rejected webhook with an invalid signature.');
    // 400, not 401 - a bad signature is a bad request, and we do not want
    // HitPay retrying a payload we will never accept.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const requestId = fields.payment_request_id;
  const paymentId = fields.payment_id;
  const reference = fields.reference_number;

  if (!requestId && !reference) {
    return NextResponse.json({ error: 'Missing identifiers' }, { status: 400 });
  }

  const payment = requestId
    ? await prisma.payment.findUnique({ where: { requestId }, include: { order: true } })
    : null;

  const order =
    payment?.order ??
    (reference ? await prisma.order.findUnique({ where: { reference } }) : null);

  if (!order) {
    // Acknowledge so HitPay stops retrying something we cannot match, but
    // leave a trail for reconciliation.
    console.error('[hitpay] Webhook for an unknown order:', { requestId, reference });
    await prisma.auditLog.create({
      data: {
        action: 'payment.webhook_unmatched',
        entityType: 'Payment',
        metadata: { requestId, reference, paymentId },
      },
    });
    return NextResponse.json({ received: true });
  }

  const status = mapPaymentStatus(fields.status ?? '');
  const paidSen = parseAmountToSen(fields.amount ?? '');

  // The webhook body itself never carries the channel used - it has to be
  // looked up separately. Only bother when the field genuinely isn't there
  // (future-proofs against HitPay adding it later) and there's a request id
  // to look it up with. A failed lookup falls back to null rather than
  // blocking the payment from being recorded.
  const paymentType =
    fields.payment_type ?? (requestId ? await fetchPaymentType(requestId, paymentId) : null);

  // Underpayment must never confirm an order.
  if (status === 'SUCCEEDED' && (!Number.isFinite(paidSen) || paidSen < order.netSen)) {
    console.error('[hitpay] Amount mismatch', {
      reference: order.reference,
      expected: order.netSen,
      received: paidSen,
    });
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: payment ? { id: payment.id } : { orderId: order.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          paymentId,
          paymentMethod: paymentType,
          failureReason: `Amount mismatch: expected ${order.netSen} sen, received ${paidSen} sen`,
          rawPayload: fields,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: 'payment.amount_mismatch',
          entityType: 'Order',
          entityId: order.id,
          metadata: { expected: order.netSen, received: paidSen, paymentId },
        },
      }),
    ]);
    return NextResponse.json({ received: true });
  }

  await prisma.$transaction(async (tx) => {
    if (payment) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          paymentId: paymentId ?? payment.paymentId,
          paymentMethod: paymentType ?? payment.paymentMethod,
          rawPayload: fields,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          requestId: requestId ?? null,
          paymentId: paymentId ?? null,
          status,
          amountSen: Number.isFinite(paidSen) ? paidSen : order.netSen,
          currency: (fields.currency ?? 'MYR').toUpperCase(),
          paymentMethod: paymentType,
          rawPayload: fields,
        },
      });
    }

    // Idempotent: an order already PAID is left exactly as it is.
    if (status === 'SUCCEEDED' && order.status === 'AWAITING_PAYMENT') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    }

    // A failed attempt returns the order to a cart so the employee can retry
    // while the window is still open.
    if (status === 'FAILED' && order.status === 'AWAITING_PAYMENT') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CART', submittedAt: null },
      });
    }

    await tx.auditLog.create({
      data: {
        action: `payment.webhook_${status.toLowerCase()}`,
        entityType: 'Order',
        entityId: order.id,
        metadata: { paymentId, requestId, amountSen: paidSen },
      },
    });
  });

  return NextResponse.json({ received: true });
}
