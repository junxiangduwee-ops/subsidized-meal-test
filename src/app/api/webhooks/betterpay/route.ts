import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyBetterpayWebhook } from '@/lib/betterpay';
import { getEntityCredentials } from '@/lib/entity-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Betterpay payment webhook (backend callback).
 *
 * Betterpay POSTs form-encoded data to this endpoint after payment.
 * Must respond with plain text 'OK' to stop retries.
 * Retries 3x every 10 minutes if no 'OK' received.
 *
 * txn_status '00' = Transaction Approved
 */
export async function POST(req: NextRequest) {
  // Parse form-encoded body
  let fields: Record<string, string>;
  try {
    const text = await req.text();
    fields = Object.fromEntries(new URLSearchParams(text));
  } catch {
    return new NextResponse('Invalid body', { status: 400 });
  }

  const {
    invoice_no,
    txn_status,
    msg,
    txn_amount,
    pay_method,
    hash: receivedHash,
    fpx_fpxTxnId,
    paypal_trx_id,
    mastercard_trx_id,
    others_trx_id,
  } = fields;

  if (!invoice_no || !txn_status || !receivedHash) {
    return new NextResponse('Missing required fields', { status: 400 });
  }

  // Determine transaction ID based on payment method
  const trxId = fpx_fpxTxnId ?? paypal_trx_id ?? mastercard_trx_id ?? others_trx_id ?? '';

  // Find the order by invoice_no (we stored the sanitised invoice in Payment.requestId)
  const order = await prisma.order.findFirst({
    where: {
      payments: { some: { requestId: invoice_no } },
    },
    select: {
      id: true,
      reference: true,
      status: true,
      paidAt: true,
      entityId: true,
      payments: {
        where: { requestId: invoice_no },
        select: { id: true, status: true },
        take: 1,
      },
    },
  });

  if (!order) {
    console.warn('[betterpay] Webhook for unknown invoice:', invoice_no);
    // Still return OK so Betterpay stops retrying
    return new NextResponse('OK');
  }

  // Get entity credentials for signature verification
  const entityId = order.entityId ?? 'ecommerce';
  let credentials: ReturnType<typeof getEntityCredentials>;
  try {
    credentials = getEntityCredentials(entityId);
  } catch {
    console.warn('[betterpay] No credentials for entity:', entityId);
    return new NextResponse('OK');
  }

  // Verify MD5 signature
  const isValid = verifyBetterpayWebhook(
    credentials.apiKey,
    trxId,
    invoice_no,
    txn_status,
    msg ?? '',
    receivedHash,
  );

  if (!isValid) {
    console.warn('[betterpay] Invalid signature for invoice:', invoice_no);
    return new NextResponse('Invalid signature', { status: 400 });
  }

  // Audit log
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'payment.betterpay_webhook',
      entityType: 'Order',
      entityId: order.id,
      metadata: {
        invoice_no,
        txn_status,
        msg,
        pay_method,
        trxId,
        txn_amount,
      },
    },
  });

  // Process payment result
  const payment = order.payments[0];
  const amountSen = Math.round(parseFloat(txn_amount ?? '0') * 100);

  if (txn_status === '00') {
    // Payment approved
    if (order.status === 'AWAITING_PAYMENT') {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            paidAt: order.paidAt ?? new Date(),
          },
        });
        if (payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'SUCCEEDED',
              amountSen,
              paymentMethod: pay_method ?? null,
              paymentId: trxId || null,
            },
          });
        }
      });
      console.log('[betterpay] Order paid:', order.reference);
    }
  } else {
    // Payment failed or cancelled
    if (order.status === 'AWAITING_PAYMENT' && payment) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CART' },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: msg ?? `txn_status: ${txn_status}`,
          },
        });
      });
      console.log('[betterpay] Payment failed for order:', order.reference, 'status:', txn_status);
    }
  }

  // MUST return plain text 'OK' — Betterpay retries if not received
  return new NextResponse('OK', {
    headers: { 'Content-Type': 'text/plain' },
  });
}
