# LOS — Lunch Ordering System

Weekly staff meal planning and ordering. Admins plan a menu two weeks ahead,
publish it, staff order until the Wednesday cutoff, and the food is served the
following week. The company subsidy is applied automatically; staff pay the
remainder through HitPay.

> **Review before use.** This system was built with AI assistance. Verify the
> business rules, pricing, subsidy policy and payment configuration against your
> own requirements before deploying it or making decisions from its reports.
> Anything touching payroll, payments or employee data needs authorised sign-off.

---

## The weekly cycle

```
Week W-2   Admin drafts the menu for service week W          (DRAFT)
Week W-1   Mon 00:00  publish → ordering opens               (PUBLISHED)
Week W-1   Wed 17:00  cutoff → ordering closes               (CLOSED)
Week W     Mon–Fri    food served                            (FULFILLED)
```

- A cycle is identified by the **Monday of the week the food is served**.
- The cutoff weekday and time are configurable (`ORDER_CUTOFF_*`) and can be
  overridden per cycle in the admin UI.
- All wall-clock reasoning happens in `APP_TIMEZONE` (default `Asia/Kuala_Lumpur`).
- Once a menu is published, dishes and prices are locked.

## Roles

Access is capability-based (`src/lib/rbac.ts`), not role-literal.

| Role              | Can                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **Administrator** | Restaurants, dishes, menus, subsidy rules, users, companies, entities, audit log, settings, bulk refund; also orders their own meals. **Does not have Finance access** — Finance is a separate department. |
| **Analytics**     | Demand dashboards, participation, top dishes, kitchen counts; also orders their own meals                       |
| **Finance**       | Revenue, subsidy cost, per-entity HitPay reconciliation, CSV exports; also sees analytics and orders their own meals |
| **Reception**     | Mark meals as received/collected at the delivery site they are assigned to                                      |
| **Employee**      | Browse the open menu and order for next week; self-cancel within the ordering window                            |

> **superAdmin flag:** A user with `superAdmin = true` in the database bypasses all capability checks and sees every navigation item and page, regardless of their assigned role. This is for break-glass system administrators only — set via Prisma Studio or a direct DB update, not via the UI.

## Entities and Companies

The system is multi-entity. Each **Entity** is a legal entity with its own HitPay
account (e.g. MR D.I.Y Trading Sdn Bhd). Each **Company** belongs to one entity
and groups the employees who pay through that entity's HitPay account.

Managed via **Admin → Companies**:
- Add/edit entities and their HitPay credentials (encrypted in DB).
- Add/edit companies and assign them to an entity.
- Enable or disable a company's access via its entitlement flag.

An order's payment is routed through the entity that the ordering employee's
company belongs to.

## Subsidies

Rules live in **Admin → Subsidies**. Three types:

- **Fixed per item** — e.g. RM 5.00 off each dish
- **Percentage** — e.g. 60% off, optionally capped per item
- **Daily cap** — the company never pays more than RM X per person per day

How they combine:

1. One per-item rule is chosen: highest `priority` wins; a `DEPARTMENT` rule
   beats an `ALL` rule at equal priority.
2. Applied per unit, never exceeding the unit price.
3. The daily cap limits total subsidy across every line sharing a service date,
   scaled down proportionally with exact integer conservation.

Whatever is left is what the employee pays. A fully subsidised order skips the
payment gateway entirely. Rules are snapshotted onto the order at checkout.

## Cancel and Refund

Employees can self-cancel a paid order while the cycle's ordering window is open
(between `orderOpenAt` and `orderCutoffAt`). Self-cancel is toggled in
**Admin → Settings** (`selfCancelEnabled`).

A cancellation request queues the order as `REFUND_PENDING`. A nightly cron job
at **8 pm MYT** calls the HitPay refund API for every pending order. Failed
attempts retry each night for up to **7 attempts**, then the order is marked
`REFUND_FAILED` for manual follow-up.

Admins can also refund immediately via **Admin → Bulk Refund**, which filters
by cycle, service day, restaurant and dish. The Bulk Refund page shows an amber
warning banner listing every `REFUND_FAILED` order with the employee name, staff
ID, food items, amount, and service week so the admin can find and retry the
correct order immediately.

## Money

Every monetary column is an **integer number of sen** (1 MYR = 100 sen). No
floats, no `Decimal` serialisation issues. Format with `formatSen()` from
`src/lib/money.ts`.

---

## Getting started

**Prerequisites:** Node 20+. Postgres is optional for local dev — see below.

```bash
npm install
cp .env.example .env
# Fill in AUTH_SECRET and HITPAY_ENCRYPTION_KEY at minimum, then:
npm run db:push && npm run db:seed && npm run dev
```

Generate the required secrets:

```bash
openssl rand -base64 48   # → AUTH_SECRET
openssl rand -hex 32      # → HITPAY_ENCRYPTION_KEY
openssl rand -hex 32      # → CRON_SECRET
```

The seed prints one sign-in per role. **Change those passwords before this
touches a real environment.**

### Postgres or SQLite

With no `DATABASE_URL` configured the app falls back to **SQLite** at
`prisma/dev.db` (zero setup, development only). Point it at Postgres:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mrdiy_food?schema=public"
```

The provider is inferred from the URL scheme, or forced with
`DATABASE_PROVIDER=postgresql|sqlite`.

**SQLite is for development and demos.** Use Postgres for anything with real
users — concurrent writes during the lunch rush need it.

### Other commands

```bash
npm run test        # cycle arithmetic + subsidy engine (no DB needed)
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run db:studio   # browse the database (Prisma Studio)
npm run db:push     # sync schema to DB (no migration files)
npm run db:reset    # DESTRUCTIVE — drop everything, then re-seed
```

---

## HitPay

Each entity has its own HitPay account. Credentials are managed two ways:

**Preferred — Admin UI (encrypted in DB):**

1. Go to **Admin → Companies → Entities**.
2. Add or edit an entity, enter the API key and webhook salt.
3. The app encrypts them with `HITPAY_ENCRYPTION_KEY` (AES-256-GCM) before saving.

**Fallback — environment variables:**

```
HITPAY_API_KEY_TRADING="..."
HITPAY_SALT_TRADING="..."
HITPAY_MODE_TRADING="sandbox"
```

DB credentials take absolute priority. Env vars are only checked when no DB
credential exists for that entity.

**`HITPAY_ENCRYPTION_KEY` is required** to use DB-stored credentials. Generate
with `openssl rand -hex 32`. Back it up — losing it makes all stored keys
unreadable.

**The webhook is the only thing that marks an order paid.** Register it at:

```
{APP_URL}/api/webhooks/hitpay
```

The handler verifies the HMAC signature, rejects underpayments, is idempotent
(HitPay retries until 200), and returns a failed order to `CART` so the
employee can retry.

`APP_URL` must be reachable by HitPay — no localhost. Use a tunnel (ngrok,
Cloudflare Tunnel) for local testing.

---

## Authentication

Local email + password is always available. Additional options:

**LDAP / Active Directory** — set `AUTH_LDAP_ENABLED=true` plus `LDAP_*` vars.
Binds as a service account, searches by email, re-binds as the user. New users
are provisioned as Employee on first sign-in; an admin promotes them.

**OIDC / SSO** — set `AUTH_OIDC_ENABLED=true` plus `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`. Authorization Code + PKCE flow, works
with Entra ID / Azure AD. Register redirect URI: `{APP_URL}/api/auth/oidc/callback`.

**Joget embedded (iframe) mode** — set `AUTH_JOGET_SSO_ENABLED=true`. Joget
calls `/api/auth/joget-identify` with a signed JWT. The app provisions the user,
maps Joget group names to roles via `JOGET_GROUP_ROLE_MAP`, and assigns their
company if `companyCode=<code>` is passed in the SSO URL. The page then renders
in a minimal mobile layout inside the iframe.

Notes:

- A local password wins if one is set — break-glass admin accounts keep working
  when the directory is unreachable.
- Roles are assigned on creation and never overwritten by the directory.
- Role and active status are re-read from the database on every request, so
  revoking an account takes effect immediately.

---

## Deploying to Vercel

**SQLite will not work on Vercel** — the filesystem is ephemeral. Use Postgres.

1. **Create a Postgres database** (Supabase, Neon, Vercel Postgres, or any
   managed Postgres). On Supabase, use both URLs:
   - `DATABASE_URL` — transaction pooler (`:6543?pgbouncer=true`)
   - `DIRECT_URL` — session pooler (`:5432`) for schema pushes

2. **Set environment variables** in Vercel → Settings → Environment Variables:

   | Variable                | Value                                              |
   | ----------------------- | -------------------------------------------------- |
   | `DATABASE_URL`          | pooled Postgres URL                                |
   | `DIRECT_URL`            | direct/session URL (Supabase only)                 |
   | `AUTH_SECRET`           | `openssl rand -base64 48`                          |
   | `HITPAY_ENCRYPTION_KEY` | `openssl rand -hex 32`                             |
   | `CRON_SECRET`           | `openssl rand -hex 32`                             |
   | `APP_URL`               | `https://<your-project>.vercel.app`                |
   | `HITPAY_MODE`           | `sandbox` until ready for real money               |
   | `APP_TIMEZONE`          | `Asia/Kuala_Lumpur`                                |

   HitPay credentials per entity are entered via Admin → Companies after deploy,
   not as env vars (they are encrypted in the database).

3. **Push the schema:**

   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npm run db:push
   ```

4. **Seed sample data** (optional):

   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" \
   SEED_DEFAULT_PASSWORD="$(openssl rand -base64 18)" npm run db:seed
   ```

   Creates 4 entities, 4 companies, 13 staff accounts, 4 restaurants, 16 dishes,
   3 subsidy rules, and 5 service weeks. Sign-in list printed at the end.

   `SEED_DEFAULT_PASSWORD` is required for remote databases — the default is
   published here, so seeding without it is refused.

5. **Deploy.** `npm run build` runs `prisma generate` automatically.

### Before going live

- Enter live HitPay API keys and salts via **Admin → Companies → Entities**.
- Switch `HITPAY_MODE` to `live`.
- Confirm the webhook reaches `{APP_URL}/api/webhooks/hitpay`.
- Change every seeded password.

---

## Scheduled jobs (cron)

On Vercel, `vercel.json` schedules these automatically. For self-hosted
deployments, call the same URLs on a schedule with
`Authorization: Bearer <CRON_SECRET>`.

| Endpoint                        | Schedule (MYT) | Purpose                                              |
| ------------------------------- | -------------- | ---------------------------------------------------- |
| `/api/cron/process-refunds`     | Daily 8pm      | Attempt HitPay refund for all `REFUND_PENDING` orders |
| `/api/cron/confirm-meals`       | Daily 6pm      | Auto-mark uncollected meals as received               |
| `/api/cron/close-cycles`        | Daily 5pm      | Flip overdue `PUBLISHED` cycles to `CLOSED`           |
| `/api/cron/expire-orders`       | Daily 10am     | Cancel `AWAITING_PAYMENT` orders older than 24h       |

`/api/cron` (no suffix) runs all four jobs in one request — use this for
self-hosted crontab entries:

```bash
# /etc/cron.d/mrdiy-food  (times in UTC = MYT-8)
0 12 * * * root curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/cron
```

---

## Data protection

The Finance exports contain **employee names, staff IDs and departments**. That
is personal data:

- Only `finance:export` (**Finance** role only; Admin no longer has this capability) can download them.
- Every export is written to the audit log.
- Keep the files on approved systems; share only within Finance and HR.

Other notes:

- Passwords are bcrypt-hashed at cost 12 and never logged.
- HitPay API keys and salts are AES-256-GCM encrypted at rest.
- Raw HitPay webhook payloads are stored on `Payment.rawPayload` for dispute
  handling — treat as sensitive.
- Do not put real employee records into a shared or public deployment without
  approval.

---

## Project layout

```
prisma/
  schema.prisma          data model (Postgres form); money is integer sen
  seed.ts                4 entities, 4 companies, 13 accounts, 5 service weeks

scripts/
  db-config.mjs          provider resolution + SQLite schema derivation
  prisma.mjs             runs Prisma CLI against the right schema

src/lib/
  cycle.ts               week arithmetic, ordering windows, phases
  subsidy.ts             the subsidy engine (pure, fully tested)
  orders.ts              cart, capacity, repricing, checkout guards
  hitpay.ts              gateway client + webhook signature verification
  entity-config.ts       entity HitPay credentials (DB-first, env fallback)
  encrypt.ts             AES-256-GCM encrypt/decrypt for stored credentials
  refund.ts              queue and process HitPay refunds, eligibility check
  rbac.ts                capability table
  session.ts             JWT cookie session
  auth.ts                provider chain: local → LDAP → OIDC → Joget
  reporting.ts           aggregates for Analytics / Finance / Kitchen
  cache.ts               unstable_cache wrappers for analytics dashboard
  money.ts, csv.ts       formatting and safe CSV output
  db-compat.ts           Postgres/SQLite differences in one file

src/app/(app)/
  menu/                  employee: browse and order
  orders/                employee: history, order detail, retry payment
  admin/cycles/          plan, publish, close weekly menus
  admin/restaurants/     vendors
  admin/dishes/          catalogue and prices
  admin/subsidies/       company contribution rules
  admin/users/           accounts and roles
  admin/companies/       entities, companies, entitlements
  admin/bulk-refund/     select and immediately refund paid orders
  analytics/             demand, participation, popularity — by entity tab
  finance/               spend, subsidy cost, reconciliation, exports
  kitchen/               production counts per restaurant per day

src/app/api/
  webhooks/hitpay/       payment confirmation (HMAC verified)
  auth/joget-identify/   Joget SSO embedded login
  auth/oidc/             SSO start + callback
  cron/                  scheduled background jobs
  exports/[type]/        CSV downloads (entity names and bank info from DB)
```

## Design decisions worth knowing

- **Prices are snapshotted.** A `MenuItem` copies the dish price when added to
  a week. Editing the catalogue later never changes a published menu or order.
- **Deactivate, don't delete.** Anything with order history is deactivated
  instead of deleted so reports stay correct.
- **One order per employee per week.** Starts as a `CART`; the unique index on
  `(userId, cycleId)` arbitrates concurrent tabs.
- **Capacity is held by committed orders only** (`AWAITING_PAYMENT` + `PAID`).
  A cart does not reserve a portion; capacity is re-checked at checkout.
- **Order line items are denormalised** (dish name, restaurant name, service
  date) so historical reports survive catalogue changes.
- **Entity routing.** At checkout the order is tagged with the entity code from
  the user's company. Payment is processed through that entity's HitPay account.
  Refunds use the same entity credentials.
- **The last active administrator cannot be demoted or deactivated.**
- **One meal per person per service day.** Enforced in `selectMeal()` and
  re-checked in `validateForCheckout()`.
- **Employees never see the company's contribution.** Staff see the price they
  pay; Finance sees the full split.
- **The payment gateway is not named in employee-facing screens.**
- **Submitted orders reuse the ordering screen, read-only.**
- **Create forms live in dialogs**, not permanent side panels.

## Not built

Deliberately out of scope — flag if you want any of them:

- Email or push notifications (publish announcements, cutoff reminders,
  collection reminders).
- Per-restaurant vendor logins.
- Dietary preference matching and allergen warnings beyond free-text tags.
- Multi-entity analytics comparison (cross-entity charts on a single view).
