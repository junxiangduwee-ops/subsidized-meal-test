import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyBetterpayWebhook } from '@/lib/betterpay';
import { getEntityCredentials, getBetterpayCredentials } from '@/lib/entity-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Betterpay payment webhook (backend callback).
 * Must respond with plain text 'OK' to stop retries.
 * Retries 3x every 10 minutes if no 'OK' received.
 */
export async function POST(req: NextRequest) {
  let fields: Record<string, string>;
  try {
    const text = await req.text();
    fields = Object.fromEntries(new URLSearchParams(text));
    console.log('[betterpay webhook] received:', JSON.stringify(fields));
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
    console.warn('[betterpay webhook] Missing required fields');
    return new NextResponse('OK');
  }

  const trxId = fpx_fpxTxnId ?? paypal_trx_id ?? mastercard_trx_id ?? others_trx_id ?? '';

  // Find order by requestId (invoice_no stored in Payment.requestId)
  const payment = await prisma.payment.findFirst({
    where: { requestId: invoice_no },
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
    console.warn('[betterpay webhook] No payment found for invoice:', invoice_no);
    // Still return OK so Betterpay stops retrying
    return new NextResponse('OK');
  }

  const order = payment.order;

  // Get entity credentials for signature verification
  const entityId = order.entityId ?? 'ecommerce';
  let apiKey: string;
  try {
    const creds = getBetterpayCredentials(entityId);
    apiKey = creds.apiKey;
  } catch {
    console.warn('[betterpay webhook] No credentials for entity:', entityId);
    return new NextResponse('OK');
  }

  // Verify MD5 signature
  const isValid = verifyBetterpayWebhook(
    apiKey,
    trxId,
    invoice_no,
    txn_status,
    msg ?? '',
    receivedHash,
  );

  if (!isValid) {
    console.warn('[betterpay webhook] Invalid signature for invoice:', invoice_no);
    // Return OK anyway to stop retries — log for investigation
    return new NextResponse('OK');
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

  const amountSen = Math.round(parseFloat(txn_amount ?? '0') * 100);

  if (txn_status === '00') {
    // Payment approved — only update if still awaiting
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
            status: 'SUCCEEDED',
            amountSen,
            paymentMethod: pay_method ?? null,
            paymentId: trxId || null,
            updatedAt: new Date(),
          },
        });
      });
      console.log('[betterpay webhook] Order paid:', order.reference);
    } else {
      console.log('[betterpay webhook] Order already processed:', order.reference, order.status);
    }
  } else {
    // Payment failed — reset to CART so user can retry
    if (order.status === 'AWAITING_PAYMENT') {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CART', submittedAt: null, entityId: null },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: msg ?? `txn_status: ${txn_status}`,
          },
        });
      });
      console.log('[betterpay webhook] Payment failed:', order.reference, txn_status);
    }
  }

  // MUST return plain text 'OK'
  return new NextResponse('OK', {
    headers: { 'Content-Type': 'text/plain' },
  });
}
