import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { createSession, destroySession } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function base(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * GET /api/auth/joget-identify?username=...&email=...&name=...
 *
 * Point the Joget-side iframe/link at this URL, with #currentUser.username#,
 * #currentUser.email#, and #currentUser.firstName# #currentUser.lastName#
 * filled in via plain Joget hash-variable substitution (no scripting needed
 * on the Joget side).
 *
 * IMPORTANT - security trade-off, on purpose: there is no signature here.
 * Without working server-to-server API access on this Joget instance, we
 * cannot cryptographically prove the request wasn't tampered with, so this
 * route deliberately does NOT auto-create accounts or set roles from it -
 * it only logs in someone whose account an admin already created by hand
 * (Admin -> Users) with a matching email. That keeps the blast radius of a
 * forged request limited to "log in as an account that already exists and
 * whose email you already knew", not "create/escalate an arbitrary account".
 * Revisit this once real Joget API access is available (see conversation
 * notes) to add proper signature verification and auto-provisioning.
 */
export async function GET(request: Request) {
  // Always clear whatever session is currently sitting in the browser
  // first - this endpoint represents "log in as whoever Joget says is
  // currently active." If that fails below, the person should land on a
  // real error, never silently keep seeing the PREVIOUS person's session.
  await destroySession();

  const url = new URL(request.url);
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();

  if (!email) {
    return NextResponse.redirect(`${base()}/login?error=sso_failed`);
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return NextResponse.redirect(`${base()}/login?error=not_provisioned`);
  }
  if (!user.active) {
    return NextResponse.redirect(`${base()}/login?error=inactive`);
  }

  await createSession(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department,
      staffId: user.staffId,
    },
    { crossSiteEmbed: true },
  );

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      metadata: { provider: 'JOGET_IDENTIFY_UNSIGNED' },
    },
  });

  return NextResponse.redirect(`${base()}${landingPathFor(user.role)}`);
}
