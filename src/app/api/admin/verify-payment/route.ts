import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { getHitPayPaymentStatus } from '@/lib/hitpay';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await requireCapability('finance:view');

  const body = await req.json().catch(() => null);
  const { reference } = body ?? {};

  if (!reference || typeof reference !== 'string') {
    return NextResponse.json({ error: 'Missing order reference' }, { status: 400 });
  }

  // Find the order and its latest payment request
  const order = await prisma.order.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      status: true,
      paidAt: true,
      payments: {
        where: { status: { not: 'FAILED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          requestId: true,
          status: true,
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  if (order.status !== 'AWAITING_PAYMENT') {
    return NextResponse.json({
      error: `Order is already ${order.status} — no verification needed`,
    }, { status: 400 });
  }

  const payment = order.payments[0];
  if (!payment?.requestId) {
    return NextResponse.json({ error: 'No HitPay payment request found for this order' }, { status: 404 });
  }

  // Call HitPay API to get the real payment status
  const hitpayStatus = await getHitPayPaymentStatus(payment.requestId);

  if (!hitpayStatus) {
    return NextResponse.json({ error: 'Failed to reach HitPay API. Try again later.' }, { status: 502 });
  }

  // Audit log regardless of outcome
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'payment.manual_verify',
      metadata: {
        reference,
        hitpayStatus: hitpayStatus.status,
        requestId: payment.requestId,
      },
    },
  });

  // If HitPay confirms completed — update order to PAID
  if (hitpayStatus.status === 'completed') {
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
        data: { status: 'SUCCEEDED' },
      });
    });

    return NextResponse.json({
      success: true,
      message: `Payment confirmed by HitPay. Order ${reference} is now PAID.`,
      hitpayStatus: hitpayStatus.status,
    });
  }

  // Not yet completed — return HitPay status for admin to see
  return NextResponse.json({
    success: false,
    message: `Payment not confirmed by HitPay. Current HitPay status: ${hitpayStatus.status}`,
    hitpayStatus: hitpayStatus.status,
  });
}
