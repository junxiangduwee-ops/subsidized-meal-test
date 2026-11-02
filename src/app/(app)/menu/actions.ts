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

/**
 * HitPay's checkout page refuses to render inside any iframe (it sends
 * X-Frame-Options/CSP frame-ancestors headers to block that, for
 * clickjacking protection - not something we can turn off from here). So
 * instead of redirecting to it directly, checkout() hands the order
 * reference back; the client navigates to /orders/{reference}, which opens
 * HitPay's checkout in its own popup window and polls for payment
 * completion rather than trying to load HitPay inside the embedded iframe.
 */
export type CheckoutResult = ActionState & {
  reference?: string;
  checkoutUrl?: string;
  /** ADAPTIS only — form fields to POST to eGHL payment page */
  adaptisFormData?: Record<string, string>;
  adaptisPaymentUrl?: string;
};

export type MealResult = { ok: boolean; error?: string };

/**
 * Choose the meal for a day. Replaces whatever was picked for that date -
 * staff get one meal per service day.
 */
export async function chooseMeal(menuItemId: string): Promise<MealResult> {
  const user = await assertCapability('order:place');

  const result = await selectMeal(user.id, menuItemId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/menu');
  return { ok: true };
}

/** Un-choose a day's meal. */
export async function removeMeal(menuItemId: string): Promise<MealResult> {
  const user = await assertCapability('order:place');

  const result = await clearMeal(user.id, menuItemId);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/menu');
  return { ok: true };
}

/** Set (or change) the delivery site for the current week's cart. */
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
    where: { userId: user.id, cycleId, status: 'CART' }
  },
  );
  if (!order) return;

  await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
  await repriceOrder(order.id);
  revalidatePath('/menu');
}

/**
 * Turn the cart into a committed order.
 *
 * Fully subsidised orders skip the gateway entirely - there is nothing to
 * charge. Everything else goes to HitPay, and only the webhook may mark the
 * order PAID.
 */
export async function checkout(_prev: ActionState, formData: FormData): Promise<CheckoutResult> {
  const user = await assertCapability('order:place');
  const cycleId = String(formData.get('cycleId') ?? '');
  if (!cycleId) return { error: 'Missing week.' };

  const order = await prisma.order.findFirst({
    where: { userId: user.id, cycleId, status: 'CART' },
    include: { cycle: true },
  });
  if (!order) return { error: 'You have no cart for this week.' };

  // Re-price so a subsidy change since the cart was built is honoured.
  await repriceOrder(order.id);

  const valid = await validateForCheckout(order.id);
  if (!valid.ok) return { error: valid.error };

  const fresh = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

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

  if (!hitpayConfigured()) {
    return {
      error:
        'Online payment is not configured yet. Ask an administrator to add the HitPay API key before checking out.',
    };
  }

  // Resolve payment email
  let paymentEmail = user.email;
  if (!paymentEmail) {
    const entered = String(formData.get('receiptEmail') ?? '').trim();
    if (!entered) {
      return { error: 'Enter an email address to receive the payment receipt.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entered)) {
      return { error: 'Enter a valid email address for the receipt.' };
    }
    paymentEmail = entered.toLowerCase();
  }

  // Entity selection — determines which gateway to use
  const rawEntityId = String(formData.get('entityId') ?? '').trim();
  if (!rawEntityId || !isValidEntityId(rawEntityId)) {
    return { error: 'Please select your entity before proceeding to payment.' };
  }
  const entityId = rawEntityId;
  const gateway = getGatewayType(entityId);

  // Resolve app base URL for callbacks
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

  // Mark order as awaiting payment
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
        purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email: paymentEmail,
        name: user.name ?? '',
        credentials: creds,
        callbackUrlBe:     `${appBase}/api/webhooks/betterpay`,
        callbackUrlFeSucc: `${appBase}/api/payment/betterpay/return`,
        callbackUrlFeFail: `${appBase}/api/payment/betterpay/return`,
      });
      checkoutUrl = bill.url;
      requestId = bill.invoice;

    } else if (gateway === 'adaptis') {
      const creds = getAdaptisCredentials(entityId);
      const adData = await createAdaptisPayment({
        amountSen: fresh.netSen,
        reference: fresh.reference,
        purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email: paymentEmail,
        name: user.name ?? '',
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
        amountSen: fresh.netSen,
        reference: fresh.reference,
        purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email: paymentEmail,
        name: user.name,
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

  // ADAPTIS returns form data — client handles popup/form submit
  if (gateway === 'adaptis') {
    return { reference: fresh.reference, adaptisFormData, adaptisPaymentUrl };
  }

  // Embedded sessions use popup+poll; plain web sessions redirect directly
  if (user.embed) {
    return { reference: fresh.reference, checkoutUrl };
  }
  redirect(checkoutUrl);
}
