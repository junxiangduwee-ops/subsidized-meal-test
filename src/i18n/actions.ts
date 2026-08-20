'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { LOCALE_COOKIE, isLocale } from './config';

export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  // Every server-rendered page reads the locale via the request config, so
  // the whole layout tree needs invalidating - not just the current path -
  // or a different tab/page would keep showing the old language until its
  // own next natural revalidation.
  revalidatePath('/', 'layout');
}
