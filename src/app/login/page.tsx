import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getCurrentUser } from '@/lib/session';
import { landingPathFor } from '@/lib/rbac';
import { isLdapEnabled, isOidcEnabled } from '@/lib/auth';
import { getSiteSettings } from '@/lib/settings';

import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(landingPathFor(user.role));

  const t = await getTranslations('login');
  const settings = await getSiteSettings();

  /** Error codes the OIDC routes redirect back with. */
  const ssoErrors: Record<string, string> = {
    sso_disabled: t('ssoDisabled'),
    sso_state: t('ssoStateExpired'),
    sso_failed: t('ssoFailed'),
    inactive: t('ssoInactive'),
  };

  const { error } = await searchParams;
  const ssoError = error ? ssoErrors[error] : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={settings.logoUrl} alt="" className="mx-auto mb-3 h-14 w-14 object-contain" />
          <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        </div>

        <div className="card-pad">
          {ssoError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {ssoError}
            </div>
          ) : null}
          <LoginForm ssoEnabled={isOidcEnabled()} ldapEnabled={isLdapEnabled()} />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          {settings.supportEmail ? t('contactCustom', { email: settings.supportEmail }) : t('contact')}
        </p>
      </div>
    </main>
  );
}
