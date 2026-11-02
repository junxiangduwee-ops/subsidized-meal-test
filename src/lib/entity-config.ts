/**
 * Entity → Payment Gateway account mapping.
 *
 * Current routing:
 *   retail     → HitPay
 *   ecommerce  → Betterpay
 *   properties → ADAPTIS (eGHL)
 *   group      → HitPay
 */

export const ENTITIES = [
  { id: 'retail',     label: 'MR DIY Retail' },
  { id: 'ecommerce',  label: 'MR DIY Ecommerce' },
  { id: 'properties', label: 'MR DIY Properties' },
  { id: 'group',      label: 'MR DIY Group' },
] as const;

export type EntityId = (typeof ENTITIES)[number]['id'];

export function isValidEntityId(id: string): id is EntityId {
  return ENTITIES.some((e) => e.id === id);
}

export type GatewayType = 'hitpay' | 'betterpay' | 'adaptis';

export function getGatewayType(entityId: string): GatewayType {
  if (entityId === 'ecommerce') return 'betterpay';
  if (entityId === 'properties') return 'adaptis';
  return 'hitpay';
}

/** HitPay credentials */
export function getEntityCredentials(entityId: string): {
  apiKey: string;
  salt: string;
  currency: string;
  paymentMethods: string[];
  mode: string;
} {
  const suffix = entityId.toUpperCase();
  const apiKey = process.env[`HITPAY_API_KEY_${suffix}`] ?? '';
  const salt   = process.env[`HITPAY_SALT_${suffix}`] ?? '';

  if (!apiKey || !salt) {
    throw new Error(
      `HitPay credentials not configured for entity "${entityId}". ` +
      `Set HITPAY_API_KEY_${suffix} and HITPAY_SALT_${suffix}.`
    );
  }

  const currency = process.env[`HITPAY_CURRENCY_${suffix}`] ?? process.env.HITPAY_CURRENCY ?? 'MYR';
  const rawMethods = process.env[`HITPAY_PAYMENT_METHODS_${suffix}`] ?? process.env.HITPAY_PAYMENT_METHODS ?? '';
  const paymentMethods = rawMethods.trim()
    ? rawMethods.split(',').map((m) => m.trim()).filter(Boolean)
    : ['touch_n_go', 'duitnow'];
  const mode = process.env[`HITPAY_MODE_${suffix}`] ?? process.env.HITPAY_MODE ?? 'sandbox';

  return { apiKey, salt, currency, paymentMethods, mode };
}

/** ADAPTIS (eGHL) credentials */
export function getAdaptisCredentials(entityId: string): {
  serviceId: string;
  password: string;
  currency: string;
  pymtMethod: string;
  mode: string;
} {
  const suffix = entityId.toUpperCase();
  const serviceId = process.env[`ADAPTIS_SERVICE_ID_${suffix}`] ?? '';
  const password  = process.env[`ADAPTIS_PASSWORD_${suffix}`] ?? '';

  if (!serviceId || !password) {
    throw new Error(
      `ADAPTIS credentials not configured for entity "${entityId}". ` +
      `Set ADAPTIS_SERVICE_ID_${suffix} and ADAPTIS_PASSWORD_${suffix}.`
    );
  }

  const currency   = process.env[`ADAPTIS_CURRENCY_${suffix}`] ?? 'MYR';
  const pymtMethod = process.env[`ADAPTIS_PYMT_METHOD_${suffix}`] ?? 'ANY';
  const mode       = process.env[`ADAPTIS_MODE_${suffix}`] ?? 'staging';

  return { serviceId, password, currency, pymtMethod, mode };
}

/** Betterpay credentials */
export function getBetterpayCredentials(entityId: string): {
  apiKey: string;
  merchantId: string;
  currency: string;
  paymentMethods: string[];
  mode: string;
} {
  const suffix = entityId.toUpperCase();
  const apiKey     = process.env[`BETTERPAY_API_KEY_${suffix}`] ?? '';
  const merchantId = process.env[`BETTERPAY_MERCHANT_ID_${suffix}`] ?? '';

  if (!apiKey || !merchantId) {
    throw new Error(
      `Betterpay credentials not configured for entity "${entityId}". ` +
      `Set BETTERPAY_API_KEY_${suffix} and BETTERPAY_MERCHANT_ID_${suffix}.`
    );
  }

  const currency = process.env[`BETTERPAY_CURRENCY_${suffix}`] ?? 'MYR';
  const rawMethods = process.env[`BETTERPAY_PAYMENT_METHODS_${suffix}`] ?? '';
  const paymentMethods = rawMethods.trim()
    ? rawMethods.split(',').map((m) => m.trim()).filter(Boolean)
    : ['ewallet'];
  const mode = process.env[`BETTERPAY_MODE_${suffix}`] ?? 'sandbox';

  return { apiKey, merchantId, currency, paymentMethods, mode };
}
