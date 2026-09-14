'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { LOCALES, LOCALE_LABEL } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

/**
 * Language picker for the embedded sidebar. Sits above the SideNav items
 * and matches the sidebar's section-heading + select style so it looks
 * native alongside "Next week's menu" and "My orders".
 */
export function SidebarLanguageSwitcher() {
  const t = useTranslations('userMenu');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function changeLocale(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className="mb-6 px-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {t('language')}
      </p>
      <select
        className="input w-full"
        value={locale}
        onChange={(e) => changeLocale(e.target.value)}
        disabled={pending}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABEL[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
