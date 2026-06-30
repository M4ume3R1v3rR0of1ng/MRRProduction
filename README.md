# Maumee River Roofing — MRR Production

Full-stack SaaS web application for warehouse inventory, fleet, and roofing job management, built for roofing operations with offline support, real-time syncing, and role-based access control.

**Repo:** https://github.com/M4ume3R1v3rR0of1ng/MRRProduction

---

## Overview

MRR Production is a React + Supabase + Netlify Functions application purpose-built for roofing operations — covering inventory, fleet management, job building, and field crew coordination.

| Metric | Value |
|---|---|
| Total Files | ~1,565 JS/JSX files |
| Project Size | 137 MB |
| React Version | 18.2.0 |
| Vite Version | 8.0.14 |
| Views | 12 major page components |
| Database Tables | 9+ Supabase tables |
| Serverless Functions | 4 Netlify functions |
| Supported Languages | 2 (English, Spanish) |

---

## Tech Stack

### Core Languages & Frameworks

| Technology | Version | Purpose |
|---|---|---|
| JavaScript (ES6+) | Module-based | Application logic, utilities, serverless functions |
| React | 18.2.0 | Frontend UI framework, component-based architecture |
| JSX | Native to React | Component templates and markup |
| HTML/CSS | — | Inline styles via centralized theme object (`C`) |

**Architectural pattern:** React with functional components and hooks (`useAppData`, `useNotify`, `useRef`, `useEffect`, `useState`). Routing is handled manually via `history.pushState` + `popstate` (no `react-router` dependency).

### Package Dependencies

**Production**
- `@supabase/supabase-js` (2.106.2) — PostgreSQL backend & auth
- `react` (18.2.0) — UI framework
- `react-dom` (18.2.0) — React DOM rendering
- `resend` (6.12.4) — Email service integration

**Development**
- `@vitejs/plugin-react` (4.0.0) — React plugin for Vite
- `vite` (8.0.14) — Build tool & dev server

---

## Frontend Architecture

### Components — `src/components/`
- `UIPrimitives.jsx` — Design system (Modal, Button, Input, Field, Badge, PhotoUpload, etc.)
- `OmniSearch.jsx` — Global search across all entities
- `SyncIndicator.jsx` — Real-time sync status display
- `RecentActivityFeed.jsx` — Activity log component
- `CrewCalendar.jsx` — Calendar view for scheduling
- `IdleTimeoutWrapper.jsx` — Session timeout handler (30 min default)
- `ErrorBoundary.jsx` — React error handling

### Layout — `src/layouts/`
- `Sidebar.jsx` — Navigation drawer, role-based menu, language toggle

### Context API — `src/context/`
- `NotificationContext.jsx` — Toast notifications (success/warning/error)

### Custom Hooks — `src/hooks/`
- `useAppData.js` — Central state management: users, jobs, inventory, vehicles, permissions

### Views — `src/views/`
- `DashboardView.jsx` — Main dashboard with KPIs
- `BuildJobsView.jsx` — Job creation & planning
- `PullInventoryView.jsx` — Material pulling from warehouse
- `InventoryView.jsx` — Warehouse inventory management
- `FleetManagementView.jsx` — Vehicle & truck management
- `MaintenanceRequestsView.jsx` — Vehicle maintenance tickets
- `ReportsView.jsx` — Analytics & reporting
- `UserManagementView.jsx` — User admin panel
- `AuditLogView.jsx` — Activity audit trail
- `SettingsView.jsx` — System configuration
- `ProfileView.jsx` — User profile page
- `LoginScreen.jsx` — Authentication UI

---

## Backend (Netlify Functions)

Located in `netlify/functions/`:

| Function | Purpose | Dependencies |
|---|---|---|
| `send-email.js` | Sends transactional emails via Resend API | Resend SDK |
| `acculynx-sync.js` | Syncs job data to AccuLynx (3rd-party PM) | CORS, AccuLynx API |
| `send-alert.js` | Alert/notification handler | — |
| `daily-archive.js` | Scheduled data archival task | — |

### Email Service (Resend)
- Provider: Resend, via serverless function proxy (`send-email.js`)
- Endpoint: `https://api.resend.com/emails`
- Environment variable: `RESEND_API_KEY`

### AccuLynx Integration
- API version: v2 (`https://api.acculynx.com/api/v2`)
- Auth: Bearer token via `ACCULYNX_API_KEY`
- Endpoints: job search (by name/number), job details retrieval, line item creation, connection validation
- Features: defensive response normalization, retry logic (up to 2 retries), 8-second timeout handling, CORS policy management

---

## Database & Authentication (Supabase)

- Client library: `@supabase/supabase-js` (2.106.2)
- Auth method: anon key + URL from environment
- Database engine: PostgreSQL

### Core Tables

| Table | Purpose |
|---|---|
| `inventory` | Material/stock items with batches |
| `vehicles` | Fleet trucks, trailers, mileage tracking |
| `jobs` | Construction projects/jobs |
| `maintenance_requests` | Vehicle service tickets |
| `warehouses` | Warehouse/location data |
| `profiles` | User accounts & roles |
| `role_permissions` | Permission matrix by role |
| `user_permission_overrides` | Individual user permission overrides |
| `audit_logs` | Immutable activity audit trail |

### Storage Buckets
- Inventory item image uploads
- Vehicle photos
- Job documentation
- Logos/branding assets

### Data Seeding
- File: `src/data/seeds.js` (85 lines)
- Seed data: `SEED_U`, `SEED_W`, `SEED_I`, `SEED_V`, `SEED_JOBS`
- Purpose: fallback data when DB queries fail

---

## State Management & Data Flow

### Data Initialization (`useAppData.js`)
Loading progress is tracked from 0% to 100%:
- 10% — cache extraction from localStorage
- 25% — begin database lookups
- Each query — +9% progress
- 100% — complete

### LocalStorage Keys (`mrr-v7-*` prefix)
- `mrr-v7-inv-photos` — inventory item photos
- `mrr-v7-veh-photos` — vehicle photos
- `mrr-v7-logos` — warehouse logos
- `mrr-v7-acculynx` — AccuLynx config
- `mrr-v7-job-photos` — job documentation images
- `mrr_offline_queue` — offline transaction queue

### Offline Sync Pattern
- Queue system: `offlineSync.js`
- Trigger: `navigator.onLine` detection
- Storage: localStorage
- Processing: automatic queue flush on reconnect
- Events: `offline_queue_updated` custom event

---

## Utility & Helper Functions (`src/utils/`)

| File | Functionality |
|---|---|
| `helpers.js` | Color theme (`C`), UID generation, date/time formatting, currency formatting, inventory totaling, oil change status calculator, image compression |
| `supabase.js` | Supabase client initialization |
| `storage.js` | LocalStorage abstraction wrapper |
| `logger.js` | Audit log writer to Supabase (device-aware, user-tracked) |
| `email.js` | Email dispatch via serverless proxy |
| `pdfGenerator.js` | HTML-to-PDF job reports (grouped by category) |
| `csvExport.js` | CSV export utility |
| `storageBucketUpload.js` | Base64 image → Supabase bucket uploader |
| `accuLynxSync.js` | Job/line-item sync to AccuLynx |
| `offlineSync.js` | Queue & retry offline submissions |
| `translations.js` | Multi-language strings (EN, ES) |

### Key Helper Exports
- `C` — color theme dictionary
- `uid()` — random string generator
- `fd()` — date formatter (e.g. "May 28, 2026")
- `ft()` — timestamp formatter with time
- `fm()` — currency formatter (e.g. "$1,250.00")
- `tot()` — inventory total aggregator
- `newestPrice()` — latest batch price lookup
- `oilSt()` — oil change status calculator
- `compressImg()` — canvas-based image compression

---

## Permissions & Access Control (RBAC)

Defined in `src/database/permissions.js`.

### Roles (6)
- `admin` — full system access
- `warehouse` — inventory & fleet management
- `coordinator` — project oversight + job building
- `manager` — strategic planning
- `field` — site supervisors & crew leads
- `employee` — limited operator access

### Permissions (22 granular)
- **Inventory:** `inv_view`, `inv_edit`, `inv_receive`, `inv_bulk_receive`, `inv_pricing_view`, `inv_pricing_edit`
- **Fleet:** `fleet_view`, `fleet_edit`, `fleet_log_mi`
- **Maintenance:** `maint_submit`, `maint_manage`
- **Jobs:** `jobs_view`, `jobs_build`, `jobs_approve`, `jobs_pull`, `jobs_complete`
- **Reports:** `reports_view`
- **Admin:** `users_manage`, `settings_manage`

### Permission Resolution
1. Role-based baseline permissions
2. Per-user overrides (stored in Supabase)
3. Automatic elevation for admins
4. Runtime calculation via `getEffectivePerms()`

---

## Build Tooling & Deployment

### Vite Configuration
- React plugin (`@vitejs/plugin-react`)
- Default SPA configuration

### Netlify Deployment
- Functions directory: `netlify/functions/`
- Publish folder: `dist/` (Vite output)
- Build command: `npm run build`
- Site ID stored in `.netlify/state.json`
- 4 serverless functions deployed

### Deployment Pipeline
```
Code → GitHub → Netlify auto-deploy
  ├── npm run build (Vite)
  ├── dist/ → Netlify CDN
  └── netlify/functions/ → Netlify serverless runtime
```

### Environment Variables (`.env`)

| Variable | Scope | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Client | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Client | Supabase anonymous key |
| `VITE_RESEND_KEY` | Client (optional) | Resend API key |
| `RESEND_API_KEY` | Server (Netlify) | Resend key |
| `ACCULYNX_API_KEY` | Server (Netlify) | AccuLynx API token |

Environment variables are stored in Netlify and never committed to source code.

---

## Third-Party Integrations

| Service | Integration Method | Use Case |
|---|---|---|
| Supabase | Direct SDK + REST API | Database, auth, storage |
| Resend | Serverless function proxy | Transactional email |
| AccuLynx | API v2 + Bearer auth | Job sync, line items, estimates |
| Netlify | Functions + Hosting | Serverless compute + CDN |

---

## Notable Technical Patterns & Features

### Frontend Patterns
- Component composition via UI primitives with consistent styling
- Responsive design — mobile detection (768px breakpoint), collapsed sidebar
- History API integration for browser back/forward navigation
- `ErrorBoundary` class component for graceful crash handling
- Progress bar with percentage tracking for loading states

### State Management
- Centralized `useAppData` hook combining all app state
- Context API for toast notifications
- Local `useState` for view-level state
- `useMemo` for computed permission resolution

### Data Persistence
- Browser storage: LocalStorage for cache & offline queue
- Database: Supabase for CRUD operations
- CDN storage: Supabase object buckets for images
- Audit trail: immutable logs in Supabase

### Security
- CORS handling — explicit origin whitelist in AccuLynx function
- Server-side secrets — API keys in Netlify env vars, never exposed to client
- Authorization headers — Bearer token pattern for AccuLynx
- Error suppression — internal errors are not exposed to prevent info leaks

### Performance
- Image compression — canvas-based, 350px max, 0.72 quality
- Bundle optimization via Vite tree-shaking
- Code structured for future view-based lazy loading (not yet implemented)

### Internationalization
- Languages: English (en), Spanish (es)
- String dictionary: `translations.js`
- Language toggle available in the sidebar, passed through views

### Other Features
- Audit logging for every action (job create, inventory pull, approval) with user ID, timestamp, and device info
- PDF generation via `pdfGenerator.js` (HTML-to-PDF job reports)
- CSV export via `csvExport.js`
- Crew calendar (`CrewCalendar.jsx`) for scheduling field supervisors
- AccuLynx Order Roadmap — pulls estimate line items from AccuLynx into the job build wizard

---

## Summary

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + CSS-in-JS (inline styles) |
| Backend | Netlify Functions (serverless) |
| Database | Supabase (PostgreSQL + Auth) |
| Storage | Supabase Object Storage |
| Email | Resend (via serverless proxy) |
| 3rd-Party PM | AccuLynx (roofing job management) |
| Deployment | Netlify (functions + hosting) |
| State | React hooks + Context API + LocalStorage |
| Auth | Supabase JWT |
| Monitoring | Custom audit log system |

MRR Production is a full-stack SaaS application for warehouse inventory, fleet, and roofing job management with offline support, real-time syncing, and role-based access control.
