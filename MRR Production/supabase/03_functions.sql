-- Phase 1c — the functions the app and the cron actually call.
-- Run after 02_tenancy_tables.sql. Safe to re-run (everything is CREATE OR REPLACE).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. archive_old_audit_logs()
--
--    netlify/functions/daily-archive.js has been calling this every midnight since
--    it was written — and it has never existed, so the cron has been failing
--    silently every night. This creates it.
--
--    ⚠️ It DELETES. Audit logs older than 30 days are gone permanently; there is no
--    archive table (the empty `audit_log` singular table was a dead end and 02 drops
--    it). That is what you asked for, but be aware of what it means: if you ever need
--    to answer "who changed this price back in March", the answer will not be here.
--    If you later want real archival, this becomes an INSERT ... SELECT into cold
--    storage followed by the DELETE.
--
--    Deliberately company-agnostic: it is platform maintenance and sweeps every
--    tenant's old rows in one pass. It runs as service_role from the cron, which
--    bypasses RLS anyway.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.archive_old_audit_logs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted integer;
begin
  delete from public.audit_logs
  where created_at < now() - interval '30 days';

  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Only the nightly cron may call this. No browser session should be able to wipe
-- 30-day-old audit history.
revoke all on function public.archive_old_audit_logs() from public, anon, authenticated;
grant execute on function public.archive_old_audit_logs() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Company config, writable by that company's admin.
--
--    We cannot simply open UPDATE on `companies` to company admins: the same grant
--    would let them set their own subscription_status to 'active' and use the product
--    for free forever. So writes go through these two narrow functions, which touch
--    exactly one column each and never see the billing fields.
-- ─────────────────────────────────────────────────────────────────────────────

-- Merge a patch into companies.branding — logo, colors, display name.
-- e.g. set_company_branding('{"logo": "data:image/png;base64,..."}')
create or replace function public.set_company_branding(patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := public.active_company_id();
  result jsonb;
begin
  if target is null then
    raise exception 'No active company';
  end if;
  if public.active_role() <> 'admin' and not public.is_platform_admin() then
    raise exception 'Admin access required';
  end if;

  update public.companies
  set branding = branding || patch
  where id = target
  returning branding into result;

  return result;
end;
$$;

grant execute on function public.set_company_branding(jsonb) to authenticated;

-- Set one key inside companies.integrations — e.g. the company's AccuLynx API key.
-- Write-only by design: see the REVOKE below.
create or replace function public.set_company_integration(k text, v jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := public.active_company_id();
begin
  if target is null then
    raise exception 'No active company';
  end if;
  if public.active_role() <> 'admin' and not public.is_platform_admin() then
    raise exception 'Admin access required';
  end if;

  update public.companies
  set integrations = integrations || jsonb_build_object(k, v)
  where id = target;
end;
$$;

grant execute on function public.set_company_integration(text, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lock the secrets away from the browser.
--
--    companies_select_own (from 01) lets any member SELECT their company row. That
--    row now holds the AccuLynx API key and the Stripe ids. RLS is row-level and
--    cannot hide a column — so a warehouse employee could read the company's
--    AccuLynx key straight out of the REST API.
--
--    Column privileges are the only thing that can stop that.
-- ─────────────────────────────────────────────────────────────────────────────
revoke select (integrations, stripe_customer_id, stripe_subscription_id)
  on public.companies from authenticated, anon;

-- The app still needs to know *whether* an integration is set up, without being
-- able to read the secret itself. Booleans only.
create or replace function public.company_integration_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'acculynxConfigured',
      coalesce(nullif(c.integrations->>'acculynxApiKey', ''), null) is not null
  )
  from public.companies c
  where c.id = public.active_company_id();
$$;

grant execute on function public.company_integration_status() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Let a user see every company they belong to — not just the active one.
--
--    01's companies_select_own only exposed the company matching active_company_id().
--    That is too tight for the login flow: a user who belongs to two companies has to
--    be shown a picker with both NAMES in it, before they've chosen one. With the old
--    policy the join came back null and the picker would render two blank rows.
--
--    Still nothing to do with other people's companies — membership is required.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_member_of(target uuid)
returns boolean
language sql
stable
security definer          -- reads memberships from inside a companies policy; must not re-enter RLS
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.company_id = target
      and m.active
  );
$$;

drop policy if exists companies_select_own on public.companies;

create policy companies_select_member on public.companies
  for select to authenticated
  using (public.is_member_of(id) or public.is_platform_admin());

-- Because a member can now SELECT several company rows, "select the company row"
-- is no longer a single-row query and .maybeSingle() would start erroring for
-- anyone in two companies. This always returns exactly the active one.
create or replace function public.my_company()
returns table (id uuid, name text, slug text, branding jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.name, c.slug, c.branding
  from public.companies c
  where c.id = public.active_company_id();
$$;

grant execute on function public.my_company() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. set_member_role() — change someone's role WITHIN the caller's company.
--
--    Needed because memberships is not directly writable by company admins (02 grants
--    that only to the platform admin, on purpose — direct UPDATE on memberships would
--    let an admin add themselves to another company). Without this, editing a user's
--    role in User Management would write the deprecated profiles.role and silently do
--    nothing: permissions are read from memberships now.
--
--    Scoped hard: the caller can only touch a membership in their OWN company.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_member_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target uuid := public.active_company_id();
begin
  if target is null then
    raise exception 'No active company';
  end if;
  if public.active_role() <> 'admin' and not public.is_platform_admin() then
    raise exception 'Admin access required';
  end if;
  if new_role not in ('admin','warehouse','coordinator','manager','field','employee','bookkeeper') then
    raise exception 'Invalid role: %', new_role;
  end if;

  update public.memberships
  set role = new_role
  where user_id = target_user
    and company_id = target;

  if not found then
    raise exception 'That user is not a member of your company';
  end if;

  -- profiles.role is DEPRECATED but still read by the React app at a few sites.
  -- Keep it in step until those are gone, then drop this line and the column.
  update public.profiles set role = new_role where id = target_user;
end;
$$;

grant execute on function public.set_member_role(uuid, text) to authenticated;

commit;
