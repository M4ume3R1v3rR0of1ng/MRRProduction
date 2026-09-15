-- Phase 39 — storage for the oil-change push notification feature.
--
-- Run after 38. Idempotent.
--
-- WHAT THIS IS FOR
--
-- A new daily Netlify scheduled function (send-maintenance-push-notices) projects
-- each truck's oil-change due date from its own mileage log (the same math
-- get_fleet_status/recommend_maintenance already use in chat.js), pushes a
-- heads-up to the assigned driver 7 days out, and escalates to a daily URGENT
-- push if nobody has filed a matching maintenance request by the due date.
-- That job needs two things this app has never needed before: somewhere to
-- register a device's push token, and somewhere to remember what it has
-- already sent so it doesn't nag every day starting on day one.
--
-- TWO TABLES, TWO VERY DIFFERENT ACCESS SHAPES
--
--   device_push_tokens — personal. A token belongs to the one person who
--   registered it, not their whole company (the generic tenant_all policy
--   from 02_tenancy_tables.sql would let any teammate read or delete it).
--   RLS restricts read/write to auth.uid() = user_id. The service-role
--   client the cron job and the registration endpoint both use bypasses RLS
--   entirely, same as everywhere else in this app.
--
--   oil_due_notices — job-internal bookkeeping, never read by the browser.
--   No table anyone but the scheduled function touches needs a browser-facing
--   policy at all, so this follows company_secrets' shape from
--   04_security_fixes.sql: RLS on, no policy for authenticated/anon, which is
--   a default deny. Only service_role gets in.

begin;

-- ── device_push_tokens ──────────────────────────────────────────────────────

create table if not exists public.device_push_tokens (
  company_id    uuid not null references public.companies(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null default 'ios',
  token         text primary key,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_push_tokens_platform_known') then
    alter table public.device_push_tokens
      add constraint device_push_tokens_platform_known check (platform in ('ios'));
  end if;
end $$;

create index if not exists device_push_tokens_user_id_idx
  on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists device_push_tokens_own on public.device_push_tokens;
create policy device_push_tokens_own on public.device_push_tokens
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── oil_due_notices ──────────────────────────────────────────────────────────
--
-- One row per vehicle, tracking the CURRENT escalation cycle. cycle_lomi is the
-- vehicle's lomi (mileage at last oil change) when this cycle was opened; the
-- job compares it against the vehicle's live lomi on every run, and a changed
-- value means the oil was actually changed since — the row gets replaced with a
-- fresh cycle rather than continuing to escalate a resolved truck.

create table if not exists public.oil_due_notices (
  company_id           uuid not null references public.companies(id) on delete cascade,
  vehicle_id           text not null,
  cycle_lomi           numeric not null,
  cycle_started_at     timestamptz not null default now(),
  projected_due_date   date,
  heads_up_sent_at     timestamptz,
  urgent_last_sent_at  timestamptz,
  resolved_at          timestamptz,
  updated_at           timestamptz not null default now(),
  primary key (company_id, vehicle_id)
);

alter table public.oil_due_notices enable row level security;
-- No policy for authenticated/anon on purpose — default deny. Only service_role
-- (which bypasses RLS) reads or writes this table; see company_secrets above
-- for the same shape.

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RLS is on for both and device_push_tokens has exactly one policy:
--
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('device_push_tokens', 'oil_due_notices');
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where tablename = 'device_push_tokens';
--
--   Expect relrowsecurity = true for both, and exactly one policy
--   (device_push_tokens_own) on device_push_tokens. oil_due_notices should
--   have zero rows in pg_policies.
--
-- 2. As an authenticated user, confirm you can only see your own tokens:
--
--   select count(*) from public.device_push_tokens where user_id <> auth.uid();
--
--   Expect 0 (not an error — RLS just filters the other rows out).
