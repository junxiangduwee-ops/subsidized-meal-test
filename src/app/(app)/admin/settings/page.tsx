import { getTranslations } from 'next-intl/server';

import { requireCapability } from '@/lib/session';
import { getSiteSettings, DEFAULT_SETTINGS } from '@/lib/settings';
import { PageHeader, Section } from '@/components/ui';
import { ActionForm, InlineSubmit } from '@/components/action-form';

import { updateSiteSettings, uploadBrandingImage, resetBrandingImage } from './actions';

export const dynamic = 'force-dynamic';

function BrandingImageField({
  kind,
  label,
  hint,
  imageUrl,
  isDefault,
  previewClassName,
  t,
}: {
  kind: 'logo' | 'favicon';
  label: string;
  hint: string;
  imageUrl: string;
  isDefault: boolean;
  previewClassName: string;
  t: (key: string) => string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>

      <div className="flex items-center gap-3">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white ${previewClassName}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
        </div>

        <ActionForm
          action={uploadBrandingImage}
          submitLabel={t('upload')}
          variant="secondary"
          className="flex-1"
        >
          <input type="hidden" name="kind" value={kind} />
          <input
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp,image/x-icon"
            required
            className="input"
          />
        </ActionForm>
      </div>

      {!isDefault ? (
        <form action={resetBrandingImage} className="mt-2">
          <input type="hidden" name="kind" value={kind} />
          <InlineSubmit label={t('resetToDefault')} />
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-400">{t('usingDefault')}</p>
      )}
    </div>
  );
}

export default async function SettingsPage() {
  await requireCapability('settings:manage');
  const t = await getTranslations('settingsAdmin');
  const settings = await getSiteSettings();

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Section title={t('branding')} description={t('brandingHint')}>
        <div className="grid gap-6 p-5 sm:grid-cols-2">
          <BrandingImageField
            kind="logo"
            label={t('logo')}
            hint={t('logoHint')}
            imageUrl={settings.logoUrl}
            isDefault={settings.logoUrl === DEFAULT_SETTINGS.logoUrl}
            previewClassName="h-14 w-14"
            t={t}
          />
          <BrandingImageField
            kind="favicon"
            label={t('favicon')}
            hint={t('faviconHint')}
            imageUrl={settings.faviconUrl}
            isDefault={settings.faviconUrl === DEFAULT_SETTINGS.faviconUrl}
            previewClassName="h-9 w-9"
            t={t}
          />
        </div>

        <ActionForm
          action={updateSiteSettings}
          submitLabel={t('save')}
          resetOnSuccess={false}
          className="border-t border-slate-100 p-5"
        >
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
