/**
 * Entity credentials — tries admin-managed DB credentials first (AES-256-GCM
 * encrypted), falls back to env vars for backward compatibility.
 *
 * DB credentials are set via Admin → Companies → Entities.
 * Env vars still work as a fallback:
 *   HITPAY_API_KEY_RETAIL, HITPAY_SALT_RETAIL, ...
 */

import { prisma } from './prisma';
import { decrypt } from './encrypt';

/** Returns HitPay credentials for the given entity code. Async — tries DB first. */
export async function getEntityCredentials(entityCode: string): Promise<{
  apiKey: string;
  salt: string;
  currency: string;
  paymentMethods: string[];
  mode: string;
}> {
  const suffix = entityCode.toUpperCase();

  let apiKey: string;
  let salt: string;

  const entity = await prisma.entity.findUnique({
    where: { code: entityCode },
    select: { hitpayKeyEncrypted: true, hitpaySaltEncrypted: true },
  });

  if (entity?.hitpayKeyEncrypted && entity?.hitpaySaltEncrypted) {
    apiKey = decrypt(entity.hitpayKeyEncrypted);
    salt   = decrypt(entity.hitpaySaltEncrypted);
  } else {
    apiKey = process.env[`HITPAY_API_KEY_${suffix}`] ?? '';
    salt   = process.env[`HITPAY_SALT_${suffix}`]   ?? '';
    if (!apiKey || !salt) {
      throw new Error(
        `HitPay credentials not configured for entity "${entityCode}". ` +
        `Enter them in Admin → Companies → Entities, ` +
        `or set HITPAY_API_KEY_${suffix} and HITPAY_SALT_${suffix} as env vars.`,
      );
    }
  }

  const currency       = process.env[`HITPAY_CURRENCY_${suffix}`]        ?? process.env.HITPAY_CURRENCY        ?? 'MYR';
  const rawMethods     = process.env[`HITPAY_PAYMENT_METHODS_${suffix}`] ?? process.env.HITPAY_PAYMENT_METHODS ?? '';
  const paymentMethods = rawMethods.trim()
    ? rawMethods.split(',').map((m) => m.trim()).filter(Boolean)
    : ['touch_n_go', 'duitnow'];
  const mode = process.env[`HITPAY_MODE_${suffix}`] ?? process.env.HITPAY_MODE ?? 'sandbox';

  return { apiKey, salt, currency, paymentMethods, mode };
}

/** True when this entity has credentials — either in DB or as env vars. */
export function isEntityConfigured(entityCode: string, hasDbCreds: boolean): boolean {
  if (hasDbCreds) return true;
  const suffix = entityCode.toUpperCase();
  return !!(process.env[`HITPAY_API_KEY_${suffix}`] && process.env[`HITPAY_SALT_${suffix}`]);
}
