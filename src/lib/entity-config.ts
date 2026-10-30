/**
 * Entity → Payment Gateway account mapping.
 *
 * Each entity has its own dedicated payment gateway account.
 * No default fallback — if an entity's credentials are not configured,
 * checkout will fail with a clear error message.
 *
 * Current routing:
 *   retail     → HitPay
 *   ecommerce  → Betterpay
 *   properties → HitPay
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

/** Which gateway an entity uses */
export type GatewayType = 'hitpay' | 'betterpay';

export function getGatewayType(entityId: string): GatewayType {
  if (entityId === 'ecommerce') return 'betterpay';
  return 'hitpay';
}

/**
 * Returns HitPay credentials for a given entity.
 * Throws if credentials are not configured.
 */
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

/**
 * Returns Betterpay credentials for a given entity.
 * Throws if credentials are not configured.
 */
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
    : ['ewallet', 'dnqr'];
  const mode = process.env[`BETTERPAY_MODE_${suffix}`] ?? 'sandbox';

  return { apiKey, merchantId, currency, paymentMethods, mode };
}
