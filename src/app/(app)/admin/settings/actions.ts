'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { SETTINGS_ID } from '@/lib/settings';
import type { ActionState } from '@/components/action-form';

const urlOrEmpty = z.string().trim().url('Must be a valid URL.').optional().or(z.literal(''));

const settingsSchema = z.object({
  siteName: z.string().trim().min(2, 'Site name must be at least 2 characters.').max(120),
  logoUrl: urlOrEmpty,
  faviconUrl: urlOrEmpty,
  supportEmail: z.string().trim().email('Must be a valid email address.').optional().or(z.literal('')),
  maintenanceMessage: z.string().trim().max(500, 'Keep the banner under 500 characters.').optional(),
});

export async function updateSiteSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('settings:manage');

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    siteName: parsed.data.siteName,
    logoUrl: parsed.data.logoUrl || null,
    faviconUrl: parsed.data.faviconUrl || null,
    supportEmail: parsed.data.supportEmail || null,
    maintenanceMessage: parsed.data.maintenanceMessage?.trim() || null,
    updatedById: actor.id,
  };

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });

  await audit(actor.id, 'settings.update', 'AppSettings', SETTINGS_ID, {
    siteName: data.siteName,
    hasLogo: Boolean(data.logoUrl),
    hasFavicon: Boolean(data.faviconUrl),
  });

  // The favicon/title are read in the root layout and the branding shows up
  // in the app header and login screen too - all need to reflect a change
  // immediately, not just the settings page itself.
  revalidatePath('/', 'layout');

  return { success: 'Settings saved.' };
}
