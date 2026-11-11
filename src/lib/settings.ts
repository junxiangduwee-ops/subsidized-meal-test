import { getSiteSettingsCached } from '@/lib/cache';

export const SETTINGS_ID = 'singleton';

export type SiteSettings = {
  siteName: string;
  logoUrl: string;
  faviconUrl: string;
  supportEmail: string | null;
  maintenanceMessage: string | null;
  /// Hour (0–23) in APP_TIMEZONE after which unconfirmed meals are auto-confirmed.
  mealReceiptCutoffHour: number;
  /// Maximum subsidised meals per employee per service day.
  maxMealsPerDay: number;
  /// Whether employees can self-cancel a PAID order and queue a HitPay refund.
  selfCancelEnabled: boolean;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'LOS',
  logoUrl: '/mr-diy-logo.png',
  faviconUrl: '/mr-diy-logo.png',
  supportEmail: null,
  maintenanceMessage: null,
  mealReceiptCutoffHour: 18,
  maxMealsPerDay: 1,
  selfCancelEnabled: false,
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const row = await getSiteSettingsCached();

  return {
    siteName: row?.siteName || DEFAULT_SETTINGS.siteName,
    logoUrl: row?.logoUrl || DEFAULT_SETTINGS.logoUrl,
    faviconUrl: row?.faviconUrl || DEFAULT_SETTINGS.faviconUrl,
    supportEmail: row?.supportEmail ?? null,
    maintenanceMessage: row?.maintenanceMessage ?? null,
    mealReceiptCutoffHour: row?.mealReceiptCutoffHour ?? DEFAULT_SETTINGS.mealReceiptCutoffHour,
    maxMealsPerDay: row?.maxMealsPerDay ?? DEFAULT_SETTINGS.maxMealsPerDay,
    selfCancelEnabled: row?.selfCancelEnabled ?? DEFAULT_SETTINGS.selfCancelEnabled,
  };
}

/** Formats the cutoff hour as a human-readable string, e.g. 18 → "6:00 PM" */
export function formatCutoffHour(hour: number): string {
  const date = new Date(2000, 0, 1, hour, 0, 0);
  return date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true });
}
