'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { assertCapability } from '@/lib/session';
import { audit } from '@/lib/orders';
import { DEFAULT_SETTINGS, SETTINGS_ID } from '@/lib/settings';
import { CACHE_TAGS } from '@/lib/cache';
import type { ActionState } from '@/components/action-form';

// ── File validation ──────────────────────────────────────────────────────────

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES: Record<string, boolean> = {
  'image/png':                true,
  'image/jpeg':               true,
  'image/webp':               true,
  'image/x-icon':             true,
  'image/vnd.microsoft.icon': true,
};

// ── Site settings ────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  siteName: z.string().trim().min(2, 'Site name must be at least 2 characters.').max(120),
  supportEmail: z.string().trim().email('Must be a valid email address.').optional().or(z.literal('')),
  maintenanceMessage: z.string().trim().max(500, 'Keep the banner under 500 characters.').optional(),
  mealReceiptCutoffHour: z.coerce.number().int().min(0).max(23),
  maxMealsPerDay: z.coerce.number().int().min(1, 'Must be at least 1.').max(10, 'Maximum is 10.'),
});

export async function updateSiteSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('settings:manage');

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    siteName: parsed.data.siteName,
    supportEmail: parsed.data.supportEmail || null,
    maintenanceMessage: parsed.data.maintenanceMessage?.trim() || null,
    mealReceiptCutoffHour: parsed.data.mealReceiptCutoffHour,
    maxMealsPerDay: parsed.data.maxMealsPerDay,
    updatedById: actor.id,
  };

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });

  await audit(actor.id, 'settings.update', 'AppSettings', SETTINGS_ID, {
    siteName: data.siteName,
    mealReceiptCutoffHour: data.mealReceiptCutoffHour,
    maxMealsPerDay: data.maxMealsPerDay,
  });

  revalidatePath('/', 'layout');
  revalidatePath('/admin/settings');
  revalidateTag(CACHE_TAGS.siteSettings);

  redirect('/admin/settings?saved=1');
}

export async function updateSiteSettingsPlain(formData: FormData): Promise<void> {
  await updateSiteSettings({}, formData);
}

// ── Branding images ──────────────────────────────────────────────────────────

const brandingKindSchema = z.enum(['logo', 'favicon']);
type BrandingKind = z.infer<typeof brandingKindSchema>;

const FIELD_FOR_KIND: Record<BrandingKind, 'logoUrl' | 'faviconUrl'> = {
  logo:    'logoUrl',
  favicon: 'faviconUrl',
};

export async function uploadBrandingImage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await assertCapability('settings:manage');

  const kindParsed = brandingKindSchema.safeParse(formData.get('kind'));
  if (!kindParsed.success) return { error: 'Unknown image type.' };
  const kind = kindParsed.data;
  const field = FIELD_FOR_KIND[kind];

  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose an image file first.' };
  if (file.size > MAX_UPLOAD_BYTES)
    return { error: 'Image is too large — please keep it under 2 MB.' };
  if (!ALLOWED_TYPES[file.type])
    return { error: 'Unsupported file type. Use PNG, JPEG, WEBP, or ICO.' };

  // Convert to base64 data URL — same as reception photo, no disk writes
  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, [field]: dataUrl, updatedById: actor.id },
    update: { [field]: dataUrl, updatedById: actor.id },
  });

  await audit(actor.id, 'settings.upload_branding_image', 'AppSettings', SETTINGS_ID, {
    kind,
    mimeType: file.type,
    sizeBytes: file.size,
  });

  revalidatePath('/', 'layout');
  revalidateTag(CACHE_TAGS.siteSettings);

  return { success: kind === 'logo' ? 'Logo updated.' : 'Favicon updated.' };
}

export async function resetBrandingImage(formData: FormData): Promise<void> {
  const actor = await assertCapability('settings:manage');

  const kindParsed = brandingKindSchema.safeParse(formData.get('kind'));
  if (!kindParsed.success) return;
  const kind = kindParsed.data;
  const field = FIELD_FOR_KIND[kind];

  await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, updatedById: actor.id },
    update: { [field]: null, updatedById: actor.id },
  });

  // No disk file to clean up — base64 is stored in the DB row
  await audit(actor.id, 'settings.reset_branding_image', 'AppSettings', SETTINGS_ID, {
    kind,
    defaultUrl: DEFAULT_SETTINGS[field],
  });

  revalidatePath('/', 'layout');
  revalidateTag(CACHE_TAGS.siteSettings);
}
