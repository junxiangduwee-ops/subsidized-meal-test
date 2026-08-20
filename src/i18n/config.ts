export const LOCALES = ['en', 'ms', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: '中文',
};

export const LOCALE_COOKIE = 'locale';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
