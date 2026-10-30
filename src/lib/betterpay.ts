import { createHash } from 'crypto';

/**
 * Betterpay (previously QlicknPay) payment gateway integration.
 *
 * Docs: https://www.betterpay.me/docs/
 *
 * Key differences from HitPay:
 * - Signature uses MD5 (not HMAC-SHA256)
 * - Webhook must respond with plain text 'OK'
 * - Invoice max 14 chars, no & ' - characters
 * - Amount must be in 2 decimal places
 * - Webhook retries 3x every 10 minutes if no 'OK' received
 */

// ── URLs ────────────────────────────────────────────────────────────────────
const SANDBOX_CREATE_BILL = 'https://www.demo.betterpay.me/merchant/api/v2/create_bill';
const LIVE_CREATE_BILL    = 'https://www.betterpay.me/merchant/api/v2/create_bill';

function createBillUrl(mode: string): string {
  return mode === 'live' ? LIVE_CREATE_BILL : SANDBOX_CREATE_BILL;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function senToRinggit(sen: number): number {
  return sen / 100;
}

/**
 * Sanitise a string for Betterpay fields:
 * - Remove characters not accepted (& ' - !)
 * - Truncate to maxLen
 */
function sanitise(value: string, maxLen: number): string {
  return value
    .replace(/[&'!\-]/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitise the invoice/reference for Betterpay:
 * - Max 14 characters
 * - No & ' - characters
 * - Use only alphanumeric chars
 */
function sanitiseInvoice(reference: string): string {
  // Remove dashes and special chars, keep alphanumeric only, max 14 chars
  return reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14);
}

// ── Hash ─────────────────────────────────────────────────────────────────────
/**
 * Generate MD5 hash for payment request.
 * Formula: md5(apiKey + "|" + merchantId + "|" + invoice + "|" + amount + "|" + paymentDesc + "|" + currency)
 */
export function generateRequestHash(
  apiKey: string,
  merchantId: string,
  invoice: string,
  amount: string,
  paymentDesc: string,
  currency: string,
): string {
  const raw = `${apiKey}|${merchantId}|${invoice}|${amount}|${paymentDesc}|${currency}`;
  return createHash('md5').update(raw).digest('hex');
}

/**
 * Verify MD5 hash from webhook callback.
 * Formula: md5(apiKey + trxId + invoiceNo + txnStatus + msg)
 */
export function verifyBetterpayWebhook(
  apiKey: string,
  trxId: string,
  invoiceNo: string,
  txnStatus: string,
  msg: string,
  receivedHash: string,
): boolean {
  const raw = `${apiKey}${trxId}${invoiceNo}${txnStatus}${msg}`;
  const expected = createHash('md5').update(raw).digest('hex');
  // Use timing-safe comparison
  if (expected.length !== receivedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ receivedHash.charCodeAt(i);
  }
  return diff === 0;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type CreateBetterpayBillInput = {
  amountSen: number;
  reference: string;
  purpose: string;
  email: string;
  name: string;
  credentials: {
    apiKey: string;
    merchantId: string;
    mode: string;
    currency: string;
    paymentMethods: string[];
  };
  callbackUrlBe: string;
  callbackUrlFeSucc: string;
  callbackUrlFeFail: string;
};

export type CreateBetterpayBillResult = {
  url: string;
  invoice: string;
};

// ── Create Bill ───────────────────────────────────────────────────────────────
/**
 * Call Betterpay Create Bill API — returns a payment URL.
 */
export async function createBetterpayBill(
  input: CreateBetterpayBillInput,
): Promise<CreateBetterpayBillResult> {
  const { apiKey, merchantId, mode, currency, paymentMethods } = input.credentials;

  const invoice    = sanitiseInvoice(input.reference);
  const amount     = senToRinggit(input.amountSen).toFixed(2);
  const paymentDesc = sanitise(input.purpose, 1000);

  const hash = generateRequestHash(apiKey, merchantId, invoice, amount, paymentDesc, currency);

  const body = new URLSearchParams({
    merchant_id:          merchantId,
    invoice,
    amount,
    payment_desc:         paymentDesc,
    currency:             currency.toUpperCase(),
    hash,
    buyer_name:           sanitise(input.name, 100),
    buyer_email:          input.email,
    callback_url_be:      input.callbackUrlBe,
    callback_url_fe_succ: input.callbackUrlFeSucc,
    callback_url_fe_fail: input.callbackUrlFeFail,
    header_title:         'MR DIY Staff Meals',
    payment_method:       paymentMethods.join(','),
  });

  const res = await fetch(createBillUrl(mode), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Betterpay Create Bill failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    response: string;
    url?: string;
    merchant_id?: string;
  };

  if (data.response !== '00' || !data.url) {
    throw new Error(`Betterpay rejected bill: response=${data.response}`);
  }

  return { url: data.url, invoice };
}
