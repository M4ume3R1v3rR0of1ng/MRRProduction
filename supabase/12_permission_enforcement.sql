-- Phase 6 — server-side permission enforcement + live permission refresh.
--
-- Until now, job permissions (jobs_close, jobs_pull, …) were UI-only: the buttons
-- were hidden, but the database let ANY company member perform ANY action within
-- their tenant. So "only Sabrina can close jobs" was not actually enforced — a stale
-- session or a direct API call bypassed it.
--
-- This makes the rule real. A trigger on `jobs` checks the caller's effective
-- permission for each sensitive status transition, in the DATABASE, where the UI
-- can't be gone around.
--
-- Run after 11. Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The effective-permission check, mirroring the frontend's getEffectivePerms.
--
--    effective = default_for(role)  ⟵ role_permissions.permissions ⟵ user override
--    (later wins). Admins get everything, same as the UI.
-- ─────────────────────────────────────────────────────────────────────────────

-- Role defaults for the JOB permissions we enforce. Mirrors DEFAULT_ROLE_PERMS in
-- src/database/permissions.js — keep the two in sync. Only the job keys are here
-- because those are the only ones enforced server-side today.
create or replace function public.default_job_perms(role text)
returns jsonb
language sql
immutable
as $$
  select case role
    when 'coordinator' then '{"jobs_build":true,"jobs_approve":true,"jobs_pull":true,"jobs_complete":true,"jobs_close":true}'::jsonb
    when 'manager'     then '{"jobs_build":true,"jobs_approve":true,"jobs_pull":true,"jobs_complete":true,"jobs_close":true}'::jsonb
    when 'warehouse'   then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":true,"jobs_complete":true,"jobs_close":false}'::jsonb
    when 'field'       then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":true,"jobs_complete":true,"jobs_close":false}'::jsonb
    when 'bookkeeper'  then '{"jobs_build":false,"jobs_approve":false,"jobs_pull":false,"jobs_complete":false,"jobs_close":true}'::jsonb
    else '{"jobs_build":false,"jobs_approve":false,"jobs_pull":false,"jobs_complete":false,"jobs_close":false}'::jsonb
  end;
$$;

-- Does the CURRENT caller hold perm_key, in their active company? SECURITY DEFINER
-- so it reads role_permissions/overrides past their RLS without recursing.
drop function if exists public.has_perm(text);
create function public.has_perm(perm_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  co       uuid := public.active_company_id();
  r        text := public.active_role();
  stored   jsonb;
  override jsonb;
  val      text;
begin
  if co is null then return false; end if;
  if r = 'admin' then return true; end if;  -- admins bypass, same as the UI

  select rp.permissions into stored
  from public.role_permissions rp where rp.company_id = co and rp.role = r;

  select o.overrides into override
  from public.user_permission_overrides o
  where o.company_id = co and o.user_id = auth.uid()::text;  -- user_id is TEXT, not uuid

  -- override wins, then the stored role row, then the built-in default
  val := coalesce(override ->> perm_key, stored ->> perm_key, public.default_job_perms(r) ->> perm_key);
  return coalesce(val::boolean, false);
end;
$$;

grant execute on function public.has_perm(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The enforcement trigger on `jobs`.
--
--    SECURITY INVOKER (default) is REQUIRED here: the trigger reads current_user to
--    tell a browser request ('authenticated') apart from a trusted backend one
--    (service_role / postgres). A SECURITY DEFINER trigger would see current_user as
--    the owner and never enforce — the same footgun that bit the earlier column
--    guards. has_perm() is the one that's DEFINER, so it can still read the tables.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_job_perms()
returns trigger
language plpgsql
as $$
begin
  -- Only real browser users are gated. The Netlify functions (service_role) and
  -- migrations (postgres) are trusted backend paths and pass straight through.
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if not public.has_perm('jobs_build') then
      raise exception 'You do not have permission to create jobs.' using errcode = '42501';
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if not public.has_perm('jobs_build') then
      raise exception 'You do not have permission to delete jobs.' using errcode = '42501';
    end if;
    return old;

  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if new.status = 'active' and old.status = 'approved' then
        if not public.has_perm('jobs_pull') then
          raise exception 'You do not have permission to pull inventory for jobs.' using errcode = '42501';
        end if;
      elsif new.status = 'completed' and old.status = 'closed' then
        -- reopening a closed job is a close-holder action, not a complete-holder one
        if not public.has_perm('jobs_close') then
          raise exception 'You do not have permission to reopen closed jobs.' using errcode = '42501';
        end if;
      elsif new.status = 'completed' then
        if not public.has_perm('jobs_complete') then
          raise exception 'You do not have permission to complete jobs.' using errcode = '42501';
        end if;
      elsif new.status = 'closed' then
        if not public.has_perm('jobs_close') then
          raise exception 'You do not have permission to close jobs.' using errcode = '42501';
        end if;
      elsif new.status = 'approved' then
        if not public.has_perm('jobs_approve') then
          raise exception 'You do not have permission to approve jobs.' using errcode = '42501';
        end if;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_job_perms_trg on public.jobs;
create trigger enforce_job_perms_trg
  before insert or update or delete on public.jobs
  for each row execute function public.enforce_job_perms();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Live permission refresh (part B).
--
--    Add the permission tables to the realtime publication so the app can subscribe
--    to changes and re-pull perms without a re-login. RLS still scopes what each
--    client receives to their own company.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.role_permissions;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.user_permission_overrides;
  exception when duplicate_object then null; end;
end $$;

commit;
