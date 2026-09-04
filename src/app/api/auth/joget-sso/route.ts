import { NextResponse } from 'next/server';

import { isJogetSsoEnabled, verifySsoToken } from '@/lib/auth/joget-sso';
import { provisionFromDirectory } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function base(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * GET /api/auth/joget-sso?token=<jwt>
 *
 * Point the Joget-side iframe's `src` at this URL (with a fresh token
 * appended) instead of at the app directly. On success this sets a session
 * cookie and redirects straight into the app - the person never sees the
 * login form. See src/lib/auth/joget-sso.ts for the token contract.
 */
export async function GET(request: Request) {
  if (!isJogetSsoEnabled()) {
    return NextResponse.redirect(`${base()}/login?error=sso_disabled`);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(`${base()}/login?error=sso_failed`);
  }

  const result = await verifySsoToken(token);
  if (!result.ok) {
    const error = result.reason === 'replayed' ? 'sso_state' : 'sso_failed';
    return NextResponse.redirect(`${base()}/login?error=${error}`);
  }

  try {
    const user = await provisionFromDirectory(result.identity);
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
        metadata: { provider: 'JOGET_SSO' },
      },
    });

    return NextResponse.redirect(`${base()}${landingPathFor(user.role)}`);
  } catch (err) {
    console.error('[auth] Joget SSO provisioning failed:', err);
    return NextResponse.redirect(`${base()}/login?error=sso_failed`);
  }
}
