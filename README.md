 Maumee River Roofing (MRR Production)
1. Core Languages & Frameworks
Technology	Version	Purpose
JavaScript (ES6+)	Module-based	Application logic, utilities, serverless functions
React	18.2.0	Frontend UI framework, component-based architecture
JSX	Native to React	Component templates and markup
Key Architectural Pattern: React with functional components and hooks (useAppData, useNotify, useRef, useEffect, useState)

2. Package Dependencies (npm/Node.js Ecosystem)
Production Dependencies
@supabase/supabase-js (2.106.2) - PostgreSQL backend & auth
react (18.2.0) - UI framework
react-dom (18.2.0) - React DOM rendering
resend (6.12.4) - Email service integration
Development Dependencies
@vitejs/plugin-react (4.0.0) - React plugin for Vite
vite (8.0.14) - Build tool & dev server
3. Frontend Architecture
Component Structure

src/components/
├── UIPrimitives.jsx      (Design system: Modal, Button, Input, Field, Badge, PhotoUpload, etc.)
├── OmniSearch.jsx        (Global search across all entities)
├── SyncIndicator.jsx     (Real-time sync status display)
├── RecentActivityFeed.jsx (Activity log component)
├── CrewCalendar.jsx      (Calendar view for scheduling)
├── IdleTimeoutWrapper.jsx (Session timeout handler)
├── ErrorBoundary.jsx     (React error handling)
Layout System

src/layouts/
├── Sidebar.jsx           (Navigation drawer, role-based menu, language toggle)
Context API & State Management

src/context/
├── NotificationContext.jsx (Toast notifications - success/warning/error)
Custom Hooks

src/hooks/
├── useAppData.js         (Central state management: users, jobs, inventory, vehicles, perms)
View/Page Components

src/views/
├── DashboardView.jsx       (Main dashboard with KPIs)
├── BuildJobsView.jsx       (Job creation & planning)
├── PullInventoryView.jsx   (Material pulling from warehouse)
├── InventoryView.jsx       (Warehouse inventory management)
├── FleetManagementView.jsx (Vehicle & truck management)
├── MaintenanceRequestsView.jsx (Vehicle maintenance tickets)
├── ReportsView.jsx         (Analytics & reporting)
├── UserManagementView.jsx  (User admin panel)
├── AuditLogView.jsx        (Activity audit trail)
├── SettingsView.jsx        (System configuration)
├── ProfileView.jsx         (User profile page)
├── LoginScreen.jsx         (Authentication UI)
Total Codebase: ~1,565 JSX/JS files, 137 MB total project size

4. Backend & Serverless Functions (Netlify Functions)
Located in netlify/functions/:

Function	Purpose	Dependencies
send-email.js	Sends transactional emails via Resend API	Resend SDK
acculynx-sync.js	Syncs job data to AccuLynx (3rd-party PM)	CORS, AccuLynx API
send-alert.js	Alert/notification handler	(implied)
daily-archive.js	Scheduled data archival task	(implied)
Email Service Implementation
Provider: Resend (send-email.js)
Method: Serverless function proxy
Environment Variable: RESEND_API_KEY
Endpoint: https://api.resend.com/emails
AccuLynx Integration
API Version: v2 (https://api.acculynx.com/api/v2)
Endpoints Supported:
Job search (by name, job number)
Job details retrieval
Line items creation
Connection validation
Auth: Bearer token via ACCULYNX_API_KEY
Features:
Defensive normalization of API responses
Retry logic (up to 2 retries)
Timeout handling (8 seconds)
CORS policy management
5. Database & Authentication (Supabase)
Supabase Integration
Client Library: @supabase/supabase-js (2.106.2)
Auth Method: Anon key + URL from environment
Database Engine: PostgreSQL
Core Database Tables (from useAppData.js)
Table	Purpose
inventory	Material/stock items with batches
vehicles	Fleet trucks, trailers, mileage tracking
jobs	Construction projects/jobs
maintenance_requests	Vehicle service tickets
warehouses	Warehouse/location data
profiles	User accounts & roles
role_permissions	Permission matrix by role
user_permission_overrides	Individual user permission overrides
audit_logs	Immutable activity audit trail
Storage Buckets (Supabase Object Storage)
Image uploads for inventory items
Vehicle photos
Job documentation
Logos/branding assets
Data Seeding
Seeds File: src/data/seeds.js (85 lines)
Seed Data: SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS
Purpose: Fallback data when DB queries fail
6. State Management & Data Flow
Data Initialization (useAppData.js hook)

Loading progress tracking (0% → 100%)
  ├─ 10%: Cache extraction from localStorage
  ├─ 25%: Begin database lookups
  ├─ Each query: +9% progress
  └─ 100%: Complete
Local Storage Keys (mrr-v7-* prefix)
mrr-v7-inv-photos - Inventory item photos
mrr-v7-veh-photos - Vehicle photos
mrr-v7-logos - Warehouse logos
mrr-v7-acculynx - AccuLynx config
mrr-v7-job-photos - Job documentation images
mrr_offline_queue - Offline transaction queue
Offline Sync Pattern
Queue System: offlineSync.js
Trigger: navigator.onLine detection
Storage: localStorage
Processing: Automatic queue flush on reconnect
Events: offline_queue_updated custom event
7. Utility & Helper Functions (src/utils/)
File	Functionality
helpers.js	Color theme (C object), UID generation, date/time formatting (fd, ft), currency formatting (fm), inventory totaling (tot), oil change status calculator, image compression
supabase.js	Supabase client initialization
storage.js	LocalStorage abstraction wrapper
logger.js	Audit log writer to Supabase (device-aware, user-tracked)
email.js	Email dispatch via serverless proxy
pdfGenerator.js	HTML-to-PDF job reports (grouped by category)
csvExport.js	CSV export utility
storageBucketUpload.js	Base64 image → Supabase bucket uploader
accuLynxSync.js	Job/line-item sync to AccuLynx
offlineSync.js	Queue & retry offline submissions
translations.js	Multi-language strings (en, es)
Helper Utilities Exported

C             // Color theme dictionary
uid()         // Random string generator
fd()          // Date formatter ("May 28, 2026")
ft()          // Timestamp formatter with time
fm()          // Currency formatter ("$1,250.00")
tot()         // Inventory total aggregator
newestPrice() // Latest batch price lookup
oilSt()       // Oil change status calculator
compressImg() // Canvas-based image compression
8. Permission & Access Control System
Role-Based Access Control (RBAC)
Located in src/database/permissions.js:

5 User Roles:

admin - Full system access
warehouse - Inventory & fleet management
coordinator - Project oversight + job building
manager - Strategic planning
field - Site supervisors & crew leads
employee - Limited operator access
22 Granular Permissions:


Inventory:     inv_view, inv_edit, inv_receive, inv_bulk_receive, 
               inv_pricing_view, inv_pricing_edit
Fleet:         fleet_view, fleet_edit, fleet_log_mi
Maintenance:   maint_submit, maint_manage
Jobs:          jobs_view, jobs_build, jobs_approve, jobs_pull, jobs_complete
Reports:       reports_view
Admin:         users_manage, settings_manage
Permission Resolution:

Role-based baseline permissions
Per-user overrides (stored in DB)
Automatic elevation for admins
Runtime calculation via getEffectivePerms()
9. Build Tooling & Deployment
Vite Configuration

// vite.config.js
- React plugin (@vitejs/plugin-react)
- Default SPA configuration
Netlify Deployment
Functions Directory: netlify/functions/
Publish Folder: dist/ (Vite output)
Build Command: npm run build
Build Output: Vite production build
Site ID: Stored in .netlify/state.json
Functions: 4 serverless edge functions
Environment Variables (from .env)
VITE_SUPABASE_URL - Supabase project URL
VITE_SUPABASE_ANON_KEY - Supabase anonymous key
VITE_RESEND_KEY - Resend API key (optional client-side)
RESEND_API_KEY - Resend key (server-side in Netlify)
ACCULYNX_API_KEY - AccuLynx API token (server-side in Netlify)
10. Third-Party Integrations
Service	Integration Method	Use Case
Supabase	Direct SDK + REST API	Database, auth, storage
Resend	Serverless function proxy	Transactional email
AccuLynx	API v2 + Bearer auth	Job sync, line items, estimates
Netlify	Functions + Hosting	Serverless compute + CDN
11. Notable Technical Patterns & Features
Frontend Patterns
Component Composition: UI primitives with consistent styling
Responsive Design: Mobile detection (768px breakpoint), collapsed sidebar
History API Integration: Browser back/forward navigation via popstate
Error Handling: ErrorBoundary class component
Loading States: Progress bar with percentage tracking
State Management
Centralized Hook: useAppData combines all app state
Context API: NotificationContext for toast messages
Local State: React useState for view-level state
Computed Values: useMemo for permission resolution
Data Persistence
Browser Storage: LocalStorage for cache & offline queue
Database: Supabase for CRUD operations
CDN Storage: Supabase object buckets for images
Audit Trail: Immutable logs in Supabase
Security
CORS Handling: Explicit origin whitelist in AccuLynx function
Server-Side Secrets: API keys in Netlify env vars (not exposed to client)
Authorization Headers: Bearer token pattern for AccuLynx
Error Suppression: Don't expose internal errors to prevent info leaks
Performance
Image Compression: Canvas-based client-side compression (350px max, 0.72 quality)
Bundle Optimization: Vite tree-shaking
Lazy Loading: Code is ready for view-based splitting (not yet implemented)
Internationalization (i18n)
Language Support: English (en), Spanish (es)
String Dictionary: translations.js with key-value pairs
UI Integration: Language toggle in Sidebar, passed through views
Accessibility & UX
Semantic HTML: Form fields with labels
Color Contrast: Consistent C theme object
Responsive Layout: Mobile-first with media queries
Idle Timeout: IdleTimeoutWrapper (1800s = 30 min default)
12. Project Metrics
Metric	Value
Total Files	~1,565 JS/JSX files
Project Size	137 MB
React Version	18.2.0
Vite Version	8.0.14
Views	12 major page components
Components	6+ UI primitive + layout components
Database Tables	9+ Supabase tables
Serverless Functions	4 Netlify functions
Supported Languages	2 (English, Spanish)
Summary: Core Technology Stack
Frontend: React 18 + Vite + CSS-in-JS (inline styles)

Backend: Netlify Functions (serverless)

Database: Supabase (PostgreSQL + Auth)

Storage: Supabase Object Storage

Email: Resend (via serverless proxy)

3rd-party PM: AccuLynx (roofing job management)

Deployment: Netlify (functions + hosting)

State: React hooks + Context API + LocalStorage

Auth: Supabase JWT

Monitoring: Custom audit log system

This is a full-stack SaaS application for warehouse inventory, fleet, and roofing job management with offline support, real-time syncing, and role-based access control.

Here's the full breakdown of everything powering this site:

Tech Stack & IT Skills — MRR Production
Languages
JavaScript (ES6+) — all application and server logic
JSX — React component templates
HTML/CSS — inline styles via a centralized theme object (C)
Frontend
React 18 — functional components, hooks, Context API
Vite 8 — build tool and dev server
React Router pattern — manual history.pushState + popstate (no react-router dependency)
CSS-in-JS — all styles written as inline JS objects, no stylesheet files
Component architecture:

Layer	What it does
UIPrimitives.jsx	Design system — Button, Input, Modal, Badge, Field
src/views/	12 full page views (Dashboard, Jobs, Inventory, Fleet, etc.)
src/hooks/useAppData.js	Central state — all data, permissions, users loaded here
src/context/NotificationContext.jsx	Global toast notifications
ErrorBoundary.jsx	Catches React crashes gracefully
IdleTimeoutWrapper.jsx	Auto-logout after 30 min inactivity
Backend (Serverless)
Netlify Functions — 4 Node.js serverless functions:
Function	Purpose
acculynx-sync.js	AccuLynx API proxy — search, job lookup, line item push
send-email.js	Email via Resend API
send-alert.js	Alert notifications
daily-archive.js	Scheduled data archival
Database & Auth
Supabase (PostgreSQL) — 9+ tables:
jobs, inventory, vehicles, profiles, warehouses
role_permissions, user_permission_overrides
maintenance_requests, audit_logs
Supabase Object Storage — images for inventory, vehicles, jobs, logos
Supabase Auth — JWT-based login
Third-Party Integrations
Service	How
AccuLynx	REST API v2 — pull jobs, push material line items
Resend	Transactional email (job assignments, approvals)
Netlify	Hosting + CDN + serverless compute
Security & Access Control
RBAC — 6 roles (admin, warehouse, coordinator, manager, field, employee)
22 granular permissions — per feature (view, edit, approve, etc.)
Per-user overrides — stored in Supabase, layered on top of role defaults
API keys server-side only — AccuLynx and Resend keys never reach the browser
CORS whitelist — explicit origin list on all Netlify functions
Offline & Performance
Offline queue — localStorage queue that flushes when back online
LocalStorage caching — photos, config, and data cached under mrr-v7-* keys
Client-side image compression — Canvas API, 350px max / 0.72 quality before upload
Progress tracking — load bar goes 0→100% as each Supabase table loads
Other Notable Features
Audit logging — every action (job create, inventory pull, approval) written to Supabase with user ID, timestamp, device info
PDF generation — pdfGenerator.js renders job reports to HTML→PDF
CSV export — csvExport.js for reports
Bilingual (EN/ES) — full translation dictionary in translations.js
Crew calendar — CrewCalendar.jsx for scheduling field supervisors
AccuLynx Order Roadmap — pulls estimate line items from AccuLynx into job build wizard
Deployment Pipeline

Code → GitHub → Netlify auto-deploy
  ├── npm run build (Vite)
  ├── dist/ → Netlify CDN
  └── netlify/functions/ → Netlify serverless runtime
Environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RESEND_API_KEY, ACCULYNX_API_KEY) stored in Netlify — never in source code.

In short: this is a full-stack SaaS web app using React + Supabase + Netlify Functions, purpose-built for roofing operations — inventory, fleet, job management, and field crew coordination.
