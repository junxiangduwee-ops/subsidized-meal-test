/**
 * Entity → HitPay account mapping.
 *
 * Each entity has its own dedicated HitPay merchant account with separate
 * API key and salt. There is NO default fallback — if an entity's credentials
 * are not configured, checkout will fail with a clear error message.
 *
 * Required env vars per entity (replace ENTITY with the entity id in uppercase):
 *   HITPAY_API_KEY_RETAIL=xxx
 *   HITPAY_SALT_RETAIL=xxx
 *   HITPAY_API_KEY_ECOMMERCE=xxx
 *   HITPAY_SALT_ECOMMERCE=xxx
 *   HITPAY_API_KEY_PROPERTIES=xxx
 *   HITPAY_SALT_PROPERTIES=xxx
 *   HITPAY_API_KEY_GROUP=xxx
 *   HITPAY_SALT_GROUP=xxx
 *
 * Optional per entity (falls back to global if not set):
 *   HITPAY_CURRENCY_RETAIL=MYR
 *   HITPAY_PAYMENT_METHODS_RETAIL=touch_n_go,duitnow
 *   HITPAY_MODE_RETAIL=sandbox   (or 'live')
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

/**
 * Returns the HitPay credentials for a given entity.
 * Throws if the entity-specific API key or salt is not configured —
 * there is NO fallback to a default account.
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
  const salt = process.env[`HITPAY_SALT_${suffix}`] ?? '';

  if (!apiKey || !salt) {
    throw new Error(
      `HitPay credentials not configured for entity "${entityId}". ` +
      `Set HITPAY_API_KEY_${suffix} and HITPAY_SALT_${suffix} in environment variables.`
    );
  }

  const currency =
    process.env[`HITPAY_CURRENCY_${suffix}`] ??
    process.env.HITPAY_CURRENCY ??
    'MYR';

  const rawMethods =
    process.env[`HITPAY_PAYMENT_METHODS_${suffix}`] ??
    process.env.HITPAY_PAYMENT_METHODS ?? '';

  const paymentMethods = rawMethods.trim()
    ? rawMethods.split(',').map((m) => m.trim()).filter(Boolean)
    : ['touch_n_go', 'duitnow'];

  const mode =
    process.env[`HITPAY_MODE_${suffix}`] ??
    process.env.HITPAY_MODE ??
    'sandbox';

  return { apiKey, salt, currency, paymentMethods, mode };
}
