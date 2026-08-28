# Subsidized Meal Ordering — Changelog

## Baseline — existing features
The uploaded project already included:
- Weekly menu cycles with a Draft → Publish → Order → Cutoff → Closed lifecycle
- One-meal-per-day ordering, checkout, and payment via HitPay
- A subsidy rule engine (percentage / fixed-per-item / fixed-per-day-cap, scoped to all staff or one department, with priority)
- Role-based access: Admin, Finance, Analytics, Employee
- Restaurant and dish catalogue management
- LDAP and OIDC (SSO) login, alongside local email/password
- Finance and Analytics dashboards, CSV exports
- Kitchen production-count sheet
- An audit log

---

## 1 — Core bug fixes and small features 6 Aug 2026
1. **Fixed: paying for part of the week locked the whole week.**
   Removed the one-order-per-person-per-cycle database constraint; a person can now have multiple orders (and multiple deliveries) for the same week, so paying for some days no longer blocks ordering the rest.
   *Files: `schema.prisma`, `orders.ts`, `menu/actions.ts`, `menu/page.tsx`, `menu-ordering.tsx`*

2. **Feature: dishes grouped by restaurant.**
   Both the employee ordering screen and the admin planner's dish list/dropdown now group dishes under a restaurant heading instead of one flat list.
   *Files: `menu-ordering.tsx`, `admin/cycles/[id]/planner.tsx`*

3. **Fixed: a cancelled week could never be re-planned.**
   Removed the unique constraint that let a cancelled `MenuCycle` permanently occupy its calendar week; only a still-live cycle blocks re-creating that week now.
   *Files: `schema.prisma`, `admin/cycles/actions.ts`, `admin/cycles/[id]/page.tsx`, `admin/cycles/page.tsx`, `prisma/seed.ts`*

---

## 2 — Delivery sites 7 Aug 2026
1. **New feature: delivery site selection, chosen per order at checkout.**
   New `DeliverySite` model; a required "Deliver to" dropdown in the checkout summary; `validateForCheckout` now rejects checkout without one.
   *Files: `schema.prisma`, `orders.ts`, `menu/actions.ts`, `menu/page.tsx`, `menu-ordering.tsx`*

2. **New: admin CRUD for delivery sites**, mirroring the existing Restaurants admin pattern.
   *New files: `admin/delivery-sites/{actions.ts, page.tsx, site-form.tsx}`; nav link added to `layout.tsx`*

3. **Kitchen counts and Finance/Analytics reporting** extended to break down by delivery site, not just dish.
   *Files: `kitchen/page.tsx`, `reporting.ts`, `api/exports/[type]/route.ts`*

4. **Seed data:** editable `DELIVERY_SITES` list added to `prisma/seed.ts`, with sample historical orders randomly assigned a site.

---

## 3 — User menu 10 Aug 2026
1. **New: dropdown user menu**, replacing the always-visible name/sign-out block in the header. Holds profile info, a "My orders" shortcut, a "Help & support" mailto link, and Sign out.
   *New file: `src/components/user-menu.tsx`; edited: `app/(app)/layout.tsx`*

---

## 4 — Full internationalisation (English / Bahasa Malaysia / 中文) 11 Aug 2026
1. **Infrastructure:** installed `next-intl`; cookie-based locale (no `/en/`, `/ms/` URL segments); language switcher added to the user-menu dropdown.
   *New: `src/i18n/{config.ts, request.ts, actions.ts}`, `messages/{en,ms,zh}.json`; edited: `next.config.mjs`, `src/app/layout.tsx`, `user-menu.tsx`*

2. **Translated, batch by batch, until the whole app was covered:**
   - Employee ordering flow: `/menu`, `/orders`, `/orders/[reference]`
   - App shell, login, forbidden/access-denied page
   - Admin catalogue: Restaurants, Dishes, Delivery Sites
   - Admin operations: Subsidies, Users
   - Admin: Weekly Menus (cycles list, detail, planner, schedule form) — the largest batch
   - Insights: Finance, Analytics (incl. chart legends), Kitchen
   - Shared components: `action-form.tsx`, `day-tabs.tsx`

   Final state: **464 translation keys**, verified identical across all three languages, with zero missing/extra keys in any locale file.

3. **Fixed: dates, weekdays, and week ranges weren't actually translating.**
   `formatDate`/`formatDateTime`/`formatWeekRange` in `cycle.ts` had `'en-GB'` hardcoded; ~40 call sites across ~10 files were updated to thread the current locale through.
   *Files: `cycle.ts`, `reporting.ts`, and 10 page files*

4. **Fixed: the cycle-phase badge (Draft/Published/Open/Closed/…) stayed in English.**
   Replaced the static `CYCLE_PHASE_LABEL` export with a per-file translated map.
   *Files: `admin/cycles/page.tsx`, `admin/cycles/[id]/page.tsx`, `kitchen/page.tsx`*

---

## 5 — HitPay payment gateway, production debugging 21 Aug 2026
1. **Fixed: `APP_URL` hardcoded to `localhost`**, which HitPay's sandbox rejected (`"localhost not work for this field"`). Changed to prefer an explicit `APP_URL` override, then fall back to Vercel's auto-injected `VERCEL_URL` (updates itself every deploy, no manual env-var edits needed), then `localhost` for local dev.

2. **Fixed: Vercel Deployment Protection silently blocking HitPay's webhook.** Added Vercel's official "Protection Bypass for Automation" secret to the webhook URL, so the webhook passes through even with Deployment Protection re-enabled — no need to leave the whole app unprotected.

3. **Improved diagnostics for a 2xx-with-HTML response** (`SyntaxError: Unexpected token '<'`): added an `Accept: application/json` header, and a content-type check that logs the real response body server-side instead of crashing straight into an unreadable `JSON.parse` error.
   *All 3 changes: `src/lib/hitpay.ts`*

---

## 6 — Pagination 24 Aug 2026
1. **New reusable pagination component** — Previous/Next, "Showing X–Y of Z", preserves other filters in the URL.
   *New file: `src/components/pagination.tsx`*
2. **Applied to `/admin/users`**: replaced the flat `take: 300` cap with real `count` + `skip`/`take` pagination, 25 rows per page.
   *File: `admin/users/page.tsx`*
3. **Added a shared `<Pagination>`** - component (`src/components/pagination.tsx`) and applied it to every admin table that could grow without bound, replacing flat row caps with real `skip`/`take` paging:
   *Users, Restaurants, Dishes, Subsidy rules, Delivery sites, Cycles*

---

## 7 - Export Order History, payment method not stored in db 24 Aug 2026
1. **Added a month picker + "Download CSV"**
   *File: `src/app/api/exports/[type]/route.ts`*
2. **added `fetchPaymentType()`, which calls HitPay's `GET /v1/payment-requests/{id}`**
   *File: ` src/lib/hitpay.ts`*

---

## 8 - Settings page for admin 25 Aug 2026
1. **Added pages for admin to edit site name, logo, favicon, support email and maintenance banner with the default logo of Mr DIY logo**
   *File: `prisma/schema.prisma`, `public/uploads/branding/`(for image upload), `src/app/layout.tsx`, `src/app/login/page.tsx`, `src/app/(app)/admin/settings`,`src/app/(app)/layout.tsx`, `src/lib/settings.ts`*

---

## 7 - Mobile Sliding UI 27 Aug 2026
1. **Updated chevron and scrollbar in mobile ui to notify user it is scrollable**
   *File: `src/components/scroll-fade-row.tsx`*