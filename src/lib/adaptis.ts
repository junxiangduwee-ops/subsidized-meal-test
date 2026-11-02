import { createHash } from 'crypto';
import { headers } from 'next/headers';

/**
 * ADAPTIS (eGHL) payment gateway integration.
 *
 * Docs: eGHL Internet Payment Gateway Merchant Integration Guide v2.8n
 * Staging URL: https://pay.e-ghl.com/IPGSG/Payment.aspx
 *
 * Key differences from HitPay/Betterpay:
 * - Uses HTML form POST to redirect user to payment page (not REST API)
 * - SHA256 for hash (not HMAC-SHA256, not MD5)
 * - Hash key = Password + ServiceID + PaymentID + MerchantReturnURL +
 *              MerchantApprovalURL + MerchantUnApprovalURL +
 *              MerchantCallBackURL + Amount + CurrencyCode + CustIP +
 *              PageTimeout + CardNo + Token
 * - Success TxnStatus = '0'
 * - Callback must respond with 'OK'
 */

// ── URLs ────────────────────────────────────────────────────────────────────
const STAGING_URL = 'https://pay.e-ghl.com/IPGSG/Payment.aspx';
const LIVE_URL    = 'https://pay.e-ghl.com/IPG/Payment.aspx';

export function getAdaptisPaymentUrl(mode: string): string {
  return mode === 'live' ? LIVE_URL : STAGING_URL;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function senToRinggit(sen: number): string {
  return (sen / 100).toFixed(2);
}

// ── Hash ─────────────────────────────────────────────────────────────────────
/**
 * Generate SHA256 hash for payment request.
 * Hash Key = Password + ServiceID + PaymentID + MerchantReturnURL +
 *            MerchantApprovalURL + MerchantUnApprovalURL +
 *            MerchantCallBackURL + Amount + CurrencyCode + CustIP +
 *            PageTimeout + CardNo + Token
 * (Empty optional fields are left blank in the hash key string)
 */
export function generateAdaptisRequestHash(params: {
  password: string;
  serviceId: string;
  paymentId: string;
  merchantReturnUrl: string;
  merchantApprovalUrl?: string;
  merchantUnApprovalUrl?: string;
  merchantCallBackUrl?: string;
  amount: string;
  currencyCode: string;
  custIp: string;
  pageTimeout?: string;
  cardNo?: string;
  token?: string;
}): string {
  const raw =
    params.password +
    params.serviceId +
    params.paymentId +
    params.merchantReturnUrl +
    (params.merchantApprovalUrl ?? '') +
    (params.merchantUnApprovalUrl ?? '') +
    (params.merchantCallBackUrl ?? '') +
    params.amount +
    params.currencyCode +
    params.custIp +
    (params.pageTimeout ?? '') +
    (params.cardNo ?? '') +
    (params.token ?? '');

  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Verify SHA256 hash from payment response (HashValue2 — highly recommended).
 * Hash Key = Password + TxnID + ServiceID + PaymentID + TxnStatus +
 *            Amount + CurrencyCode + AuthCode + OrderNumber + Param6 + Param7
 */
export function verifyAdaptisResponseHash(params: {
  password: string;
  txnId: string;
  serviceId: string;
  paymentId: string;
  txnStatus: string;
  amount: string;
  currencyCode: string;
  authCode?: string;
  orderNumber?: string;
  param6?: string;
  param7?: string;
  receivedHash: string;
}): boolean {
  const raw =
    params.password +
    params.txnId +
    params.serviceId +
    params.paymentId +
    params.txnStatus +
    params.amount +
    params.currencyCode +
    (params.authCode ?? '') +
    (params.orderNumber ?? '') +
    (params.param6 ?? '') +
    (params.param7 ?? '');

  const expected = createHash('sha256').update(raw).digest('hex');
  if (expected.length !== params.receivedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ params.receivedHash.charCodeAt(i);
  }
  return diff === 0;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type AdaptisPaymentFormData = {
  TransactionType: string;
  PymtMethod: string;
  ServiceID: string;
  PaymentID: string;
  OrderNumber: string;
  PaymentDesc: string;
  MerchantReturnURL: string;
  MerchantApprovalURL: string;
  MerchantUnApprovalURL: string;
  MerchantCallBackURL: string;
  Amount: string;
  CurrencyCode: string;
  CustIP: string;
  CustName: string;
  CustEmail: string;
  CustPhone: string;
  HashValue: string;
  LanguageCode: string;
  paymentUrl: string;
};

export type CreateAdaptisPaymentInput = {
  amountSen: number;
  reference: string;
  purpose: string;
  email: string;
  name: string;
  phone?: string;
  credentials: {
    serviceId: string;
    password: string;
    mode: string;
    currency: string;
    pymtMethod: string;
  };
  approvalUrl: string;
  unApprovalUrl: string;
  callbackUrl: string;
};

/**
 * Build the form fields to POST to eGHL payment page.
 * Returns the form data and payment URL — client renders an auto-submit form.
 */
export async function createAdaptisPayment(
  input: CreateAdaptisPaymentInput,
): Promise<AdaptisPaymentFormData> {
  const { serviceId, password, mode, currency, pymtMethod } = input.credentials;

  if (!serviceId || !password) {
    throw new Error('ADAPTIS credentials not configured.');
  }

  const amount      = senToRinggit(input.amountSen);
  // PaymentID must be unique per attempt — add timestamp suffix so retries
  // after a failed/expired payment don't hit the unique constraint.
  // Max 20 chars: base (up to 16) + 4-char base36 timestamp suffix.
  const base        = input.reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const suffix      = Date.now().toString(36).slice(-4).toUpperCase();
  const paymentId   = (base + suffix).slice(0, 20);
  const orderNumber = input.reference.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  const paymentUrl  = getAdaptisPaymentUrl(mode);

  // Get client IP from headers
  const hdrs = await headers();
  const custIp =
    hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    hdrs.get('x-real-ip') ??
    '127.0.0.1';

  // MerchantReturnURL is used for all responses unless Approval/UnApproval provided
  const merchantReturnUrl = input.approvalUrl;

  const hashValue = generateAdaptisRequestHash({
    password,
    serviceId,
    paymentId,
    merchantReturnUrl,
    merchantApprovalUrl:   input.approvalUrl,
    merchantUnApprovalUrl: input.unApprovalUrl,
    merchantCallBackUrl:   input.callbackUrl,
    amount,
    currencyCode:          currency,
    custIp,
  });

  return {
    TransactionType:      'SALE',
    PymtMethod:           pymtMethod,
    ServiceID:            serviceId,
    PaymentID:            paymentId,
    OrderNumber:          orderNumber,
    PaymentDesc:          input.purpose.slice(0, 100),
    MerchantReturnURL:    merchantReturnUrl,
    MerchantApprovalURL:  input.approvalUrl,
    MerchantUnApprovalURL: input.unApprovalUrl,
    MerchantCallBackURL:  input.callbackUrl,
    Amount:               amount,
    CurrencyCode:         currency,
    CustIP:               custIp,
    CustName:             input.name.slice(0, 50),
    CustEmail:            input.email.slice(0, 60),
    CustPhone:            (input.phone ?? '-').slice(0, 25),
    HashValue:            hashValue,
    LanguageCode:         'en',
    paymentUrl,
  };
}
