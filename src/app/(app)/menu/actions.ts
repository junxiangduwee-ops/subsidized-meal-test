'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit, clearMeal, repriceOrder, selectMeal, setDeliverySite, validateForCheckout } from '@/lib/orders';
import { createPaymentRequest, hitpayConfigured } from '@/lib/hitpay';
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
export type CheckoutResult = ActionState & { reference?: string };

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
    data: { status: 'AWAITING_PAYMENT', submittedAt: new Date() },
  });

  let checkoutUrl: string;
  try {
    const request = await createPaymentRequest({
      amountSen: fresh.netSen,
      reference: fresh.reference,
      purpose: `Staff meals ${formatWeekRange(order.cycle.serviceWeekStart)}`,
      email: paymentEmail,
      name: user.name,
    });

    await prisma.payment.create({
      data: {
        orderId: fresh.id,
        requestId: request.id,
        status: 'PENDING',
        amountSen: fresh.netSen,
        currency: (process.env.HITPAY_CURRENCY ?? 'MYR').toUpperCase(),
        checkoutUrl: request.url,
        receiptEmail: paymentEmail,
      },
    });

    checkoutUrl = request.url;
  } catch (err) {
    // Put the cart back so the employee can retry without losing anything.
    await prisma.order.update({
      where: { id: fresh.id },
      data: { status: 'CART', submittedAt: null },
    });
    console.error('[checkout] HitPay request failed:', err);
    return { error: 'Could not reach the payment gateway. Please try again in a moment.' };
  }

  await audit(user.id, 'order.checkout', 'Order', fresh.id, { netSen: fresh.netSen });
  revalidatePath('/menu');
  revalidatePath('/orders');

  // Only embedded (Joget iframe) sessions need the popup+poll dance - a
  // plain web session isn't in any iframe, so redirecting straight to
  // HitPay works exactly as it always did.
  if (user.embed) {
    return { reference: fresh.reference };
  }
  redirect(checkoutUrl);
}
