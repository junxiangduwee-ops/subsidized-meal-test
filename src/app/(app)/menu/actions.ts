'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit, clearMeal, repriceOrder, selectMeal, setDeliverySite, validateForCheckout } from '@/lib/orders';
import { createPaymentRequest } from '@/lib/hitpay';
import { createBetterpayBill } from '@/lib/betterpay';
import { createAdaptisPayment } from '@/lib/adaptis';
import { getEntityCredentials, getBetterpayCredentials, getAdaptisCredentials, getGatewayType, isValidEntityId } from '@/lib/entity-config';
import { formatWeekRange } from '@/lib/cycle';
import type { ActionState } from '@/components/action-form';

export type CheckoutResult = ActionState & {
  reference?: string;
  checkoutUrl?: string;
  adaptisFormData?: Record<string, string>;
  adaptisPaymentUrl?: string;
};

export type MealResult = { ok: boolean; error?: string };

export async function chooseMeal(menuItemId: string): Promise<MealResult> {
  const user = await assertCapability('order:place');
  const result = await selectMeal(user.id, menuItemId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/menu');
  return { ok: true };
}

export async function removeMeal(menuItemId: string): Promise<MealResult> {
  const user = await assertCapability('order:place');
  const result = await clearMeal(user.id, menuItemId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/menu');
  return { ok: true };
}

export async function chooseDeliverySite(cycleId: string, deliverySiteId: string): Promise<MealResult> {
  const user = await assertCapability('order:place');
  const result = await setDeliverySite(user.id, cycleId, deliverySiteId);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath('/menu');
  return { ok: true };
}

export async function clearCart(formData: FormData): Promise<void> {
  const user = await assertCapability('order:place');
  const cycleId = String(formData.get('cycleId') ?? '');
  if (!cycleId) return;
  const order = await prisma.order.findFirst({
    where: { userId: user.id, cycleId, status: 'CART' },
  });
  if (!order) return;
  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await repriceOrder(order.id);
  revalidatePath('/menu');
}

export async function checkout(_prev: ActionState, formData: FormData): Promise<CheckoutResult> {
  const user = await assertCapability('order:place');
  const cycleId = String(formData.get('cycleId') ?? '');
  if (!cycleId) return { error: 'Missing week.' };

  const order = await prisma.order.findFirst({
    where: { userId: user.id, cycleId, status: 'CART' },
    include: { cycle: true },
  });
  if (!order) return { error: 'You have no cart for this week.' };

  await repriceOrder(order.id);

  const valid = await validateForCheckout(order.id);
  if (!valid.ok) return { error: valid.error };

  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

  // Fully subsidised — skip gateway entirely
  if (fresh.netSen === 0) {
    await prisma.order.update({
      where: { id: fresh.id },
      data: { status: 'PAID', submittedAt: new Date(), paidAt: new Date() },
    });
    await audit(user.id, 'order.paid_fully_subsidised', 'Order', fresh.id, {
      grossSen: fresh.grossSen,
      subsidySen: fresh.subsidySen,
    });
    revalidatePath('/menu');
    revalidatePath('/orders');
    redirect(`/orders/${fresh.reference}?status=confirmed`);
  }

  // Resolve payment email
  let paymentEmail = user.email;
  if (!paymentEmail) {
    const entered = String(formData.get('receiptEmail') ?? '').trim();
    if (!entered) return { error: 'Enter an email address to receive the payment receipt.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered)) return { error: 'Enter a valid email address for the receipt.' };
    paymentEmail = entered.toLowerCase();
  }

  // Entity selection — determines which gateway to use
  const rawEntityId = String(formData.get('entityId') ?? '').trim();
  if (!rawEntityId || !isValidEntityId(rawEntityId)) {
    return { error: 'Please select your entity before proceeding to payment.' };
  }
  const entityId = rawEntityId;
  const gateway = getGatewayType(entityId);

  // App base URL for webhook/return callbacks
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

  // Move order to AWAITING_PAYMENT and record which entity/gateway was used
  await prisma.order.update({
    where: { id: fresh.id },
    data: { status: 'AWAITING_PAYMENT', submittedAt: new Date(), entityId },
  });

  let checkoutUrl!: string;
  let requestId: string | undefined;
  let adaptisFormData: Record<string, string> | undefined;
  let adaptisPaymentUrl: string | undefined;

  try {
    if (gateway === 'betterpay') {
      const creds = getBetterpayCredentials(entityId);
      const bill = await createBetterpayBill({
        amountSen: fresh.netSen,
        reference: fresh.reference,
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
        amountSen: fresh.netSen,
        reference: fresh.reference,
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
      // HitPay — retail and group entities
      const creds = getEntityCredentials(entityId);
      const request = await createPaymentRequest({
        amountSen: fresh.netSen,
        reference: fresh.reference,
        purpose:   `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email:     paymentEmail,
        name:      user.name,
        credentials: creds,
      });
      checkoutUrl = request.url;
      requestId   = request.id;
    }

    await prisma.payment.create({
      data: {
        orderId:      fresh.id,
        requestId,
        status:       'PENDING',
        amountSen:    fresh.netSen,
        currency:     'MYR',
        checkoutUrl:  gateway === 'adaptis' ? adaptisPaymentUrl : checkoutUrl,
        receiptEmail: paymentEmail,
        provider:     `${gateway}_${entityId}`,
      },
    });

  } catch (err) {
    // Roll back to CART so the user can retry
    await prisma.order.update({
      where: { id: fresh.id },
      data: { status: 'CART', submittedAt: null, entityId: null },
    });
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[checkout] Payment gateway error:', msg);
    return { error: `Could not reach the payment gateway: ${msg}` };
  }

  await audit(user.id, 'order.checkout', 'Order', fresh.id, { netSen: fresh.netSen });
  revalidatePath('/menu');
  revalidatePath('/orders');

  // ADAPTIS uses form POST — return form data for the client to handle
  if (gateway === 'adaptis') {
    return { reference: fresh.reference, adaptisFormData, adaptisPaymentUrl };
  }

  // Embedded sessions open HitPay/Betterpay in a popup; plain web sessions redirect
  if (user.embed) {
    return { reference: fresh.reference, checkoutUrl };
  }

  redirect(checkoutUrl);
}
