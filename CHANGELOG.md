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
   *New files: `src/components/pagination.tsx`*
2. **Applied to `/admin/users`**: replaced the flat `take: 300` cap with real `count` + `skip`/`take` pagination, 25 rows per page.
   *Files: `admin/users/page.tsx`*
3. **Added a shared `<Pagination>`** - component (`src/components/pagination.tsx`) and applied it to every admin table that could grow without bound, replacing flat row caps with real `skip`/`take` paging:
   *Users, Restaurants, Dishes, Subsidy rules, Delivery sites, Cycles*

---

## 7 - Export Order History, payment method not stored in db 24 Aug 2026
1. **Added a month picker + "Download CSV"**
   *Files: `src/app/api/exports/[type]/route.ts`*
2. **added `fetchPaymentType()`, which calls HitPay's `GET /v1/payment-requests/{id}`**
   *Files: ` src/lib/hitpay.ts`*

---

## 8 - Settings page for admin 25 Aug 2026
1. **Added pages for admin to edit site name, logo, favicon, support email and maintenance banner with the default logo of Mr DIY logo**
   *Files: `prisma/schema.prisma`, `public/uploads/branding/`(for image upload), `src/app/layout.tsx`, `src/app/login/page.tsx`, `src/app/(app)/admin/settings`,`src/app/(app)/layout.tsx`, `src/lib/settings.ts`*

---

## 9 - Mobile Sliding UI 27 Aug 2026
1. **Updated chevron and scrollbar in mobile ui to notify user it is scrollable**
   *Files: `src/components/scroll-fade-row.tsx`*

---

## 10 - Integration with Joget 9 Sept 2026
1. **Updated Integration with Joget throught IFrame**
2. **Intergrated login function with Joget Sign In**
   *Files: `src/lib/session.ts` — createSession() now accepts a crossSiteEmbed option controlling the cookie's SameSite/Secure attributes, needed specifically for the iframe case.*

---

## 11 - Reduce Latency during usage of the system 10 - 11 Sept 2026
1. **Added Read Caching Layer to reduce the latency of waiting the query from database**
   *Files: `src/lib/cache.ts`, `lib/settings.ts` - cached read: getActiveDeliverySites, getActiveSubsidyRules, getRestaurantsForDropdown, getSiteSettingsCached, getDeliverySitesPage, getRestaurantsPage, getSubsidyRulesPage, getDepartments, getAnalyticsDashboard*
2. **repriceOrder reads subsidy rules from cache**
   *Files: `src/lib/orders.ts` - Reads from getActiveSubsidyRules instead from repriceOrder*
3. **Menu page reads run in parallel instead of sequentially**
   *Files: `src/app/(app)/menu/page.tsx` - Same queries, same data is restructured into 3 different batch using Promise all where each of them runs independently*
   1. Batch 1 (nothing here depends on anything else): auth check, the open-cycle lookup, cached delivery sites, cached subsidy rules, translations, locale, and the ?day= query param.
   2. Batch 2 (both only need cycle.id): the user's orders for this cycle, and the day-tabs list.
   3. Batch 3: the active day's dishes, then capacity-remaining (this one genuinely has to wait on Batch 3's own result).

---

## 12 - Fix Embed hide both top bar in website views and embedded view - 14 Sept 2026
1. **Uncomment condition checking for embedded view and website view**
   *Files: `src\app\(app)\layout.tsx`, `src\app\login\actions.ts` - uncomment condition checking & reads value to determine whether it is embedded*
2. **Fix website view and embedded view will force logged in into the same account in same browser and add new error page for account deactivated and joget user do not have email**
   *Files: `src\app\login\actions.ts`, `src\app\api\auth\joget-identify\route.ts`, `src\lib\session.ts` - added params, page and redirect page for new error page and checking embedding*

---

## 13 - Fix embedded view cannot proceed with payment in payment gatewat - 14 Sept 2026
1. **Added Popup page for user to proceed payment in embedded view**
   *Files: `src\app\(app)\orders\[reference]\payment-status.tsx`, `src\app\api\orders\[reference]\status\route.ts`, `src\app\(app)\menu\actions.ts`, `src\app\(app)\menu\menu-ordering.tsx`, `src\app\(app)\orders\[reference]\page.tsx` - Popup window with new added page and redirect url to proceed payment and checking once payment done*

---

## 14 - UI update to differentiate pending payment and paid with update tags for meals in cart - 14 Sept 2026
1. **Added pending, in cart, cancelled, refunded tags in cart and differentiate pending payment and paid**
   *Files: `src\app\(app)\menu\page.tsx`, `src\app\(app)\menu\menu-ordering.tsx`*

---

## 15 - Fix: language switcher not showing in embedded view 14 Sept 2026
1. **Add language switcher on top of the side bar as top menu is hidden**
   *Files: `src\app\(app)\layout.tsx`, `src\components\language-switcher.tsx`, `src\i18n\actions.ts` - determine the cookie whether it is embedded or web view and display it based on the session*

---

## 16 - Fix: Last Sign In from did not record and display in admin's user & roles tab - 15 Sept 2026
1. **Add checking and write to database from whether the logged in user is embedded or from webview**
   *Files: `src\lib\auth.ts`*

---

## 17 - added code id and export function for Admin's restaurant and dishes tab - 15 Sept 2026
1. **Added Code and export function for Restaurant tab**
   *Files: `prisma\schema.prisma`, `src\app\(app)\admin\restaurants\actions.ts`, `src\app\(app)\admin\restaurants\forms.tsx`, `src\app\(app)\admin\restaurants\page.tsx`, `src\app\api\exports\[type]\route.ts`, `src\lib\codes.ts`*
2. **Added Code and export function for Restaurant tab**
   *Files: `prisma\schema.prisma`, `src\app\(app)\admin\dishes\dish-form.tsx`, `src\app\(app)\admin\dishes\page.tsx`*

---

## 18 - Fix: role did not update from joget role - 16 Sept 2026
1. **Checked and added write to database based on the roles given from joget(embedded)**
   *Files: `src\lib\auth.ts`*

---

## 19 - Add: CSV upload for menu adding - 18 Sept 2026
1. **Added upload csv function in Weekly Menus**
   *Files: `src\app\(app)\admin\cycles\[id]\import-dialog.tsx`, `src\app\(app)\admin\cycles\[id]\page.tsx`, `src\app\(app)\admin\cycles\actions.ts`, `src\app\(app)\admin\cycles\actions.ts`, `src\lib\menu-import.ts`*

---

## 20 - Set Deadlock on Subsidy and Enable login using email and staff id - 21 Sept 2026
1. **Set Deadlock on Subsidy for current serving cycle**
   *Files: `src\app\(app)\admin\cycles\actions.ts`, `src\app\(app)\menu\page.tsx`, `src\lib\orders.ts`, `src\lib\subsidy.ts`, `tests\logic.ts`*
2. **Enabled login using email and staff id**
   *Files: `src\app\(app)\admin\users\actions.ts`, `src\app\(app)\admin\users\user-forms.tsx`, `src\app\(app)\menu\actions.ts`, `src\app\(app)\menu\menu-ordering.tsx`, `src\app\(app)\menu\page.tsx`, `src\app\api\auth\joget-identify\route.ts`, `src\app\login\actions.ts`, `src\app\login\login-form.tsx`, `src\lib\auth.ts`, `src\lib\auth\providers.ts`, `src\lib\session.ts`*

---

## 21 - Added default delivery site - 22 Sept 2026
1. **Add default delivery site**
   *Files: `src\app\(app)\admin\delivery-sites\actions.ts`, `src\app\(app)\admin\users\actions.ts`, `src\app\(app)\admin\users\actions.ts`, `src\app\(app)\admin\users\user-forms.tsx`, `src\app\globals.css`, `src\lib\orders.ts`*

---

## 22 - Add new role and added user confirmation on receival of the meal -23 Sept 2026
1. **Add reception role for the deliver of meals to site**
   *Files: `src\app\(app)\admin\users\actions.ts`, `src\app\(app)\admin\users\page.tsx`, `src\app\(app)\admin\users\user-forms.tsx`, `src\app\(app)\layout.tsx`, `src\app\(app)\reception\actions.ts`, `src\app\(app)\reception\delivery-row.tsx`, `src\app\(app)\reception\page.tsx`, `src\components\action-form.tsx`, `src\components\action-form.tsx`, `src\lib\rbac.ts`*
2. **Added user receival confirmation of meals**
   *Files: `src\app\(app)\admin\settings\actions.ts`, `src\app\(app)\admin\settings\page.tsx`, `src\app\(app)\layout.tsx`, `src\app\(app)\menu\page.tsx`, `src\app\(app)\menu\today-receipt-panel.tsx`, `src\app\(app)\my-meals\page.tsx`, `src\lib\meal-receipt.ts`, `src\lib\settings.ts`*

---

## 23 - Add receive button for user, Finance Recon page and Kitchen shows order and the employee ordered - 24 Sept 2026
1. **Add receive button and cutoff time for receive confirmation**
   *Files: `src\app\(app)\admin\settings\actions.ts`, `src\app\(app)\admin\settings\page.tsx`, `src\app\(app)\layout.tsx`, `src\app\(app)\menu\page.tsx`, `src\app\(app)\menu\today-receipt-panel.tsx`, `src\app\(app)\my-meals\page.tsx`, `src\lib\meal-receipt.ts`, `src\lib\settings.ts`*
2. **Add finance reconciliation page and kitchen show order details with each employee info**
   *Files: `src\app\(app)\finance\page.tsx`, `src\app\(app)\kitchen\page.tsx`, `src\app\api\exports\[type]\route.ts`*

---

## 24 - Fix: Settings unable to change - 25 Sept 2026
1. **Fixed: Unable to save any changed settings**
   *Files: `src\app\(app)\admin\settings\page.tsx`*

---

## 25 - Add staff id in order history extraction, Add configurable meals limit per day, Finance reconciliation page shows table - 28 Sept 2026
1. **Add staff id in the extraction of order history**
   *Files: `src\app\api\exports\[type]\route.ts`*
2. **Add configurable meal limit per day**
   *Files: `src\app\(app)\admin\settings\actions.ts`, `src\app\(app)\admin\settings\page.tsx`, `src\app\(app)\menu\page.tsx`, `src\lib\orders.ts`, `src\lib\settings.ts`*
3. **Show reconciliation table instead of export function only**
   *Files: `src\app\(app)\finance\page.tsx`, `src\app\api\exports\[type]\route.ts`*

---

## 26 - Add Audit Log for finance and admin, Add admin upload vendor invoice, Modify finance view details, Add notification upon change of delivery site - 29 Sept 2026
1. **Add audit log for finance and admin to check the usage of the app**
   *Files: `src\app\(app)\admin\audit\page.tsx`, `src\app\api\exports\[type]\route.ts`, `src\app\(app)\layout.tsx`, `src\lib\rbac.ts`*
2. **Add admin upload invoice of vendor and needed finance to approve**
   *Files: `src\app\(app)\admin\invoices\actions.ts`, `src\app\(app)\admin\invoices\invoice-dialogs.tsx`, `src\app\(app)\admin\invoices\page.tsx`, `src\app\(app)\finance\page.tsx`, `src\app\(app)\layout.tsx`*
3. **Modify Finance Reconciliation Page to be able to view the table**
   *Files: `src\app\(app)\finance\order-detail-dialog.tsx`, `src\app\(app)\finance\order-detail-dialog.tsx`*
4. **Add Notification when changing delivery site during order**
   *Files: `src\app\(app)\menu\menu-ordering.tsx`, `src\app\(app)\menu\page.tsx`*

---
