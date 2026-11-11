import 'server-only';

import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';

import { prisma } from './prisma';
import { ldapProvider } from './auth/ldap';
import type { ExternalIdentity } from './auth/providers';
import { isLdapEnabled, isOidcEnabled } from './auth/providers';
import { roleFromGroups } from './rbac';

export { isLdapEnabled, isOidcEnabled };

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export type AuthResult =
  { ok: true; user: User } | { ok: false; reason: 'invalid' | 'inactive' | 'no-local-password' };

/**
 * Verify an email-or-employee-ID/password credential.
 *
 * Some employees have no email account at all, so login accepts either
 * their email or their employee ID (staffId) as the identifier - whichever
 * looks like an email is looked up by that column, otherwise by staffId.
 * The password check itself is unchanged either way.
 *
 * Order matters: a local password wins if one is set, so break-glass admin
 * accounts keep working when the directory is unreachable. Otherwise LDAP is
 * tried, and a matching directory user is provisioned on first sign-in.
 */
export async function authenticate(identifierRaw: string, password: string): Promise<AuthResult> {
  const identifier = identifierRaw.trim();
  const looksLikeEmail = identifier.includes('@');
  const existing = await prisma.user.findFirst({
    where: looksLikeEmail ? { email: identifier.toLowerCase() } : { staffId: identifier },
  });

  if (existing && !existing.active) return { ok: false, reason: 'inactive' };

  if (existing?.passwordHash) {
    const match = await bcrypt.compare(password, existing.passwordHash);
    if (match) {
      return { ok: true, user: await markSignedIn(existing.id, 'LOCAL') };
    }
    // Fall through to LDAP: the account may have been migrated to the
    // directory while keeping a stale local hash.
  }

  // LDAP directories are keyed by corporate email - an employee-ID login
  // is, by definition, someone without one, so there is nothing to look
  // up there.
  const triedLdap = looksLikeEmail && isLdapEnabled();
  if (triedLdap) {
    const identity = await ldapProvider.verify(identifier.toLowerCase(), password);
    if (identity) {
      return { ok: true, user: await provisionFromDirectory(identity) };
    }
  }

  if (existing && !existing.passwordHash && !triedLdap) {
    // SSO-only account trying to use the password form.
    return { ok: false, reason: 'no-local-password' };
  }

  // Equalise timing a little so a wrong identifier is not obviously faster
  // than a wrong password.
  if (!existing) await bcrypt.compare(password, DUMMY_HASH);

  return { ok: false, reason: 'invalid' };
}

// A real bcrypt hash of a value nobody will guess, used only for timing.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7bJUmmnzHrJPcNPlQZfLBBFhVXjKQ4W';

/**
 * Create or refresh the local mirror of a directory account.
 *
 * Matching: the employee code (staffId) is tried first - it's the one
 * identifier guaranteed to exist and stay stable for a real employee (the
 * Joget side calls it #currentUser.employee.code#) - falling back to email
 * only when no staffId is given or it doesn't match anyone yet. This also
 * safely merges an account that started email-only once its employee code
 * becomes known, instead of creating a duplicate that would collide on the
 * unique email constraint.
 *
 * Role handling differs by provider:
 *   - JOGET identities carry `groups`, and JOGET is the source of truth for
 *     who's an Admin/Finance/Analytics user, so role is (re-)computed from
 *     `roleFromGroups()` on every login, creation included - moving someone
 *     between Joget groups takes effect the next time they open the app.
 *   - All other providers (LDAP today) only assign a role on creation
 *     ('USER'); once an admin changes someone's role here, a later LDAP
 *     login must not silently overwrite it.
 *
 * Name handling is the same for every provider: the directory-supplied
 * name only seeds the record when the account is first created. On every
 * later login (JOGET via staffId, JOGET via email, LDAP, or OIDC all share
 * this one code path) the locally stored name is kept as-is, so a
 * correction made in Admin -> Users sticks instead of being silently
 * overwritten the next time the person opens the embedded view.
 */
export async function provisionFromDirectory(identity: ExternalIdentity): Promise<User> {
  if (!identity.email && !identity.staffId) {
    throw new Error('This identity has neither an email nor an employee ID to match on.');
  }

  const byStaffId = identity.staffId
    ? await prisma.user.findUnique({ where: { staffId: identity.staffId } })
    : null;

  // Only trust the staffId match if the email also agrees (or no email was provided).
  // A wrong staffId from the directory must not land on a different (possibly inactive)
  // account and lock the real user out.
  const staffIdConflict =
    byStaffId && identity.email && byStaffId.email && byStaffId.email !== identity.email;
  if (staffIdConflict) {
    console.warn(
      `[auth] staffId ${identity.staffId} matched ${byStaffId!.email} ` +
      `but incoming email is ${identity.email} — discarding staffId match, falling back to email. ` +
      `Fix the staffId in the directory to remove this warning.`,
    );
  }
  const staffIdMatch = staffIdConflict ? null : byStaffId;
  const matchedByStaffId = !!staffIdMatch;

  const existing =
    staffIdMatch ?? (identity.email ? await prisma.user.findUnique({ where: { email: identity.email } }) : null);

  const role = identity.provider === 'JOGET' ? roleFromGroups(identity.groups) : undefined;

  if (existing) {
    if (!existing.active) throw new Error('This account has been deactivated.');
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        // Name is only seeded on first creation — manual corrections in Admin → Users survive.
        name: existing.name || identity.name,
        email: identity.email ?? existing.email,
        // Only update staffId when we matched by staffId (high confidence).
        // If we fell back to email, the incoming staffId may be wrong — keep the existing one.
        staffId: matchedByStaffId ? (identity.staffId ?? existing.staffId) : existing.staffId,
        department: identity.department ?? existing.department,
        authProvider: identity.provider,
        externalId: identity.externalId,
        role: role ?? existing.role,
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
      role: role ?? 'USER', // new directory accounts default to employees unless JOGET says otherwise
      lastLoginAt: new Date(),
    },
  });
}

async function markSignedIn(userId: string, provider: 'LOCAL' | 'LDAP' = 'LOCAL'): Promise<User> {
  return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date(), authProvider: provider } });
}

/** Basic strength gate for locally managed passwords. */
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must contain a number.';
  return null;
}
