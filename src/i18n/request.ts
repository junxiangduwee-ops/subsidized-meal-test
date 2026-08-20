import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from './config';

/**
 * Cookie-based locale, deliberately not next-intl's path-segment routing
 * (`/en/menu`, `/ms/menu`). This is an internal tool with no need for
 * localized URLs, and adopting path-based routing would mean restructuring
 * every existing route folder under `[locale]`. A cookie is far less
 * invasive to retrofit onto an app this size.
 */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value ?? '';
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
