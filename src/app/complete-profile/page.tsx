import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getCurrentUser } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { prisma } from '@/lib/prisma';

import { LOSLogo } from '@/components/los-logo';
import { CompleteProfileForm } from './complete-profile-form';

export const dynamic = 'force-dynamic';

export default async function CompleteProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Double-check the DB flag (session token does not carry it).
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { profileCompleted: true, phone: true },
  });

  // Already done — send them to their landing page.
  if (dbUser?.profileCompleted) {
    redirect(user.embed ? '/menu' : '/');
  }

  const t = await getTranslations('completeProfile');
  const settings = await getSiteSettings();

  return (
    // Works inside the Joget iframe (embed=true) and as a standalone page.
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-4">
          <LOSLogo size="lg" stacked />
          <div className="text-center">
            <h1 className="text-xl font-semibold text-slate-900">{t('title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
          </div>
        </div>

        <div className="card-pad">
          <CompleteProfileForm
            currentEmail={user.email}
            currentPhone={dbUser?.phone ?? null}
            isEmbed={user.embed}
          />
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">{t('privacy')}</p>
      </div>
    </main>
  );
}
