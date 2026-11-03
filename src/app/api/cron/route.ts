/**
 * Vercel Cron endpoint — runs all scheduled background jobs.
 *
 * Vercel calls GET /api/cron on the schedule defined in vercel.json.
 * Each job is independent; one failure does not stop the rest.
 *
 * Jobs
 * ────
 * 1. auto-confirm meals   — mark PAID OrderItems as received after the
 *                           admin-configured cutoff hour (default 18:00 MYT).
 * 2. close ordering       — set cycles whose orderCutoffAt has passed to
 *                           CLOSED so no new orders slip through after
 *                           the deadline (belt-and-suspenders; the UI
 *                           already gates on orderCutoffAt in the DB query
 *                           but this makes the DB state authoritative).
 * 3. expire pending orders — cancel Order rows that have been in PENDING
 *                           status for more than 24 h with no successful
 *                           payment, freeing any reserved capacity.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { todayInAppTz, toDateKey, zonedToUtc, APP_TIMEZONE } from '@/lib/cycle';
import { getSiteSettings } from '@/lib/settings';
import { audit } from '@/lib/orders';

// ── Security ────────────────────────────────────────────────────────────────
// Vercel signs cron requests with CRON_SECRET in the Authorization header.
// Without this check, anyone who knows the URL can trigger the jobs.
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — only allow in development.
    return process.env.NODE_ENV === 'development';
  }
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

// ── Job 1: Auto-confirm past meals ──────────────────────────────────────────
async function jobAutoConfirmMeals(): Promise<{ confirmed: number }> {
  const now = new Date();
  const { mealReceiptCutoffHour } = await getSiteSettings();

  const today = todayInAppTz(now);
  const todayKey = toDateKey(today);
  const [y, m, d] = todayKey.split('-').map(Number);
  const cutoffUtc = zonedToUtc(y, m, d, mealReceiptCutoffHour, 0, APP_TIMEZONE);

  // Include today only if the cutoff hour has already passed.
  const serviceDateFilter = now >= cutoffUtc ? { lte: today } : { lt: today };

  const result = await prisma.orderItem.updateMany({
    where: {
      receivedAt: null,
      serviceDate: serviceDateFilter,
      order: { status: 'PAID' },
    },
    data: { receivedAt: now, receivedBySystem: true },
  });

  return { confirmed: result.count };
}

// ── Job 2: Mark overdue cycles as CLOSED ────────────────────────────────────
// The UI already filters on orderCutoffAt at query time, but keeping the DB
// status correct means reports, admin views, and exports stay accurate.
async function jobClosePastCycles(): Promise<{ closed: number }> {
  const now = new Date();

  const result = await prisma.menuCycle.updateMany({
    where: {
      status: 'PUBLISHED',
      orderCutoffAt: { lte: now },
    },
    data: { status: 'CLOSED' },
  });

  return { closed: result.count };
}

// ── Job 3: Expire stale PENDING orders ──────────────────────────────────────
// Orders stay PENDING while the user is on the payment gateway page.
// If they never come back (closed tab, gateway timeout, etc.) the order
// sits in PENDING forever. Cancel it after 24 h.
const PENDING_ORDER_TTL_HOURS = 24;

async function jobExpirePendingOrders(): Promise<{ expired: number }> {
  const cutoff = new Date(Date.now() - PENDING_ORDER_TTL_HOURS * 3_600_000);

  // Find the stale orders first so we can audit each one.
  const stale = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lte: cutoff },
    },
    select: { id: true, userId: true, reference: true },
  });

  if (stale.length === 0) return { expired: 0 };

  await prisma.order.updateMany({
    where: { id: { in: stale.map((o) => o.id) } },
    data: { status: 'CANCELLED' },
  });

  // Audit each cancellation (fire-and-forget; don't let audit errors break the job).
  await Promise.allSettled(
    stale.map((o) =>
      audit('SYSTEM', 'order.expired', 'Order', o.id, {
        reference: o.reference,
        reason: `Pending for more than ${PENDING_ORDER_TTL_HOURS}h`,
      }),
    ),
  );

  return { expired: stale.length };
}

// ── Handler ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  // Run all jobs independently — one failure must not block the others.
  await Promise.allSettled([
    jobAutoConfirmMeals()
      .then((r) => { results.autoConfirmMeals = r; })
      .catch((e) => { errors.autoConfirmMeals = String(e); }),

    jobClosePastCycles()
      .then((r) => { results.closePastCycles = r; })
      .catch((e) => { errors.closePastCycles = String(e); }),

    jobExpirePendingOrders()
      .then((r) => { results.expirePendingOrders = r; })
      .catch((e) => { errors.expirePendingOrders = String(e); }),
  ]);

  const hasErrors = Object.keys(errors).length > 0;

  return NextResponse.json(
    { ok: !hasErrors, results, errors, ranAt: new Date().toISOString() },
    { status: hasErrors ? 207 : 200 },
  );
}
