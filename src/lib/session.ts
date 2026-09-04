import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@prisma/client';

import { prisma } from './prisma';
import { can, type Capability } from './rbac';

const COOKIE_NAME = 'mrdiy_food_session';

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('AUTH_SECRET is missing or shorter than 32 characters. See .env.example.');
  }
  return new TextEncoder().encode(raw);
}

function ttlHours(): number {
  const n = Number.parseInt(process.env.SESSION_TTL_HOURS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string | null;
  staffId: string | null;
};

export async function createSession(user: SessionUser): Promise<void> {
  const expires = new Date(Date.now() + ttlHours() * 3600_000);

  const token = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Resolve the signed-in user. The JWT is only a pointer - the role and
 * active flag are re-read from the database on every request so that a
 * revoked account or changed role takes effect immediately.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  let sub: string | undefined;
  try {
    const { payload } = await jwtVerify(token, secret());
    sub = payload.sub;
  } catch {
    return null;
  }
  if (!sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      department: true,
      staffId: true,
      active: true,
    },
  });

  if (!user || !user.active) return null;
  const { active: _active, ...session } = user;
  return session;
}

/** Redirects to /login when signed out. Use at the top of protected pages. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** Redirects to /login, or to /forbidden when the capability is missing. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) redirect('/forbidden');
  return user;
}

/** Throws instead of redirecting - for use inside server actions. */
export async function assertCapability(capability: Capability): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  if (!can(user.role, capability)) throw new Error('You do not have permission to do that.');
  return user;
}
