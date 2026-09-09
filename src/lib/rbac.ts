import type { Role } from '@prisma/client';

/**
 * Capability-based access control. Pages and server actions check a
 * capability, never a role literal, so adding a role later is a one-line
 * change to this table.
 */
export const CAPABILITIES = [
  'catalogue:manage', // restaurants, dishes, prices
  'menu:plan', // create/edit/publish weekly cycles
  'users:manage', // create users, change roles
  'subsidy:manage', // create/edit company subsidy rules
  'order:place', // build a cart and check out
  'analytics:view', // demand, participation, popularity dashboards
  'finance:view', // revenue, subsidy cost, payment reconciliation
  'finance:export', // download settlement / payroll files
  'kitchen:view', // per-restaurant production counts after cutoff
  'settings:manage', // site branding, favicon, support email, maintenance banner
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  ADMIN: [
    'catalogue:manage',
    'menu:plan',
    'users:manage',
    'subsidy:manage',
    'order:place',
    'analytics:view',
    'finance:view',
    'finance:export',
    'kitchen:view',
    'settings:manage',
  ],
  ANALYTICS: ['analytics:view', 'kitchen:view', 'order:place'],
  FINANCE: ['finance:view', 'finance:export', 'analytics:view', 'order:place'],
  USER: ['order:place'],
};

export function can(role: Role | undefined | null, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function canAny(role: Role | undefined | null, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

export function capabilitiesFor(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

/** Where each role lands after signing in. */
export function landingPathFor(role: Role): string {
  switch (role) {
    case 'ADMIN':
      return '/admin/cycles';
    case 'ANALYTICS':
      return '/analytics';
    case 'FINANCE':
      return '/finance';
    default:
      return '/menu';
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  ANALYTICS: 'Analytics',
  FINANCE: 'Finance',
  USER: 'Employee',
};

/**
 * Maps directory group names (Joget group names, lower-cased) to a Role.
 * Configured via JOGET_GROUP_ROLE_MAP, e.g.
 *   "Admin:ADMIN,Finance:FINANCE,Analytics:ANALYTICS"
 * Groups not listed fall through to USER. Parsed once per process.
 */
function parseGroupRoleMap(): Record<string, Role> {
  const raw = process.env.JOGET_GROUP_ROLE_MAP ?? 'Admin:ADMIN,Finance:FINANCE,Analytics:ANALYTICS';
  const map: Record<string, Role> = {};
  for (const pair of raw.split(',')) {
    const [group, role] = pair.split(':').map((s) => s.trim());
    if (!group || !role) continue;
    if (!['ADMIN', 'ANALYTICS', 'FINANCE', 'USER'].includes(role)) continue;
    map[group.toLowerCase()] = role as Role;
  }
  return map;
}

const GROUP_ROLE_MAP = parseGroupRoleMap();

/** Highest-privilege role implied by a user's directory groups. Defaults to USER. */
export function roleFromGroups(groups: string[] | undefined | null): Role {
  const priority: Role[] = ['ADMIN', 'FINANCE', 'ANALYTICS', 'USER'];
  const matched = new Set(
    (groups ?? []).map((g) => GROUP_ROLE_MAP[g.trim().toLowerCase()]).filter((r): r is Role => Boolean(r)),
  );
  return priority.find((role) => matched.has(role)) ?? 'USER';
}