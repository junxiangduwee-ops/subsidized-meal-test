'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { LOCALE_COOKIE, isLocale } from './config';
import { getCurrentUser } from '@/lib/session';

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  // In the embedded (Joget iframe) flow the app runs on a different origin
  // from the host page, so any cookie set with SameSite=Lax is silently
  // dropped by the browser as a third-party cookie. Mirror the same flags
  // the session cookie uses for the embed context so the locale change
  // actually sticks.
  const user = await getCurrentUser();
  const embed = user?.embed ?? false;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: embed ? true : process.env.NODE_ENV === 'production',
    sameSite: embed ? 'none' : 'lax',
    ...(embed ? { partitioned: true } : {}),
  });

  revalidatePath('/', 'layout');
}
