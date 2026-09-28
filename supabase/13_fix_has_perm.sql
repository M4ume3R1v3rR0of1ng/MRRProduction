-- Fix: has_perm() threw 42883 "operator does not exist: text = uuid".
--
-- user_permission_overrides.user_id is a TEXT column (it stores the uuid as a
-- string), but auth.uid() is a uuid — so `o.user_id = auth.uid()` had no operator
-- and every has_perm() call crashed. That made the enforcement trigger reject EVERY
-- gated transition (not just unauthorized ones), blocking legitimate actions too.
--
-- Fix = cast auth.uid() to text in that lookup.
--
-- Run after 12. Idempotent.

begin;

create or replace function public.has_perm(perm_key text)
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
  if r = 'admin' then return true; end if;

  select rp.permissions into stored
  from public.role_permissions rp where rp.company_id = co and rp.role = r;

  select o.overrides into override
  from public.user_permission_overrides o
  where o.company_id = co and o.user_id = auth.uid()::text;  -- user_id is TEXT

  val := coalesce(override ->> perm_key, stored ->> perm_key, public.default_job_perms(r) ->> perm_key);
  return coalesce(val::boolean, false);
end;
$$;

grant execute on function public.has_perm(text) to authenticated, service_role;

commit;
