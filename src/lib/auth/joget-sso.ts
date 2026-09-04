import 'server-only';

import { jwtVerify } from 'jose';

import { prisma } from '../prisma';
import type { ExternalIdentity } from './providers';

/**
 * Verifies the short-lived handoff token Joget mints for an already-logged-in
 * user when it embeds this app in an iframe, so the person never sees a
 * second login screen.
 *
 * Token contract (HS256 JWT, symmetric key shared with Joget):
 *   iss: "joget"
 *   aud: "food-ordering-app"          (or whatever you set JOGET_SSO_AUDIENCE to)
 *   sub: "<joget username or user id>"
 *   jti: "<random unique id, single use>"
 *   exp: now + 30s (short - it is only used once, immediately)
 *   email, name, staffId?, department?, groups: string[]
 *
 * The signing secret is JOGET_SSO_SECRET - 32+ random bytes, known only to
 * the Joget-side token minter and this app. Never expose it to the browser.
 */

export function isJogetSsoEnabled(): boolean {
  return process.env.AUTH_JOGET_SSO_ENABLED === 'true' && Boolean(process.env.JOGET_SSO_SECRET);
}

function secret(): Uint8Array {
  const raw = process.env.JOGET_SSO_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('JOGET_SSO_SECRET is missing or shorter than 32 characters.');
  }
  return new TextEncoder().encode(raw);
}

export type SsoTokenResult =
  | { ok: true; identity: ExternalIdentity }
  | { ok: false; reason: 'invalid' | 'replayed' };

export async function verifySsoToken(token: string): Promise<SsoTokenResult> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, secret(), {
      issuer: process.env.JOGET_SSO_ISSUER ?? 'joget',
      audience: process.env.JOGET_SSO_AUDIENCE ?? 'food-ordering-app',
      // Handoff tokens are minted seconds before use - do not accept stale ones.
      maxTokenAge: '60s',
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    console.warn('[auth] Joget SSO token failed verification:', err);
    return { ok: false, reason: 'invalid' };
  }

  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!jti || !sub || !email) return { ok: false, reason: 'invalid' };

  // Single-use: the first redemption wins, everything after is a replay.
  try {
    const expiresAt =
      typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : new Date(Date.now() + 60_000);
    await prisma.ssoNonce.create({ data: { jti, expiresAt } });
  } catch {
    // Unique constraint violation -> this jti was already redeemed.
    return { ok: false, reason: 'replayed' };
  }

  const groups = Array.isArray(payload.groups) ? payload.groups.filter((g): g is string => typeof g === 'string') : [];

  return {
    ok: true,
    identity: {
      provider: 'JOGET',
      externalId: sub,
      email,
      name: typeof payload.name === 'string' && payload.name ? payload.name : email.split('@')[0],
      staffId: typeof payload.staffId === 'string' ? payload.staffId : null,
      department: typeof payload.department === 'string' ? payload.department : null,
      groups,
    },
  };
}

/** Best-effort cleanup of expired nonces - call occasionally, e.g. from a cron route. */
export async function pruneExpiredSsoNonces(): Promise<number> {
  const { count } = await prisma.ssoNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
