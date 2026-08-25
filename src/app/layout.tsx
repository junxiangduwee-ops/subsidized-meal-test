import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

import { getSiteSettings } from '@/lib/settings';

import './globals.css';

/**
 * Title and favicon come from the admin-editable site settings (see
 * admin/settings), defaulting to the shipped `public/mr-diy-logo.png` until
 * an admin uploads a replacement.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: settings.siteName,
    description: 'Weekly staff meal planning and ordering',
    icons: { icon: settings.faviconUrl },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

