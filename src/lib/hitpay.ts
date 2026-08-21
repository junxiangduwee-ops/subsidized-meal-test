import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { senToRinggit } from './money';

/**
 * HitPay payment gateway client.
 *
 * Docs: https://docs.hitpayapp.com/
 *   - Create a payment request: POST /v1/payment-requests
 *   - HitPay then POSTs a form-encoded webhook to `webhook` with an `hmac`
 *     field we must verify before trusting anything in it.
 */

const LIVE_BASE = 'https://api.hit-pay.com/v1';
const SANDBOX_BASE = 'https://api.sandbox.hit-pay.com/v1';

export function hitpayConfigured(): boolean {
  return Boolean(process.env.HITPAY_API_KEY && process.env.HITPAY_SALT);
}

/**
 * Payment methods offered at checkout.
 *
 * These identifiers are HitPay's, and they are not guessable - `duitnow_qr`
 * and `tng_ewallet` are both rejected; the accepted spellings are `duitnow`
 * and `touch_n_go`. Verified against the sandbox API, which validates each
 * value against what the merchant account actually has enabled.
 *
 * Sending them explicitly means checkout does not silently widen if someone
 * enables card or FPX on the HitPay account later.
 */
const DEFAULT_PAYMENT_METHODS = ['touch_n_go', 'duitnow'] as const;

export function paymentMethods(): string[] {
  const raw = process.env.HITPAY_PAYMENT_METHODS;
  if (!raw?.trim()) return [...DEFAULT_PAYMENT_METHODS];
  return raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

function baseUrl(): string {
  return process.env.HITPAY_MODE === 'live' ? LIVE_BASE : SANDBOX_BASE;
}

function appUrl(): string {
  // Explicit override always wins - e.g. pin a custom domain even though
  // Vercel would also work, or use a different tunnel URL for local testing.
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');

  // Vercel sets this automatically on every deployment (preview or
  // production) with that deployment's real hostname - no redeploy-for-a-
  // config-change dance needed, since Vercel itself refreshes it each time.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return 'http://localhost:3000';
}

/**
 * The webhook URL, with Vercel's "Protection Bypass for Automation" secret
 * attached if one is configured. Deployment Protection blocks server-to-
 * server calls (like this webhook) the same as any other request, and this
 * is Vercel's own supported way to let a specific automated caller through
 * without disabling protection for everyone else. Generate the secret under
 * Project Settings -> Deployment Protection -> Protection Bypass for
 * Automation - Vercel then auto-populates this env var for you.
 */
function webhookUrl(): string {
  const base = `${appUrl()}/api/webhooks/hitpay`;
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? `${base}?x-vercel-protection-bypass=${secret}` : base;
}

export type CreatePaymentRequestInput = {
  amountSen: number;
  reference: string;
  purpose: string;
  email: string;
  name: string;
};

export type CreatePaymentRequestResult = {
  id: string;
  url: string;
  status: string;
};

export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<CreatePaymentRequestResult> {
  if (!hitpayConfigured()) {
    throw new Error('HitPay is not configured. Set HITPAY_API_KEY and HITPAY_SALT.');
  }

  const body = new URLSearchParams({
    amount: senToRinggit(input.amountSen).toFixed(2),
    currency: (process.env.HITPAY_CURRENCY ?? 'MYR').toUpperCase(),
    email: input.email,
    name: input.name,
    purpose: input.purpose,
    reference_number: input.reference,
    redirect_url: `${appUrl()}/orders/${encodeURIComponent(input.reference)}?from=hitpay`,
    webhook: webhookUrl(),
    // One-shot link: HitPay must not let the same link be paid twice.
    allow_repeated_payments: 'false',
  });

  // Repeated `payment_methods[]` keys - HitPay rejects a comma-joined string.
  for (const method of paymentMethods()) {
    body.append('payment_methods[]', method);
  }

  const res = await fetch(`${baseUrl()}/payment-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'X-BUSINESS-API-KEY': process.env.HITPAY_API_KEY!,
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HitPay rejected the payment request (${res.status}): ${text.slice(0, 500)}`);
  }

  // A 2xx with an HTML body means something other than the API answered -
  // a gateway/CDN page, a maintenance screen, a login wall - not HitPay's
  // JSON API. JSON.parse's own SyntaxError only shows the first ~30
  // characters, which is nearly useless for diagnosing which of those it
  // was, so surface the real content here instead of parsing blind.
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    console.error('[hitpay] Non-JSON response from HitPay:', {
      status: res.status,
      contentType,
      bodySnippet: text.slice(0, 1000),
    });
    throw new Error(
      `HitPay returned a non-JSON response (content-type: ${contentType || 'unknown'}). ` +
        `This usually means the request never reached HitPay's API - check HITPAY_MODE, ` +
        `the API base URL, and outbound network access.`,
    );
  }

  const json = JSON.parse(text) as { id: string; url: string; status: string };
  if (!json.id || !json.url) throw new Error('HitPay response was missing id or url.');
  return { id: json.id, url: json.url, status: json.status ?? 'pending' };
}

export type HitPayWebhookPayload = {
  payment_id: string;
  payment_request_id: string;
  amount: string;
  currency: string;
  status: string;
  reference_number?: string;
  payment_type?: string;
  hmac: string;
  [key: string]: string | undefined;
};

/**
 * Verify the webhook signature.
 *
 * HitPay's scheme: drop `hmac`, sort the remaining keys alphabetically,
 * concatenate `key + value` for each, then HMAC-SHA256 with the API salt.
 */
export function verifyWebhookSignature(fields: Record<string, string>): boolean {
  const salt = process.env.HITPAY_SALT;
  if (!salt) return false;

  const provided = fields.hmac;
  if (!provided) return false;

  const message = Object.keys(fields)
    .filter((k) => k !== 'hmac')
    .sort()
    .map((k) => `${k}${fields[k]}`)
    .join('');

  const expected = createHmac('sha256', salt).update(message).digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** HitPay statuses -> our PaymentStatus. */
export function mapPaymentStatus(status: string): 'SUCCEEDED' | 'FAILED' | 'PENDING' {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'succeeded':
      return 'SUCCEEDED';
    case 'failed':
    case 'expired':
    case 'cancelled':
    case 'canceled':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/** Ringgit decimal string from HitPay -> sen, for amount tamper checks. */
export function parseAmountToSen(amount: string): number {
  const n = Number.parseFloat(amount);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}
