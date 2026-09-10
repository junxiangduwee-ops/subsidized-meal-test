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
