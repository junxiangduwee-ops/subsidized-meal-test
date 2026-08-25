import { prisma } from '@/lib/prisma';

/**
 * Site settings are a single row, always read/written by this fixed id -
 * there is no per-user or per-tenant settings concept in this app.
 */
export const SETTINGS_ID = 'singleton';

export type SiteSettings = {
  siteName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  supportEmail: string | null;
  maintenanceMessage: string | null;
};

/** Used until an admin saves the settings form for the first time. */
export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'MR DIY Food Ordering',
  logoUrl: null,
  faviconUrl: null,
  supportEmail: null,
  maintenanceMessage: null,
};

/**
 * Reads the site settings row, falling back to defaults if nothing has been
 * saved yet. Safe to call from Server Components, layouts, and
 * `generateMetadata` - it never throws.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  const row = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (!row) return DEFAULT_SETTINGS;

  return {
    siteName: row.siteName || DEFAULT_SETTINGS.siteName,
    logoUrl: row.logoUrl,
    faviconUrl: row.faviconUrl,
    supportEmail: row.supportEmail,
    maintenanceMessage: row.maintenanceMessage,
  };
}
