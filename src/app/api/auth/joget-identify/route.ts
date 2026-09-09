import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { provisionFromDirectory } from '@/lib/auth';
import { createSession, destroySession } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function base(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * This endpoint's whole job is to react to "who is logged into Joget right
 * now" - the exact same URL must NEVER be served from any cache (browser or
 * CDN), or a stale response for that URL could keep a different person's
 * outcome showing indefinitely. Every redirect below goes through this so
 * caching is impossible regardless of how the response was produced.
 */
function uncachedRedirect(path: string): NextResponse {
  const response = NextResponse.redirect(`${base()}${path}`);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  return response;
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
 * cannot cryptographically prove the request wasn't tampered with. To keep
 * this workable anyway:
 *   - a matching email auto-creates the account; role comes from the
 *     #currentUser.groups.name# hash variable via roleFromGroups() in
 *     rbac.ts, defaulting to USER for anything that isn't a recognised
 *     Admin/Finance/Analytics group name
 *   - per provisionFromDirectory()'s existing JOGET behaviour, role is
 *     re-synced from the group data on EVERY login, not just on creation -
 *     moving someone between Joget groups takes effect next time they open
 *     the app, but a manual role change in Admin -> Users would get
 *     overwritten by their next login here
 *   - a blank email always fails closed (see destroySession() call below)
 * Revisit this once real Joget API access is available (see conversation
 * notes) to add proper signature verification.
 */
export async function GET(request: Request) {
  // Always clear whatever session is currently sitting in the browser
  // first - this endpoint represents "log in as whoever Joget says is
  // currently active." If that fails below, the person should land on a
  // real error, never silently keep seeing the PREVIOUS person's session.
  await destroySession();

  const url = new URL(request.url);
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  const username = (url.searchParams.get('username') ?? '').trim();
  const name = (url.searchParams.get('name') ?? '').trim();
  const department = (url.searchParams.get('department') ?? '').trim();
  const staffId = (url.searchParams.get('staffId') ?? '').trim();
  // Joget's hash-variable engine comma-joins multi-value results, so a
  // person in several groups arrives as "Admin,Finance" etc.
  const groups = (url.searchParams.get('groups') ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  if (!email) {
    return uncachedRedirect('/login?error=sso_failed');
  }

  // provisionFromDirectory() creates the account on first login and, for
  // JOGET identities specifically, re-syncs the role from group membership
  // on every subsequent login too - so moving someone between Joget groups
  // takes effect the next time they open the app.
  const user = await provisionFromDirectory({
    provider: 'JOGET',
    externalId: username || email,
    email,
    name: name || email.split('@')[0],
    staffId: staffId || null,
    department: department || null,
    groups,
  });

  if (!user.active) {
    return uncachedRedirect('/login?error=inactive');
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

  return uncachedRedirect(landingPathFor(user.role));
}
