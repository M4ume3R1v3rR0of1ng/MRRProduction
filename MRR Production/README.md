# Steadwerk

Warehouse and fleet software for roofing and construction companies. Multi-tenant SaaS, built originally for Maumee River Roofing and generalized into a platform any company can sign up for.

This document is a deep technical map of the whole system: the frontend, the backend, the database, the billing model, the mobile build, and the tooling around all of it. It is meant to get a new developer (or a future version of you) from zero to a working mental model without having to read every file first.

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Tech stack](#2-tech-stack)
3. [High-level architecture](#3-high-level-architecture)
4. [Repository layout](#4-repository-layout)
5. [Multi-tenancy and security model](#5-multi-tenancy-and-security-model)
6. [Permissions system](#6-permissions-system)
7. [Feature modules](#7-feature-modules)
8. [Routing](#8-routing)
9. [Backend: Netlify Functions](#9-backend-netlify-functions)
10. [Database: Supabase and migrations](#10-database-supabase-and-migrations)
11. [Billing model](#11-billing-model)
12. [Integrations](#12-integrations)
13. [The iOS app](#13-the-ios-app)
14. [PWA and offline behavior](#14-pwa-and-offline-behavior)
15. [Security headers and CSP](#15-security-headers-and-csp)
16. [Environment variables](#16-environment-variables)
17. [Local development](#17-local-development)
18. [Testing](#18-testing)
19. [Verification scripts](#19-verification-scripts)
20. [Code quality tooling](#20-code-quality-tooling)
21. [CI/CD](#21-cicd)
22. [Error monitoring](#22-error-monitoring)
23. [Known gaps and roadmap](#23-known-gaps-and-roadmap)
24. [Conventions for contributors](#24-conventions-for-contributors)

---

## 1. What this is

Steadwerk gives a roofing or construction company one place to run:

- **Inventory**: what stock is on hand, across warehouses, with batch receiving and monthly physical counts.
- **Fleet**: trucks, trailers, service history, inspections, mileage.
- **Jobs**: build a job, plan its materials, approve it, pull the materials from the warehouse, complete the job, and close it out once the customer has paid.
- **Maintenance**: crews file requests against vehicles, managers schedule and close them.
- **Scheduling**: a calendar view across jobs, crews, and trailers.
- **Reporting**: job costing and profitability.
- **Users and permissions**: role-based access with per-user overrides, enforced both in the UI and in the database.

It is sold as a subscription ($99/mo including 10 users, or $990/yr) and runs as a Progressive Web App in the browser, plus a native iOS wrapper for crews who install it as an app. One platform operator's own tenant runs an "Owner Console" for cross-company administration (billing oversight, revenue, support access into a customer's account).

## 2. Tech stack

| Layer              | Technology                                                        | Notes                                                                                                             |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Frontend framework | React 18 + Vite 7                                                 | No Redux or similar; one central data hook feeds the whole tree.                                                  |
| Routing            | react-router-dom 7                                                | Real per-view URLs, added mid-project (see [Routing](#8-routing)).                                                |
| Styling            | Inline style objects + a small CSS token file (`src/tokens.css`)  | No CSS framework. Per-company branding (accent color) is applied as CSS custom properties at runtime.             |
| Backend            | Netlify Functions (Node, serverless)                              | 23 functions, every one wrapped for Sentry reporting.                                                             |
| Database           | Supabase (hosted Postgres)                                        | Row Level Security, 47 hand-applied SQL migrations.                                                               |
| Auth               | Supabase Auth                                                     | Email and password only, no SSO/federated login by design (see [Section 5](#5-multi-tenancy-and-security-model)). |
| Billing            | Stripe                                                            | Checkout, customer portal, and webhooks, all server-side.                                                         |
| Email              | Resend                                                            | Transactional email, sender-fenced to a company's own members.                                                    |
| AI assistant       | Anthropic API                                                     | Backs an in-app chat widget.                                                                                      |
| PDF generation     | jsPDF + jspdf-autotable                                           | Lazy-loaded, kept out of the PWA precache on purpose (see [Section 14](#14-pwa-and-offline-behavior)).            |
| Mobile shell       | Capacitor 8                                                       | Wraps the web build for iOS App Store distribution.                                                               |
| Error monitoring   | Sentry (`@sentry/react` client-side, `@sentry/node` in functions) | Off by default; only activates if a DSN is configured.                                                            |
| Testing            | Vitest                                                            | Node environment, focused on pure logic (money and permissions), not component rendering.                         |
| Type checking      | TypeScript, scoped                                                | `checkJs` turned on for a hand-picked list of money/permission files only, not the whole project.                 |
| Linting/formatting | ESLint 9 (flat config) + Prettier                                 | Gated in CI.                                                                                                      |
| CI                 | GitHub Actions                                                    | Lint, format check, test, and build on every PR and push to main.                                                 |

## 3. High-level architecture

There are two very different paths data takes through this app, and the difference matters for security:

```
Browser (React app)
   |
   |--- ordinary reads/writes ---> Supabase directly, using the ANON key
   |                               Protected by Row Level Security policies
   |                               (supabase/*.sql)
   |
   |--- privileged operations ---> Netlify Functions, using the SERVICE ROLE key
                                   (billing, user creation/deletion, email relay,
                                   AccuLynx sync, AI chat, weather)
                                   RLS is BYPASSED here. Tenant isolation is
                                   enforced in application code instead
                                   (netlify/functions/_shared/tenant.js)
```

The frontend loads almost everything through one hook, `useAppData()` ([src/core/useAppData.js](src/core/useAppData.js)). On boot it resolves the signed-in session, works out which company the session is currently acting in (a user can belong to more than one), and fires off a batch of parallel Supabase queries scoped to that company: inventory, vehicles, jobs, maintenance requests, trailers, warehouses, users, role permissions, per-user overrides, branding, integration config, and training media. Nothing is seeded with placeholder data; an empty table renders as empty on purpose, because with more than one tenant a "helpful" fallback to seed data would have meant a brand-new company's first login showing them another company's trucks and staff.

Any write that needs to bypass RLS, touch a secret (Stripe keys, AccuLynx API tokens), or act across the company boundary (platform administration) goes through a Netlify Function instead.

## 4. Repository layout

```
src/
  App.jsx                 Root component: routing, auth-state branching, app chrome
  main.jsx                Entry point: router, Sentry init, service worker registration
  tokens.css              Design tokens (spacing, color, type scale) as CSS variables

  core/
    useAppData.js          The central data-loading hook described above
    platform.js            IS_IOS_APP flag and the reasoning behind the iOS build split

  features/                One folder per product area, each self-contained
    auth/                  Login, signup, password reset, MFA, profile
    billing/                Stripe checkout, seat packs, customer portal
    dashboard/              Landing screen after login
    fleet/                  Vehicles, trailers, inspections, maintenance swaps
    inventory/              Items, batches, bulk receiving, physical counts
    jobs/                   Build -> approve -> pull -> complete -> close pipeline
    maintenance/            Maintenance request submission and management
    reports/                Job costing and profitability
    schedule/               Calendar views
    settings/               Company branding, warehouses, automations, integrations
    training/               Product tour and admin-uploaded training media
    users/                  User management and the audit log

  platform/
    OwnerConsole.jsx        Cross-company admin console for the platform operator

  public/                   Logged-out pages: landing, terms, privacy, training

  shared/
    components/             Cross-feature UI: search, sidebar, chat widget, error boundary
    context/                NotificationContext (toasts)
    data/                   Bundled seed data and training video metadata
    database/               permissions.js: the whole role/permission model
    hooks/                  Small reusable hooks
    layouts/                Sidebar
    utils/                  Supabase client, helpers, translations, Sentry init, etc.

  test/                     Vitest setup (stubs env vars so pure-logic tests can import
                             modules that would otherwise throw on missing config)

netlify/functions/          Serverless backend, one file per endpoint
  _shared/                  tenant.js (isolation), password.js, sentry.js, expenseNotes.js

supabase/                   47 hand-applied SQL migrations, run in order through the
                             Supabase SQL editor (no migration runner, no CLI link)

scripts/                    Node scripts run by hand: iOS asset generation, a magic-link
                             minting tool for support, an SPM path fixup for Windows,
                             and three tenant-isolation/permission/atomicity verifiers

ios/                        Generated Capacitor iOS project (checked in)
```

The git repository root is actually one level ABOVE this folder — everything above lives under `MRR Production/`, space included (see any path in `.github/workflows/ios-build.yml`). `.github/workflows/` itself therefore lives at the true repo root, not inside this folder; see [Section 21](#21-cicd).

## 5. Multi-tenancy and security model

Every business table sits behind a `company_id`. Two tables anchor the whole model:

- **`companies`**: one row per tenant, holding branding, subscription status, and a flag marking the platform operator's own company.
- **`memberships`**: which users belong to which companies, and with what role. Role is per-company, not a global property of the user, since one person can work at more than one company.

Row Level Security policies enforce this boundary for anything the browser reads or writes with the anon key. That is the first half of the story. The second half is that **every Netlify Function uses the Supabase service-role key, which bypasses RLS completely**. Nothing in the SQL migrations protects a single line of code in `netlify/functions/`. That protection lives entirely in [`netlify/functions/_shared/tenant.js`](netlify/functions/_shared/tenant.js), specifically its `resolveCaller()` function, which:

1. Verifies the caller's access token against Supabase Auth.
2. Looks up their profile and active company.
3. Confirms their membership is active (or that they are the platform admin "visiting" a tenant they do not belong to, for support).
4. Checks the company's subscription is in a usable state (`trialing`, `active`, or `past_due`; `past_due` is included deliberately, since Stripe retries a failed card for about two weeks and locking a crew out of live job data the instant a card expires is the wrong call).
5. Loads that company's secrets (AccuLynx key, Stripe identifiers) from a table with no grant to any browser role, so they can never be echoed back to the client.

If a new function is ever added that queries a tenant table, it must scope that query by `caller.companyId` explicitly. RLS will not save it.

There is deliberately no Google/SSO login option. Crews sign in under an address their own company controls; an identity provider that company doesn't administer is the wrong shape for a B2B tool like this. Email and password, plus optional MFA, is the whole login story.

## 6. Permissions system

Access control is fine-grained, role-based, with per-user overrides layered on top. It lives in [`src/shared/database/permissions.js`](src/shared/database/permissions.js).

**Roles**: admin, warehouse manager, coordinator, manager, site supervisor (field), employee, bookkeeper.

**Permission groups** (about 28 individual boolean permissions in total):

| Group       | Example permissions                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Inventory   | view, edit items, receive batches, bulk receive, view pricing, edit pricing, adjust stock, monthly count    |
| Fleet       | view, manage, log service, log inspection, delete photos, log mileage                                       |
| Maintenance | submit requests, manage requests                                                                            |
| Jobs        | view, build, approve and assign, pull inventory, edit during pull, complete, view/set contract value, close |
| Reports     | view reports                                                                                                |
| Admin       | manage users, manage settings                                                                               |

Rules:

- **Admin always bypasses every check.** Every permission resolves to true for that role, no exceptions.
- **Role defaults + per-user overrides**: `getEffectivePerms(user, rolePerms, userOverrides)` starts from the role's baseline and layers any individual override on top. An admin can lock down or open up one specific person without touching the role.
- **Enforced twice**: once in the UI (routes redirect away, buttons don't render) and once in the database (SQL functions and triggers check the same permissions server-side). This was not always true; migration 12 closed a real gap where job permissions were UI-only, meaning anyone could close a job with a direct API call regardless of what the interface showed them.
- **Live refresh**: an admin toggling a permission reaches already-signed-in sessions immediately through a Supabase Realtime subscription, rather than requiring a re-login.

## 7. Feature modules

### Jobs (the core workflow)

A job moves through a fixed pipeline: **draft -> approved -> active -> completed -> closed**.

1. **Build** ([BuildJobsView](src/features/jobs/BuildJobsView.jsx)): create the job, plan what materials it needs.
2. **Approve**: a coordinator or manager signs off and assigns a supervisor.
3. **Pull** ([PullInventoryView](src/features/jobs/PullInventoryView.jsx)): materials are pulled from warehouse stock, FIFO, atomically (see migration 14: pulling used to write the job and each inventory line as separate statements, so a failure partway through could leave a job marked active with only some stock deducted and no way to recover, since the Pull button only shows for approved jobs).
4. **Complete**: leftover material is returned to stock and the job is marked done.
5. **Close**: once the office confirms pricing and payment in AccuLynx, the job is archived. A completed job that has not yet been closed shows up as a persistent reminder in the app chrome.

Additional flows: correcting a wrong returned quantity after a job is already completed (migration 35), pulling stock for a material line added to a job after its initial pull without re-running the whole pull (migration 36), one AccuLynx job carrying more than one internal job for multi-crew work (migration 17), and PDF job report generation/upload back to AccuLynx.

### Inventory

Items and stock levels across warehouses, batch receiving (both single-item and bulk multi-item orders), pricing (purchase price is separated from what a job's contract was worth, since a warehouse manager may need to see stock cost without seeing what a job sold for), manual stock adjustment, and monthly physical counts that compute book-versus-shelf variance (migration 20).

### Fleet

Vehicles and trailers, service logging, formal inspection reports, mileage logging, and a maintenance-swap flow: take a vehicle out of service and lend its driver a spare truck without losing track of either (migration 19). A vehicle can also simply be marked out of service (migration 25).

### Maintenance

Crews submit requests against a vehicle; managers schedule and close them. "Complete Service" is one atomic action (migration 34): it logs the service to the vehicle's history, closes the request, and optionally reassigns the driver, all in one step rather than three that could get out of sync.

A nightly job (`send-maintenance-push-notices.js`, migrations 38-40) forecasts each vehicle's next oil change from its own mileage log, warns the assigned driver 7 days out, then escalates to a daily urgent notice once it's actually due and no matching request has been filed. One decision ("heads-up" vs. "urgent") fans out to four channels at once: an iOS push via APNs, a realtime in-app toast, an email, and a persisted message in the driver's chat with the Steadwerk Assistant — so the notice is never just a toast that vanishes if nobody was looking. The APNs channel is code-complete but not yet live; see [Section 12](#12-integrations).

### Scheduling

A calendar view spanning jobs, crew assignments, and trailer bookings.

### Dashboard

The landing screen after login: job pipeline summary, a weather card, and a team chat box backed by durable message history (migration 41) rather than an ephemeral, reload-and-it's-gone thread.

### Reports

Job costing and profitability, built from material cost and (where the viewer has the `jobs_revenue` permission) contract value.

### Users and audit log

User management (create, edit, deactivate) and a searchable audit log of significant actions (login/logout, inventory mutations, job lifecycle transitions, fleet status changes, permission changes).

### Settings

Company branding (name, logo, accent color used to theme the whole app for that tenant), warehouses, notification automation rules (opt-in per event type, off by default), role permissions, AccuLynx integration configuration, and sales tax rules.

### Training

A bundled product tour that ships in the build, plus one uploaded video library split into two tiers (migration 45, superseding an earlier platform-only version in 42/44): a global tier managed only by Steadwerk's platform admins and visible to every company, and each company's own private tier, managed by that company's own Admin. A sidebar badge (migration 46) tracks unread clips per member — anyone's upload counts as unread for everyone else until they open Training, mirroring the same `_reads` pattern team chat already used. Training has no permission gate; the whole point is to explain the parts of the app someone already has access to, so hiding it from anyone would be self-defeating.

### Billing

Stripe checkout, seat pack purchases, and a link into the Stripe customer portal. See [Section 11](#11-billing-model). Not present at all in the iOS build; see [Section 13](#13-the-ios-app).

The tab also collects a **billing contact name** (migration 47) — the actual person who signed up, distinct from the company name Stripe otherwise only ever knows — plus a handful of proactive nudges: a card-expiring warning, a seat-limit heads-up before an admin actually hits capacity, a self-serve "switch to annual" option, and a sitewide past-due banner outside the tab itself so a failed payment isn't only visible to someone who happens to go looking.

### Owner Console

The platform operator's own view, reachable only to accounts flagged `is_platform_admin`. Cross-company oversight: which companies are on the platform, their subscription/revenue state, storage usage, and a "visit" mode that lets the operator step into a customer's tenant to help with support, with a persistent on-screen banner so that is never an invisible state to be in.

## 8. Routing

The app uses `react-router-dom` for real, per-view URLs (`/dashboard`, `/buildjobs`, `/inventory`, `/fleet`, `/requests`, `/reports`, `/users`, `/settings`, `/logs`, `/owner`, `/billing`, `/training`, `/profile`, plus the logged-out `/`, `/login`, `/terms`, `/privacy`). Two things are worth knowing:

- **Permission gates happen at the route level.** A route without the required permission renders `<Navigate to="/dashboard" replace />` instead of the view. There is no separate route guard component; the check is written inline per route in [`App.jsx`](src/App.jsx).
- **Deep links into a specific record are query parameters, not extra path segments.** Opening a job from the global search (OmniSearch) sets `?open=<id>` on the destination view's URL; the "just moved to this stage" highlight on a job card uses `?highlight=<id>&hlabel=<text>`. Both are read with `useSearchParams()`, so a link like `/buildjobs?open=4471` is bookmarkable, shareable, and survives a page refresh, rather than living in memory and evaporating the moment the tab reloads.

## 9. Backend: Netlify Functions

All 23 functions live in `netlify/functions/` and are wrapped with `withSentry(name, handler)` for error reporting. Every one that touches a tenant table goes through `resolveCaller()` first (see [Section 5](#5-multi-tenancy-and-security-model)).

| Function                           | Purpose                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-checkout.js`               | Starts a new company's Stripe subscription (self-serve signup).                                                                                                               |
| `start-company-billing.js`         | Opens the checkout tab for an existing company starting to pay.                                                                                                               |
| `add-seats.js`                     | Purchases additional seat capacity.                                                                                                                                           |
| `switch-billing-interval.js`       | Moves a monthly subscriber to the discounted annual plan, base + crew packs, charged immediately.                                                                             |
| `update-billing-contact.js`        | Sets the Billing tab's billing contact name, mirrored onto the Stripe customer's metadata.                                                                                    |
| `billing-status.js`                | Read-only: the Billing tab's card-on-file brand/last4/expiry, for the expiring-card warning.                                                                                  |
| `billing-portal.js`                | Opens the Stripe customer portal for an existing subscriber.                                                                                                                  |
| `stripe-webhook.js`                | Reconciles subscription state from Stripe events. The largest function in the directory.                                                                                      |
| `admin-billing.js`                 | Platform-operator billing oversight (Owner Console).                                                                                                                          |
| `create-user.js`                   | Creates a new user and membership, sends the invite email.                                                                                                                    |
| `update-user.js`                   | Edits an existing user's profile/role.                                                                                                                                        |
| `delete-user.js`                   | Deactivates/removes a user.                                                                                                                                                   |
| `delete-company.js`                | Removes a company (platform-operator only).                                                                                                                                   |
| `reset-password.js`                | Initiates the password recovery flow.                                                                                                                                         |
| `acculynx-sync.js`                 | Pushes/pulls job data to and from AccuLynx.                                                                                                                                   |
| `acculynx-import.js`               | A machine-to-machine import path, authenticated by a shared secret header rather than a user session.                                                                         |
| `weather.js`                       | Backs the dashboard weather card.                                                                                                                                             |
| `chat.js`                          | Backs the in-app AI assistant (Anthropic). The second-largest function.                                                                                                       |
| `send-email.js` / `send-alert.js`  | Transactional email relays, fenced so a user can only email people in their own company, never arbitrary external addresses.                                                  |
| `register-push-token.js`           | Registers/re-confirms a device's APNs push token for the signed-in user.                                                                                                      |
| `send-maintenance-push-notices.js` | Nightly oil-due forecast and escalation — push, realtime toast, email, and chat message, one decision fanned out to four channels. See [Feature modules](#7-feature-modules). |
| `daily-archive.js`                 | A scheduled/cron cleanup job.                                                                                                                                                 |

## 10. Database: Supabase and migrations

There is no migration runner and no Supabase CLI link in this project. All 47 SQL files in `supabase/` are applied by hand, in numeric order, through the Supabase SQL editor. Each file is meant to open with a header describing what it does and whether it's safe to re-run, and close with a `Verify` block that can be pasted straight into the editor. Numbering is not contiguous — 43 was rolled back and never reapplied, and the file itself says so where it would otherwise be expected.

Two files are explicitly destructive and require a backup first: `02_tenancy_tables.sql` (rewrites every business table to sit behind a company) and `15_jobs_schema_debt.sql` (drops columns).

To find out what has actually been applied to a given database, run `33_migration_ledger.sql`. It does not trust a changelog; it probes the live schema for the object each migration is supposed to create, and prints the result with anything missing sorted to the top.

Selected highlights beyond tenancy and permissions (already covered above): a self-serve `incomplete` subscription state (07), seat limits at $99/mo for 10 users plus $10/mo per extra 5 (09), storage usage tracking for the Owner Console (08), MFA enforcement for accounts that have set up a second factor (29), per-company and platform-wide revenue reporting (30), a mechanism letting the platform owner enter a tenant they don't belong to for support (31), the oil-due push-notification pipeline's storage and driver-visibility (38-40), durable chat message history (41), the training library's platform/company two-tier split and unread badge (42, 44-46), and a per-company billing contact name distinct from the Stripe customer's own name (47).

## 11. Billing model

- **Base plan**: $99/month, includes 10 users. $990/year as a prepay option (two months free).
- **Seat packs**: additional blocks of 5 users at $10/month each (or the annual equivalent). This has changed shape twice in the migration history: it started recurring, briefly became a one-time purchase (migration 16), then went back to recurring (migration 27).
- **Checkout and the customer portal are entirely server-side.** There is no Stripe.js on the client; `create-checkout` and `billing-portal` build and return URLs, and the browser just opens them.
- **The webhook is the source of truth.** `stripe-webhook.js` reconciles subscription status, seat count, and billing state from Stripe's own events rather than trusting anything the client reports.

## 12. Integrations

- **AccuLynx**: the roofing industry CRM/project system this app syncs job and document data with. Configuration is per-company (`Settings -> Integrations`), with the API key itself never readable by the browser once saved; only a "configured: yes/no" status is exposed.
- **Resend**: transactional email. All platform mail goes out from one verified sending domain, with the company's name as the display name, and is fenced so a user can only send to their own company's active members.
- **Anthropic**: powers the in-app chat assistant. Loads after the rest of the view the person actually asked for, since it's useful but never the reason someone opened the app.
- **Weather**: a simple lookup backing the dashboard's weather card.
- **Apple Push Notification service (APNs)**: `_shared/apns.js` signs its own ES256 provider JWT and posts over Node's built-in `http2` module rather than pulling in a push-sending library (the usual pick, `node-apn`, is effectively unmaintained). Backs the oil-due maintenance notice pipeline. **Not live**: none of its five required env vars (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`) are set locally as of this writing, and the code that calls it catches that once per run rather than per notice. See [Section 13](#13-the-ios-app) for the matching native-side gap.
- **Sentry**: see [Section 22](#22-error-monitoring).

## 13. The iOS app

`npm run build:ios` produces a genuinely different bundle from `npm run build`, driven by a single flag (`IS_IOS_APP`, set from `VITE_APP_PLATFORM=ios` in the committed `.env.ios` file). The reason is App Store compliance, not a technical limitation.

Apple's App Store Review Guideline 3.1.1 requires that anything a user can buy inside an iOS app go through In-App Purchase, at a 15 to 30 percent cut. Steadwerk bills $99/month through Stripe. The way a B2B tool like this survives review is to ship as a **sign-in-only client**: no pricing shown anywhere in the app, no signup flow, no checkout, no upgrade prompt. A company's owner subscribes on the web; their crew just signs in to an account that already exists.

Three things are cut from the iOS build, and the cut happens at build time, not just at the render site, so the code is actually removed from the compiled bundle rather than merely hidden behind a flag:

1. The marketing landing page (it publishes the $99/mo and $990/yr rates).
2. The "start a company" signup tab.
3. The Billing view (buys seat packs, opens the Stripe portal).

Two supporting scripts exist for the iOS build: `scripts/generate-ios-assets.mjs` (regenerates the app icon and launch images from the Steadwerk mark; run by hand when the brand changes, not on every build) and `scripts/normalize-spm-paths.mjs` (fixes a path-separator bug Capacitor's `cap sync` introduces into the iOS Swift Package Manager manifest when run on Windows).

**Push notifications** (`@capacitor/push-notifications`) were added to the native project: `AppDelegate.swift` forwards APNs' device-token and registration-error callbacks to the JS side (`src/shared/utils/pushRegistration.js`), and `App.entitlements` / `Info.plist` declare the capability. This is code-complete but not yet fully wired: the entitlements file's own header comment says adding the capability in Xcode (Signing & Capabilities) is "intentionally left as a manual step," and nobody on the team currently has a Mac to do it on — the CI build compiles unsigned on a macOS runner specifically so that gap doesn't block everyone else. A third delegate override that used to forward silent/background pushes was removed entirely (rather than stubbed) after it broke CI for a week straight compiling against a `Notification.Name` the installed Capacitor version never actually declared; nothing on the JS side depended on it.

## 14. PWA and offline behavior

The web app is an installable Progressive Web App (Vite PWA plugin, Workbox under the hood), set to update silently rather than prompting the user to reload. The app shell (JS, CSS, HTML, icons) is precached so the portal opens offline, but there is deliberately **no offline write queue and no runtime caching of Supabase responses**. Stale inventory, job, or cost data would be worse than an honest "you're offline" error, so the offline story stops at the shell loading; every actual read and write goes straight to the network. The `SyncIndicator` component in the app chrome reflects this.

jsPDF and its dependencies (roughly 800KB raw) are excluded from the precache by name, since they only ever load for a company that has AccuLynx report upload turned on, and precaching them would make every crew on a job-site connection download a PDF engine they may never open.

## 15. Security headers and CSP

Production HTTP security headers, including a strict Content Security Policy, live in `public/_headers` rather than `netlify.toml`. This is deliberate: Netlify Dev applies `netlify.toml` header rules to the local dev server too, and the strict `script-src 'self'` policy would block Vite's inline React-refresh preamble, crashing the local dev experience. A `_headers` file in the publish directory is honored on deployed sites but ignored by `netlify dev`, so production stays locked down while local development still works.

The CSP is `default-src 'self'` with narrow, explicit allowances for the Supabase project's REST/Realtime endpoints, Google Fonts, and Sentry's ingest hosts (present ahead of time so nothing is silently blocked the day a Sentry DSN is actually configured).

## 16. Environment variables

Copy `.env.example` to `.env` and fill it in for local development. Deployed builds read the same variables from Netlify's own environment settings; a value missing from a local `.env` does not necessarily mean production is missing it.

Anything prefixed `VITE_` is inlined into the client bundle at build time and is public by design. Everything else is server-only and reaches nothing but the Netlify functions. This distinction is a security boundary, not a style preference; putting a secret behind a `VITE_` prefix ships it to every browser that loads the app.

| Category  | Variables                                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase  | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                                   | The anon key is public and governed by RLS. The service-role key bypasses RLS entirely and must only ever live server-side.                                                                                                                                                                                                                                             |
| Stripe    | `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, four `STRIPE_*_PRICE_ID` values, `STRIPE_WEBHOOK_SECRET` | The four price IDs must match the amounts advertised on the landing page and login screen, or checkout will not honor what was promised.                                                                                                                                                                                                                                |
| Email     | `RESEND_API_KEY`, optional `PLATFORM_MAIL_DOMAIN`                                                            | Domain defaults to steadwerk.com if unset; this default matters, since a missing variable must never silently send a tenant's mail under the wrong brand.                                                                                                                                                                                                               |
| AccuLynx  | `ACCULYNX_API_KEY`, `ACCULYNX_IMPORT_SECRET`                                                                 | The import secret is the only authentication on the machine-to-machine import endpoint, which has no user session.                                                                                                                                                                                                                                                      |
| Anthropic | `ANTHROPIC_API_KEY`                                                                                          | Powers `chat.js`.                                                                                                                                                                                                                                                                                                                                                       |
| APNs      | `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`                               | All five required before `_shared/apns.js` will send anything; see [Section 12](#12-integrations). Not documented in `.env.example` until this pass — added there alongside this table.                                                                                                                                                                                 |
| App URL   | `PUBLIC_APP_URL`                                                                                             | Only needed for local dev; Netlify sets `URL` automatically on deployed sites.                                                                                                                                                                                                                                                                                          |
| Sentry    | `VITE_SENTRY_DSN` (client), `SENTRY_DSN` (functions), `SENTRY_AUTH_TOKEN` (build-time source map upload)     | All optional. Monitoring code is a complete no-op with no DSN set, and the build skips source map upload (and map generation entirely) with no auth token set. Confirmed present in the local `.env` as of September 2026; deployed builds need the same three set in Netlify's own site environment settings, since a local `.env` file has no bearing on what's live. |

## 17. Local development

```
npm install
npm run dev          # netlify dev, proxying Vite on 5173 through port 8888
```

`npm run dev:ui-only` runs plain Vite without the Netlify function proxy, useful when you don't need the serverless functions available locally.

The Netlify dev port is pinned deliberately (`netlify.toml` sets `targetPort`/`port` explicitly) because automatic port detection was landing on the wrong Vite instance and returning proxy errors. Vite's own dev server also pins `strictPort: true` and points its HMR websocket directly at itself rather than through the Netlify proxy, which mangles websocket frames.

For the iOS build:

```
npm run build:ios
npm run ios:open      # opens the generated Xcode project
```

## 18. Testing

```
npm test          # vitest run, once
npm run test:watch
```

Tests run in a Node environment, not jsdom. The suites deliberately cover pure, high-consequence logic rather than component rendering: seat pack math, job costing, sales tax, permission resolution, schedule logic, CSV export, and a handful of Netlify function helpers (notably the AccuLynx expense-notes boundary arithmetic). A dedicated `src/test/setup.js` stubs Supabase environment variables before any module is imported, so these suites run hermetically on a fresh clone (or a CI runner) rather than silently depending on a local `.env` file that happens to exist on a developer's machine.

There are currently no component-level browser tests — nothing automated proves, for example, that toggling a permission actually disables the corresponding button in the UI. One end-to-end test does exist, covering the flagship flow: see below.

### End-to-end (Playwright)

```
npm run test:e2e
```

`e2e/job-pipeline.spec.js` drives a real Chromium browser through login → build → approve → pull → complete → close — the one flow named in [Known gaps](#23-known-gaps-and-roadmap) — against a disposable throwaway company + two users + one stocked inventory item that `e2e/global-setup.js` creates in the same Supabase project via the service-role key (the same pattern `scripts/verify-tenant-isolation.mjs` uses), and `e2e/global-teardown.js` removes afterward. It needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the environment (or `.env` locally) — the same three `scripts/verify-*.mjs` need.

Locators lean on `getByLabel`/`getByRole` against real visible text rather than `data-testid`, since `UIPrimitives.jsx`'s `Fld` already ties every form field to a real `<label>`. `playwright.config.js` runs the actual production build through `vite preview` (not the dev server), Chromium only for now, and has its own CI workflow, `e2e.yml`, kept separate from `test.yml` because it needs a live Supabase round-trip and a browser install rather than `test.yml`'s network-free ~1 minute. Not covered yet: any other flow, the MFA path, and component-level rendering.

## 19. Verification scripts

Three scripts run against a **live** database from Node and are intentionally not part of `npm test`, since they create and tear down real data:

```
node scripts/verify-tenant-isolation.mjs
node scripts/verify-permission-enforcement.mjs
node scripts/verify-atomic-materials.mjs
```

- **`verify-tenant-isolation.mjs`** creates a throwaway second company and user, signs in as them through the same anon-key path a real browser would use, and asserts they can see nothing belonging to the primary company. It then flips the subscription kill switch and asserts the portal goes dark. The failure mode this guards against is silent: a missing RLS policy does not throw an error, it just quietly hands one company's data to another.
- **`verify-permission-enforcement.mjs`** creates a throwaway company whose permissions mirror production, signs in as each role for real, and asserts every gated action is allowed or denied correctly by the database itself, not just by what the UI happens to show.
- **`verify-atomic-materials.mjs`** proves that pulling materials for a job is genuinely all-or-nothing by forcing a failure partway through a multi-item pull and confirming every earlier write in the same call was rolled back. It also pins down that the underlying function runs as `SECURITY INVOKER` rather than `SECURITY DEFINER`, so it cannot be used to silently bypass permission checks.

There is also `scripts/magic-link.mjs`, a support tool that mints a one-time sign-in link for an existing user and prints it to the terminal (it does not email anyone or modify the account), and `scripts/generate-ios-assets.mjs`, covered in [Section 13](#13-the-ios-app).

## 20. Code quality tooling

- **ESLint** (flat config, `eslint.config.js`): scoped separately for browser app code, Node-run functions/scripts, and test files, since each needs different globals. React Hooks rules are hand-picked rather than using the full recommended set, since that bundle assumes a React Compiler this project does not use.
- **Prettier**: formatting, with ESLint's own stylistic rules turned off via `eslint-config-prettier` so the two tools never disagree.
- **Scoped TypeScript checking**: `tsconfig.money-permissions.json` turns on `checkJs` and `strict` mode for a deliberately small, hand-maintained list of files: the permission matrix, seat pack arithmetic, sales tax, job costing, the tenant/auth boundary, and the Stripe-touching Netlify functions. This is not project-wide type checking (`jsconfig.json` remains path-aliases only); turning `checkJs` on for the whole codebase would surface a large number of pre-existing warnings in unrelated view code overnight, for no proportional benefit. The chosen files are exactly the ones where a wrong type either moves money or decides who can access what.
- **`scripts/check-money-coverage.mjs`**: a tripwire for the hand-maintained list above going stale. It scans the same money-relevant directories for any file that imports the `stripe` package and isn't in `tsconfig.money-permissions.json`'s `include` array, and fails with the file name if one is found — see [Known gaps #3](#23-known-gaps-and-roadmap) for the real gap it was written to catch.

Run them with:

```
npm run lint
npm run lint:fix
npm run format
npm run format:check
npm run typecheck:money
npm run check:money-coverage
```

## 21. CI/CD

**GitHub Actions** — three workflows, all at the true repo root (`.github/workflows/`, one level above this folder; see [Section 4](#4-repository-layout)):

- **`test.yml`** ("test") runs on every pull request and every push to main: install, the Vitest suite, the money-file coverage check, the scoped type check, then a full production build and the iOS bundle build, in that order, so the pipeline fails fast on cheap checks before spending time on slower ones. Netlify's own PR preview deploys build the site too, but never run the test suite; this is what actually gates on it.
- **`ios-build.yml`** ("iOS build") compiles the Capacitor/Xcode project, unsigned, for the Simulator, on a pinned `macos-15` runner — the only way anyone finds out the native project is actually broken, since nobody on the team owns a Mac. Path-filtered to only the things that can change the iOS build (`src/`, `ios/`, `package.json`, `.env.ios`, etc.), since macOS runner minutes bill at roughly ten times the Linux rate and a Netlify-function-only commit has no business paying that. Runs unit tests and the web build first for the same fail-fast reason as `test.yml`, then `xcodebuild ... CODE_SIGNING_ALLOWED=NO`. It needs no Apple Developer account and produces nothing installable — see [Section 13](#13-the-ios-app) for what a real TestFlight pipeline would still need on top of this.
- **`e2e.yml`** ("e2e") runs the Playwright job-pipeline test (see [Section 18](#18-testing)) on every pull request and push to main, kept as its own workflow rather than folded into `test.yml` because it needs a live Supabase round-trip and a Chromium download that `test.yml` deliberately has neither of. Needs a `SUPABASE_SERVICE_ROLE_KEY` repository secret in addition to the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` secrets `ios-build.yml` already uses — this workflow fails until that secret is added.

A third file, `MRR Production/.github/workflows/ci.yml`, also exists in this repository but is **dead**: GitHub Actions only ever reads workflows from the true repo root's `.github/workflows/`, never from a subdirectory's, so this nested copy has not run since this folder became a subdirectory of a larger repo. It predates the split and was never cleaned up — see [Known gaps](#23-known-gaps-and-roadmap).

**Netlify** hosts the deployed site and rebuilds on every push. One notable quirk documented in `netlify.toml`: the build is configured to never skip, even when Netlify's own "no content change" detection thinks it should. That detection was misfiring (most likely because the repository's base directory contains a space) and silently canceling real deploys, which is a worse failure mode than an occasional redundant build.

## 22. Error monitoring

Sentry is wired into both runtimes and is a complete no-op anywhere a DSN is not configured, so it costs nothing in environments where it isn't set up.

- **Client** (`src/shared/utils/sentry.js`): browser error/performance tracing plus session replay. Replay defaults to masking all text and blocking all media before anything is recorded, which matters here specifically because these screens show customer names, addresses, and job pricing; the recording captures layout and interaction, not the underlying data. This is documented as a disclosed sub-processor in the privacy policy, and that disclosure has to stay in sync if the masking defaults are ever changed.
- **Functions** (`netlify/functions/_shared/sentry.js`): a `withSentry(name, handler)` wrapper around every function. Because each function already catches its own errors and turns them into a JSON response, a plain try/catch wrapper would rarely see anything; the wrapper also inspects the handler's returned status code and reports anything 500 or above, using the message the function's own catch block already produced.
- **Source maps**: `vite.config.js` wires in `@sentry/vite-plugin`, gated on `SENTRY_AUTH_TOKEN` being present. When it's set, the production build uploads source maps to Sentry (as `sourcemap: "hidden"`, so they're generated and uploaded but never shipped to the browser) so stack traces in the Sentry UI show real, unminified code instead of a wall of minified garbage. With no token, no maps are generated at all, so there's nothing to accidentally leak.

**Confirmed status (checked directly, September 2026)**: `VITE_SENTRY_DSN`, `SENTRY_DSN`, and `SENTRY_AUTH_TOKEN` are all set in the local `.env`, so client tracing, function error reporting, and source map upload are all live for anyone running this repo locally. That says nothing about the deployed site: Netlify reads its own environment variables, not this repository's `.env` file, so whether Sentry is actually capturing errors in production depends on the same three variables being set in Netlify's site settings. Confirm there by checking Site settings -> Environment variables, or by triggering a real error on the live site and watching for it in the Sentry project dashboard.

## 23. Known gaps and roadmap

Honest, current list, roughly in priority order:

1. **One end-to-end test exists; component-level tests still don't.** `e2e/job-pipeline.spec.js` (Playwright, its own `e2e.yml` CI workflow, kept separate from `test.yml` — see [Testing](#18-testing)) drives a real Chromium browser through login → build → approve → pull → complete → close against a disposable throwaway tenant in the same Supabase project, using real writes end to end. That is the one flagship flow, not general coverage: no component-level rendering tests (React Testing Library / jsdom) exist yet, no other flow is covered, no MFA path, and CI only runs Chromium. The money and permission logic is still unit-tested and partially type-checked, same as before.
2. **Rate limiting exists and is now enforced by a test, not just convention.** `_shared/rateLimit.js` is an in-memory, best-effort, per-container throttle (not distributed — an attacker spread across enough containers isn't fully stopped by it alone), wired into `create-checkout.js`, `reset-password.js`, `chat.js`, `acculynx-import.js`, `register-push-token.js`, and `stripe-webhook.js` (public, signature-verified rather than session-verified, so it needed the same IP throttle as the other unauthenticated endpoints). `_shared/rateLimitEnforcement.test.js` scans every file in `netlify/functions/` and fails the build if one is added that neither calls `resolveCaller()` (session-gated) nor declares a `schedule` config (cron-only, unreachable from outside Netlify's own trigger) nor calls `checkRateLimit()` itself — so a new unauthenticated endpoint can no longer forget the throttle silently.
3. **Scoped type checking is frozen at a specific file list, and one real gap has already been caught.** `delete-company.js` started cancelling Stripe subscriptions and deleting Stripe customers without ever being added to `tsconfig.money-permissions.json`, and got zero type checking as a result. `scripts/check-money-coverage.mjs` now scans `netlify/functions/`, `src/features/billing/`, `src/features/settings/`, `src/features/reports/`, and `src/shared/database/` for any file that imports the `stripe` package and isn't in the include list, and both it and `npm run typecheck:money` run in `test.yml` on every push. That only catches the unambiguous case — a file that moves money because it imports Stripe. Access-decision drift (a new file that should be checked because it touches a permission or tenant boundary) is still a human judgment call: nearly every Netlify function imports `_shared/tenant.js` for routine auth plumbing, so flagging every one of them would be noise, not signal. As other such files get written or modified, they should still be added to `tsconfig.money-permissions.json` by hand.
4. **Styling has no shared component library.** Views build UI as inline style objects against a small token file rather than a set of shared, reusable components. Workable at the current size, but will not scale gracefully as more views are added.
5. **Push notifications are code-complete but not live.** The APNs key, team ID, key ID, bundle ID, and production flag are all unset (see [Section 16](#16-environment-variables)), and the native Push Notifications capability has never been added in Xcode itself — `App.entitlements` alone does not enable it, and that step needs a Mac, which nobody on the team currently has. The oil-due notice pipeline still reaches drivers through its other three channels (realtime toast, email, chat message) in the meantime.
6. **A dead, nested workflow file.** `MRR Production/.github/workflows/ci.yml` predates this folder becoming a subdirectory of a larger repo and no longer runs — GitHub only reads the true repo root's `.github/workflows/`, where `test.yml` and `ios-build.yml` actually live. Harmless but stale; worth deleting next time someone is in that area.

## 24. Conventions for contributors

- **Comments explain "why," not "what."** This codebase leans heavily on comments that document the bug or incident that led to a piece of code existing, not a restatement of what the code obviously does. Match that style; a comment that only paraphrases the line beneath it is not pulling its weight, but a comment explaining why the obvious-looking alternative was wrong is exactly what this project wants.
- **Adding a new SQL migration**: take the next number, never renumber an existing file. Open with a header stating what it does, what it runs after, and whether it's safe to re-run; say so loudly if it is destructive. Close with a `Verify` block someone can paste into the SQL editor. Add a probe for it to `33_migration_ledger.sql` and re-run that file, since a migration nobody can verify later is a liability.
- **Adding a new permission**: add it to `PERM_DEFS` and to every role's entry in `DEFAULT_ROLE_PERMS` in `src/shared/database/permissions.js` (the scoped TypeScript check will flag a role missing a key). Decide whether it needs server-side enforcement too, not just a hidden button.
- **Adding a new view**: create it under the relevant `src/features/<domain>/` folder, lazy-import it in `App.jsx`, add its `<Route>` with whatever permission gate applies, and add an entry to the sidebar if it should be reachable from navigation.
- **Anything that shows a price, sells a seat, or reaches Stripe** must be gated behind `IS_IOS_APP` being false, both at the import site and the render site, or it will ship inside the App Store build and risk a review rejection.
- **Never add a fallback to seed/placeholder data on an empty query result.** With more than one tenant, that pattern has already caused a real bug where a new company's first login showed them another company's data.
