import { prisma } from '@/lib/prisma';

/**
 * Site settings are a single row, always read/written by this fixed id -
 * there is no per-user or per-tenant settings concept in this app.
 */
export const SETTINGS_ID = 'singleton';

export type SiteSettings = {
  siteName: string;
  logoUrl: string;
  faviconUrl: string;
  supportEmail: string | null;
  maintenanceMessage: string | null;
};

/**
 * The logo/favicon shipped in `public/mr-diy-logo.png` are the defaults
 * until an admin uploads a replacement in Settings. Site name falls back to
 * this too if the row is missing entirely (first run, before anyone has
 * saved the settings form).
 */
export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'MR DIY Food Ordering',
  logoUrl: '/mr-diy-logo.png',
  faviconUrl: '/mr-diy-logo.png',
  supportEmail: null,
  maintenanceMessage: null,
};

/**
 * Reads the site settings row, falling back to defaults field-by-field so
 * clearing an override (e.g. removing an uploaded logo) reverts just that
 * one field to the shipped default rather than requiring the whole row to
 * be absent. Safe to call from Server Components, layouts, and
 * `generateMetadata` - it never throws.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });

  return {
    siteName: row?.siteName || DEFAULT_SETTINGS.siteName,
    logoUrl: row?.logoUrl || DEFAULT_SETTINGS.logoUrl,
    faviconUrl: row?.faviconUrl || DEFAULT_SETTINGS.faviconUrl,
    supportEmail: row?.supportEmail ?? null,
    maintenanceMessage: row?.maintenanceMessage ?? null,
  };
}
