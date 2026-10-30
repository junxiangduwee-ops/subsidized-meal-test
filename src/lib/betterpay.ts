import { createHash } from 'crypto';

const SANDBOX_CREATE_BILL = 'https://www.demo.betterpay.me/merchant/api/v2/create_bill';
const LIVE_CREATE_BILL    = 'https://www.betterpay.me/merchant/api/v2/create_bill';

function createBillUrl(mode: string): string {
  return mode === 'live' ? LIVE_CREATE_BILL : SANDBOX_CREATE_BILL;
}

function senToRinggit(sen: number): number {
  return sen / 100;
}

function sanitise(value: string, maxLen: number): string {
  return value.replace(/[&'!\-]/g, ' ').trim().slice(0, maxLen);
}

/**
 * Generate a unique invoice string for each payment attempt.
 * Uses a timestamp suffix to avoid requestId conflicts on retry.
 * Max 14 chars, no & ' - characters.
 */
function sanitiseInvoice(reference: string): string {
  const base = reference.replace(/[^a-zA-Z0-9]/g, '');
  // 3-char base36 timestamp suffix ensures uniqueness on retry
  const suffix = Date.now().toString(36).slice(-3).toUpperCase();
  return (base.slice(0, 11) + suffix).slice(0, 14);
}

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
  if (expected.length !== receivedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ receivedHash.charCodeAt(i);
  }
  return diff === 0;
}

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
  callbackUrlBe?: string;
  callbackUrlFeSucc?: string;
  callbackUrlFeFail?: string;
};

export type CreateBetterpayBillResult = {
  url: string;
  invoice: string;
};

export async function createBetterpayBill(
  input: CreateBetterpayBillInput,
): Promise<CreateBetterpayBillResult> {
  const { apiKey, merchantId, mode, currency, paymentMethods } = input.credentials;

  if (!apiKey || !merchantId) {
    throw new Error('Betterpay credentials not configured.');
  }

  const invoice     = sanitiseInvoice(input.reference);
  const amount      = senToRinggit(input.amountSen).toFixed(2);
  const paymentDesc = sanitise(input.purpose, 1000);
  const hash        = generateRequestHash(apiKey, merchantId, invoice, amount, paymentDesc, currency);

  const body = new URLSearchParams({
    merchant_id:   merchantId,
    invoice,
    amount,
    payment_desc:  paymentDesc,
    currency:      currency.toUpperCase(),
    hash,
    buyer_name:    sanitise(input.name, 100),
    buyer_email:   input.email,
    header_title:  'MR DIY Staff Meals',
  });

  if (paymentMethods.length > 0) {
    body.set('payment_method', paymentMethods.join(','));
  }

  // Pass invoice in callback URLs so return handler can look up order
  if (input.callbackUrlBe) {
    body.set('callback_url_be', input.callbackUrlBe);
  }
  if (input.callbackUrlFeSucc) {
    body.set('callback_url_fe_succ',
      `${input.callbackUrlFeSucc}?invoice=${encodeURIComponent(invoice)}&status=success`
    );
  }
  if (input.callbackUrlFeFail) {
    body.set('callback_url_fe_fail',
      `${input.callbackUrlFeFail}?invoice=${encodeURIComponent(invoice)}&status=failed`
    );
  }

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
  };

  if (data.response !== '00' || !data.url) {
    throw new Error(`Betterpay rejected bill: response=${data.response}`);
  }

  return { url: data.url, invoice };
}
