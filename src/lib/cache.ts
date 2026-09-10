import 'server-only';

import { unstable_cache } from 'next/cache';

import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Cached reference data.
//
// These lists change rarely (an admin adds/edits/deactivates a handful of
// rows a week) but get queried on every page load of some of the app's
// highest-traffic pages (menu, checkout, dish filters). Wrapping them in
// unstable_cache means most requests skip the DB entirely - the cache is
// only invalidated when a mutation actually touches that data, via the
// matching revalidateTag(...) call in each actions.ts file.
//
// A `revalidate` window is kept as a safety net in case a revalidateTag call
// is ever missed, so a stale entry heals itself within a few minutes either
// way.
// ---------------------------------------------------------------------------

export const CACHE_TAGS = {
  deliverySites: 'delivery-sites',
  subsidyRules: 'subsidy-rules',
  restaurants: 'restaurants',
  siteSettings: 'site-settings',
  departments: 'departments',
} as const;

export const getActiveDeliverySites = unstable_cache(
  async () =>
    prisma.deliverySite.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ['delivery-sites-active'],
  { tags: [CACHE_TAGS.deliverySites], revalidate: 300 },
);

export const getActiveSubsidyRules = unstable_cache(
  async () => prisma.subsidyRule.findMany({ where: { active: true } }),
  ['subsidy-rules-active'],
  { tags: [CACHE_TAGS.subsidyRules], revalidate: 300 },
);

export const getRestaurantsForDropdown = unstable_cache(
  async () =>
    prisma.restaurant.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, active: true },
    }),
  ['restaurants-dropdown'],
  { tags: [CACHE_TAGS.restaurants], revalidate: 300 },
);

// ---------------------------------------------------------------------------
// Admin catalogue/config pages below.
//
// These are cached too, since they're rarely-changing catalogue or config
// data - not the live, order-derived numbers (capacity remaining, payment
// totals, per-cycle stats) elsewhere in admin, which stay uncached on
// purpose: an admin checking "is this cycle full yet" or "did this payment
// come through" needs the real, current number, not one that's up to 5
// minutes stale. Caching those would trade a real speed win for a real risk
// of an admin making a decision off stale operational data.
//
// A shorter 60s revalidate (rather than 300s) is used on the two paginated
// admin lists below because they embed a live-ish secondary count
// (orders-per-site, dishes-per-restaurant) alongside the mostly-static
// catalogue fields - 60s bounds how stale that secondary number can get
// between an edit and the next tag-based invalidation picking it up.
// ---------------------------------------------------------------------------

export const getSiteSettingsCached = unstable_cache(
  async () => {
    const row = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    return row;
  },
  ['site-settings-singleton'],
  { tags: [CACHE_TAGS.siteSettings], revalidate: 300 },
);

export const getDeliverySitesPage = unstable_cache(
  async (page: number, pageSize: number) => {
    const [total, sites] = await Promise.all([
      prisma.deliverySite.count(),
      prisma.deliverySite.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { orders: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, sites };
  },
  ['delivery-sites-admin-page'],
  { tags: [CACHE_TAGS.deliverySites], revalidate: 60 },
);

export const getRestaurantsPage = unstable_cache(
  async (page: number, pageSize: number) => {
    const [total, restaurants] = await Promise.all([
      prisma.restaurant.count(),
      prisma.restaurant.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { dishes: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, restaurants };
  },
  ['restaurants-admin-page'],
  { tags: [CACHE_TAGS.restaurants], revalidate: 60 },
);

export const getSubsidyRulesPage = unstable_cache(
  async (page: number, pageSize: number) => {
    const [total, activeCount, rules] = await Promise.all([
      prisma.subsidyRule.count(),
      prisma.subsidyRule.count({ where: { active: true } }),
      prisma.subsidyRule.findMany({
        orderBy: [{ active: 'desc' }, { priority: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, activeCount, rules };
  },
  ['subsidy-rules-admin-page'],
  { tags: [CACHE_TAGS.subsidyRules], revalidate: 60 },
);

/** Distinct department names in use - a small, slow-changing lookup list
 * used by several admin forms/filters (users, subsidy rule scoping). */
export const getDepartments = unstable_cache(
  async () => {
    const rows = await prisma.user.findMany({
      where: { department: { not: null } },
      distinct: ['department'],
      select: { department: true },
      orderBy: { department: 'asc' },
    });
    return rows.map((r) => r.department!).filter(Boolean);
  },
  ['departments-distinct'],
  { tags: [CACHE_TAGS.departments], revalidate: 300 },
);
