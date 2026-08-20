import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { getCurrentUser } from '@/lib/session';
import { landingPathFor, ROLE_LABEL } from '@/lib/rbac';
import { logoutAction } from '@/app/login/actions';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage() {
  const user = await getCurrentUser();
  const t = await getTranslations('forbidden');

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card-pad max-w-md text-center">
        <h1 className="text-lg font-semibold text-slate-900">{t('title')}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {user
            ? t('signedInAs', { name: user.name, role: ROLE_LABEL[user.role] })
            : t('needSignIn')}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href={user ? landingPathFor(user.role) : '/login'} className="btn-primary">
            {user ? t('backToDashboard') : t('signIn')}
          </Link>
          {user ? (
            // This page sits outside the app shell, so it needs its own way
            // out - otherwise a wrong-role sign-in is a dead end.
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary">
                {t('signOut')}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
