'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit, clearMeal, repriceOrder, selectMeal, setDeliverySite, validateForCheckout } from '@/lib/orders';
import { createPaymentRequest } from '@/lib/hitpay';
import { createBetterpayBill } from '@/lib/betterpay';
import { getEntityCredentials, getBetterpayCredentials, getGatewayType, isValidEntityId } from '@/lib/entity-config';
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
export type CheckoutResult = ActionState & { reference?: string; checkoutUrl?: string };

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

  // Get entity from form data — determines which HitPay account to charge.
  // Entity selection is required — no default fallback.
  const rawEntityId = String(formData.get('entityId') ?? '').trim();
  if (!rawEntityId || !isValidEntityId(rawEntityId)) {
    return { error: 'Please select your entity before proceeding to payment.' };
  }
  const entityId = rawEntityId;

  const gateway = getGatewayType(entityId);

  // Validate credentials early before creating order
  if (gateway === 'betterpay') {
    try {
      getBetterpayCredentials(entityId);
    } catch {
      return { error: `Betterpay account not configured for ${entityId}. Contact your administrator.` };
    }
  } else {
    try {
      getEntityCredentials(entityId);
    } catch {
      return { error: `HitPay account not configured for ${entityId}. Contact your administrator.` };
    }
  }

  // HitPay needs somewhere to send the payment link/receipt. Most staff
  // have their own email; for the (real, expected) case of an employee
  // provisioned by employee ID alone with no email account, they type one
  // in just for this receipt - it's never saved as their login email.
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

  await prisma.order.update({
    where: { id: fresh.id },
    data: { status: 'AWAITING_PAYMENT', submittedAt: new Date(), entityId },
  });

  let checkoutUrl: string = '';
  let betterpayInvoice: string | undefined;
  let hitpayRequestId: string | undefined;
  try {
    if (gateway === 'betterpay') {
      const bpCreds = getBetterpayCredentials(entityId);
      // Use APP_URL if set (works for both local ngrok and production).
      // Falls back to Vercel production URL, then deployment URL.
      // Note: localhost won't work with Betterpay sandbox — use Vercel URL.
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

      const bill = await createBetterpayBill({
        amountSen: fresh.netSen,
        reference: fresh.reference,
        purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email: paymentEmail,
        name: user.name ?? '',
        credentials: bpCreds,
        callbackUrlBe:      `${appBase}/api/webhooks/betterpay`,
        callbackUrlFeSucc:  `${appBase}/orders/${encodeURIComponent(fresh.reference)}?from=betterpay`,
        callbackUrlFeFail:  `${appBase}/orders/${encodeURIComponent(fresh.reference)}?from=betterpay&status=failed`,
      });
      checkoutUrl = bill.url;
      betterpayInvoice = bill.invoice;
    } else {
      const hitpayCreds = getEntityCredentials(entityId);
      const request = await createPaymentRequest({
        amountSen: fresh.netSen,
        reference: fresh.reference,
        purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
        email: paymentEmail,
        name: user.name,
        credentials: hitpayCreds,
      });
      checkoutUrl = request.url;
      hitpayRequestId = request.id;
    }

    await prisma.payment.create({
      data: {
        orderId: fresh.id,
        requestId: gateway === 'betterpay' ? betterpayInvoice : hitpayRequestId,
        status: 'PENDING',
        amountSen: fresh.netSen,
        currency: (gateway === 'betterpay'
          ? getBetterpayCredentials(entityId).currency
          : getEntityCredentials(entityId).currency
        ).toUpperCase(),
        checkoutUrl: checkoutUrl,
        receiptEmail: paymentEmail,
        provider: `${gateway}_${entityId}`,
      },
    });

    // checkoutUrl already set above
  } catch (err) {
    // Put the cart back so the employee can retry without losing anything.
    await prisma.order.update({
      where: { id: fresh.id },
      data: { status: 'CART', submittedAt: null },
    });
    console.error('[checkout] HitPay request failed:', err);
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[checkout] Payment gateway error:', errMsg);
    return { error: `Could not reach the payment gateway: ${errMsg}` };
  }

  await audit(user.id, 'order.checkout', 'Order', fresh.id, { netSen: fresh.netSen });
  revalidatePath('/menu');
  revalidatePath('/orders');

  // Only embedded (Joget iframe) sessions need the popup+poll dance - a
  // plain web session isn't in any iframe, so redirecting straight to
  // HitPay works exactly as it always did.
  if (user.embed) {
    return { reference: fresh.reference, checkoutUrl };
  }
  redirect(checkoutUrl);
}
