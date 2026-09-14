'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { LOCALES, LOCALE_LABEL } from '@/i18n/config';
import { setLocale } from '@/i18n/actions';

/**
 * A compact language-select shown in the embedded sticky bar, where the
 * normal UserMenu (which also has a language picker) is hidden because
 * the Joget host page already provides the surrounding chrome.
 */
export function LanguageSwitcher() {
  const t = useTranslations('userMenu');
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  function changeLocale(next: string) {
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5 px-2">
      <label className="shrink-0 text-xs text-slate-500">{t('language')}:</label>
      <select
        className="h-7 rounded-md border border-slate-200 bg-white py-0 pl-2 pr-6 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
        value={locale}
        onChange={(e) => changeLocale(e.target.value)}
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
