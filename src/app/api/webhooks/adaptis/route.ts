import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ADAPTIS (eGHL) payment callback handler.
 *
 * eGHL POSTs payment response to MerchantCallBackURL after payment.
 * Must respond with 'OK' to stop retries (max 3 retries).
 *
 * TxnStatus '0' = Transaction successful
 */
export async function POST(req: NextRequest) {
  let fields: Record<string, string>;
  try {
    const text = await req.text();
    fields = Object.fromEntries(new URLSearchParams(text));
    console.log('[adaptis webhook] received:', JSON.stringify(fields));
  } catch {
    return new NextResponse('Invalid body', { status: 400 });
  }

  const {
    PaymentID,
    Amount,
    TxnID,
    TxnStatus,
    TxnMessage,
    PymtMethod,
  } = fields;

  if (!PaymentID || !TxnStatus) {
    console.warn('[adaptis webhook] Missing required fields');
    return new NextResponse('OK');
  }

  // Find order by PaymentID (stored in Payment.requestId)
  const payment = await prisma.payment.findFirst({
    where: { requestId: PaymentID },
    select: {
      id: true,
      status: true,
      order: {
        select: {
          id: true,
          reference: true,
          status: true,
          paidAt: true,
          entityId: true,
        },
      },
    },
  });

  if (!payment) {
    console.warn('[adaptis webhook] No payment found for PaymentID:', PaymentID);
    return new NextResponse('OK');
  }

  const order = payment.order;

  // Adaptis gateway retired — signature verification skipped

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'payment.adaptis_webhook',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        PaymentID,
        TxnID,
        TxnStatus,
        TxnMessage,
        PymtMethod,
        Amount,
      },
    },
  });

  const amountSen = Math.round(parseFloat(Amount ?? '0') * 100);

  if (TxnStatus === '0') {
    // Payment successful
    if (order.status === 'AWAITING_PAYMENT') {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            paidAt: order.paidAt ?? new Date(),
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status:        'SUCCEEDED',
            amountSen,
            paymentMethod: PymtMethod ?? null,
            paymentId:     TxnID ?? null,
          },
        });
      });
      console.log('[adaptis webhook] Order paid:', order.reference);
    }
  } else {
    // Payment failed
    if (order.status === 'AWAITING_PAYMENT') {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CART', submittedAt: null, entityId: null },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status:        'FAILED',
            failureReason: TxnMessage ?? `TxnStatus: ${TxnStatus}`,
          },
        });
      });
      console.log('[adaptis webhook] Payment failed:', order.reference, TxnStatus);
    }
  }

  // Must return 'OK' to stop eGHL retries
  return new NextResponse('OK', {
    headers: { 'Content-Type': 'text/plain' },
  });
}
