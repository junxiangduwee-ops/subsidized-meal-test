'use server';

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '@/lib/settings';
import type { ActionState } from '@/components/action-form';

// Uploaded files are written straight to disk under public/, which needs a
// writable, persistent filesystem. That's true for a normal Node server
// (e.g. `next start` on a VM/Docker), but NOT for most serverless hosts
// (Vercel's function filesystem is read-only outside /tmp and doesn't
// persist across deploys or instances). If this is deployed there, swap the
// two `writeFile` calls below for an object-storage upload (Supabase
// Storage, S3, Vercel Blob) and keep everything else the same.
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'branding');
const UPLOAD_URL_PREFIX = '/uploads/branding';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

const settingsSchema = z.object({
  siteName: z.string().trim().min(2, 'Site name must be at least 2 characters.').max(120),
  supportEmail: z.string().trim().email('Must be a valid email address.').optional().or(z.literal('')),
  maintenanceMessage: z.string().trim().max(500, 'Keep the banner under 500 characters.').optional(),
});

export async function updateSiteSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('settings:manage');

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    siteName: parsed.data.siteName,
    supportEmail: parsed.data.supportEmail || null,
    maintenanceMessage: parsed.data.maintenanceMessage?.trim() || null,
    updatedById: actor.id,
  };

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });

  await audit(actor.id, 'settings.update', 'AppSettings', SETTINGS_ID, { siteName: data.siteName });

  // The site name is read in the root layout, header, and login screen -
  // all need to reflect a change immediately, not just the settings page.
  revalidatePath('/', 'layout');

  return { success: 'Settings saved.' };
}

const brandingKindSchema = z.enum(['logo', 'favicon']);
type BrandingKind = z.infer<typeof brandingKindSchema>;

const FIELD_FOR_KIND: Record<BrandingKind, 'logoUrl' | 'faviconUrl'> = {
  logo: 'logoUrl',
  favicon: 'faviconUrl',
};

export async function uploadBrandingImage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('settings:manage');

  const kindParsed = brandingKindSchema.safeParse(formData.get('kind'));
  if (!kindParsed.success) return { error: 'Unknown image type.' };
  const kind = kindParsed.data;

  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image file first.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: 'Image is too large - please keep it under 2 MB.' };
  }
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return { error: 'Unsupported file type. Use PNG, JPEG, WEBP, or ICO.' };
  }

  const current = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  const field = FIELD_FOR_KIND[kind];
  const previousUrl = current?.[field] ?? null;

  const filename = `${kind}-${Date.now()}${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), bytes);
  } catch (err) {
    console.error('[settings] Failed to save uploaded branding image', err);
    return {
      error:
        'Could not save the file on the server. If this is a serverless deployment, uploads need object storage instead of local disk.',
    };
  }

  const publicUrl = `${UPLOAD_URL_PREFIX}/${filename}`;

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, [field]: publicUrl, updatedById: actor.id },
    update: { [field]: publicUrl, updatedById: actor.id },
  });

  // Best-effort cleanup of the previous upload - never block on this, and
  // skip it entirely for the shipped default (there's no file to delete).
  if (previousUrl && previousUrl.startsWith(`${UPLOAD_URL_PREFIX}/`)) {
    void unlink(path.join(process.cwd(), 'public', previousUrl)).catch(() => {});
  }

  await audit(actor.id, 'settings.upload_branding_image', 'AppSettings', SETTINGS_ID, { kind, filename });
  revalidatePath('/', 'layout');

  return { success: kind === 'logo' ? 'Logo updated.' : 'Favicon updated.' };
}

/** Clears an uploaded override so the shipped default image is used again. */
export async function resetBrandingImage(formData: FormData): Promise<void> {
  const actor = await assertCapability('settings:manage');

  const kindParsed = brandingKindSchema.safeParse(formData.get('kind'));
  if (!kindParsed.success) return;
  const kind = kindParsed.data;
  const field = FIELD_FOR_KIND[kind];

  const current = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  const previousUrl = current?.[field] ?? null;

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, updatedById: actor.id },
    update: { [field]: null, updatedById: actor.id },
  });

  if (previousUrl && previousUrl.startsWith(`${UPLOAD_URL_PREFIX}/`)) {
    void unlink(path.join(process.cwd(), 'public', previousUrl)).catch(() => {});
  }

  await audit(actor.id, 'settings.reset_branding_image', 'AppSettings', SETTINGS_ID, {
    kind,
    defaultUrl: DEFAULT_SETTINGS[field],
  });
  revalidatePath('/', 'layout');
}
