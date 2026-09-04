import 'server-only';

import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';

import { prisma } from './prisma';
import { ldapProvider } from './auth/ldap';
import type { ExternalIdentity } from './auth/providers';
import { isLdapEnabled, isOidcEnabled } from './auth/providers';

export { isLdapEnabled, isOidcEnabled };

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export type AuthResult =
  { ok: true; user: User } | { ok: false; reason: 'invalid' | 'inactive' | 'no-local-password' };

/**
 * Verify an email/password credential.
 *
 * Order matters: a local password wins if one is set, so break-glass admin
 * accounts keep working when the directory is unreachable. Otherwise LDAP is
 * tried, and a matching directory user is provisioned on first sign-in.
 */
export async function authenticate(emailRaw: string, password: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && !existing.active) return { ok: false, reason: 'inactive' };

  if (existing?.passwordHash) {
    const match = await bcrypt.compare(password, existing.passwordHash);
    if (match) {
      return { ok: true, user: await markSignedIn(existing.id) };
    }
    // Fall through to LDAP: the account may have been migrated to the
    // directory while keeping a stale local hash.
  }

  if (isLdapEnabled()) {
    const identity = await ldapProvider.verify(email, password);
    if (identity) {
      return { ok: true, user: await provisionFromDirectory(identity) };
    }
  }

  if (existing && !existing.passwordHash && !isLdapEnabled()) {
    // SSO-only account trying to use the password form.
    return { ok: false, reason: 'no-local-password' };
  }

  // Equalise timing a little so a wrong email is not obviously faster than
  // a wrong password.
  if (!existing) await bcrypt.compare(password, DUMMY_HASH);

  return { ok: false, reason: 'invalid' };
}

// A real bcrypt hash of a value nobody will guess, used only for timing.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7bJUmmnzHrJPcNPlQZfLBBFhVXjKQ4W';

/**
 * Create or refresh the local mirror of a directory account. Role is only
 * assigned on creation - once an admin changes someone's role here, the
 * directory must not silently overwrite it.
 */
export async function provisionFromDirectory(identity: ExternalIdentity): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: identity.email } });

  if (existing) {
    if (!existing.active) throw new Error('This account has been deactivated.');
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        name: identity.name || existing.name,
        staffId: identity.staffId ?? existing.staffId,
        department: identity.department ?? existing.department,
        authProvider: identity.provider,
        externalId: identity.externalId,
        lastLoginAt: new Date(),
      },
    });
  }

  return prisma.user.create({
    data: {
      email: identity.email,
      name: identity.name,
      staffId: identity.staffId ?? null,
      department: identity.department ?? null,
      authProvider: identity.provider,
      externalId: identity.externalId,
      role: 'USER', // new directory accounts always start as employees
      lastLoginAt: new Date(),
    },
  });
}

async function markSignedIn(userId: string): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

/** Basic strength gate for locally managed passwords. */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain a number.';
  return null;
}
