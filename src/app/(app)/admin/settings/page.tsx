import { getTranslations } from 'next-intl/server';

import { requireCapability } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { PageHeader, Section } from '@/components/ui';
import { ActionForm } from '@/components/action-form';

import { updateSiteSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireCapability('settings:manage');
  const t = await getTranslations('settingsAdmin');
  const settings = await getSiteSettings();

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Section title={t('branding')} description={t('brandingHint')}>
        <ActionForm action={updateSiteSettings} submitLabel={t('save')} resetOnSuccess={false} className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">{t('siteName')}</label>
              <input
                name="siteName"
                type="text"
                defaultValue={settings.siteName}
                maxLength={120}
                required
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">{t('siteNameHint')}</p>
            </div>

            <div>
              <label className="label">{t('logoUrl')}</label>
              <input
                name="logoUrl"
                type="url"
                defaultValue={settings.logoUrl ?? ''}
                placeholder="https://…/logo.png"
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">{t('logoUrlHint')}</p>
              {settings.logoUrl ? (
                <div className="mt-2 flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={settings.logoUrl} alt="" className="h-full w-full object-contain" />
                </div>
              ) : null}
            </div>

            <div>
              <label className="label">{t('faviconUrl')}</label>
              <input
                name="faviconUrl"
                type="url"
                defaultValue={settings.faviconUrl ?? ''}
                placeholder="https://…/favicon.png"
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">{t('faviconUrlHint')}</p>
              {settings.faviconUrl ? (
                <div className="mt-2 flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={settings.faviconUrl} alt="" className="h-full w-full object-contain" />
                </div>
              ) : null}
            </div>

            <div>
              <label className="label">{t('supportEmail')}</label>
              <input
                name="supportEmail"
                type="email"
                defaultValue={settings.supportEmail ?? ''}
                placeholder="it-support@company.com"
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">{t('supportEmailHint')}</p>
            </div>

            <div className="sm:col-span-2">
              <label className="label">{t('maintenanceMessage')}</label>
              <textarea
                name="maintenanceMessage"
                defaultValue={settings.maintenanceMessage ?? ''}
                rows={2}
                maxLength={500}
                placeholder={t('maintenanceMessagePlaceholder')}
                className="input"
              />
              <p className="mt-1 text-xs text-slate-500">{t('maintenanceMessageHint')}</p>
            </div>
          </div>
        </ActionForm>
      </Section>
    </>
  );
}
