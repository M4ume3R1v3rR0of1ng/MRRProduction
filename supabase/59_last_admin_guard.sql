-- Phase 59 — no company may be left with members but no admin.
--
-- OPTIONAL. Nothing else in the schema depends on this file, and the app works
-- without it. Run after 01 (it only needs public.memberships). Idempotent.
--
-- WHY
--
-- Nothing anywhere — not the app, not the functions, not RLS — stops the last
-- active admin of a company from being deleted or demoted. The UI cannot quite
-- get you there today (delete-user.js refuses self-removal, so an admin removing
-- someone else is always still an admin afterwards), which is exactly why this is
-- worth installing before anyone starts doing membership surgery by hand in the
-- SQL editor: that is the route with no checks at all.
--
-- A company with staff but no admin cannot add a user, change a role, or reach
-- settings. Only a platform admin visiting the tenant can dig it out, and they
-- have to notice first.
--
-- WHAT COUNTS AS "LOSING" AN ADMIN
--
-- One transition: a row that IS an active admin ceasing to be one — deleted,
-- deactivated, or given another role. Everything else passes straight through,
-- including an update that leaves an active admin an active admin.
--
-- THE FOUR EXEMPTIONS, AND WHY EACH IS HERE
--
--   1. app.allow_last_admin_removal = on. A transaction-scoped opt-out for
--      deliberate operator work, set with
--        select set_config('app.allow_last_admin_removal', 'on', true);
--      It is local to the transaction, so it cannot be left switched on.
--      retire_platform_admin_membership.sql sets this when the operator has
--      explicitly chosen to proceed without an admin in the tenant.
--
--   2. The company row is gone. Deleting a company cascades its memberships away
--      (delete-company.js issues one delete against `companies` and lets the FK do
--      the rest). Guarding that would make a tenant undeletable.
--
--   3. current_user = 'service_role'. The app's own privileged paths — create-user,
--      delete-user, delete-company — carry their own membership checks, and
--      delete-user already refuses self-removal. Blocking them here would turn a
--      guard into an outage for flows that are already safe. The SQL editor runs
--      as `postgres`, NOT service_role, so manual work stays guarded: that is the
--      case this file exists for.
--
--   4. Nobody else is left in the company at all. With no other active member
--      there is no one to strand, so refusing would just block tidying up.
--
-- SECURITY INVOKER, like 48's guard: it reads memberships under the caller's own
-- RLS, which is honest for every caller that can reach this table (service_role
-- and the SQL editor bypass RLS; a company admin's own rows are visible to them
-- through memberships_select in 01), and it keeps current_user meaningful for
-- exemption 3 — a definer would report the function owner instead.
--
-- LEDGER
--
-- Not probed in 33 on purpose: this file is optional, and a probe for something
-- deliberately not installed would read 'missing' forever on a healthy database.
-- If you adopt it, add this to 33's do-block and re-run that file:
--
--   perform public._mig_record('59_last_admin_guard.sql',
--     public._mig_has_function('membership_last_admin_guard'),
--     'function membership_last_admin_guard');

begin;

create or replace function public.membership_last_admin_guard()
returns trigger
language plpgsql
as $$
declare
  co     uuid := old.company_id;
  exempt boolean;
begin
  if old.role = 'admin'
     and old.active
     -- An update that keeps them an active admin of the same company is not a loss.
     and not (
       tg_op = 'UPDATE'
       and new.role = 'admin'
       and new.active
       and new.company_id = old.company_id
     )
  then
    exempt :=
      coalesce(current_setting('app.allow_last_admin_removal', true), 'off') = 'on'
      or current_user = 'service_role'
      or not exists (select 1 from public.companies c where c.id = co)
      or not exists (
        select 1 from public.memberships m
        where m.company_id = co and m.active and m.user_id <> old.user_id
      );

    if not exempt
       and not exists (
         select 1 from public.memberships m
         where m.company_id = co
           and m.active
           and m.role = 'admin'
           and m.user_id <> old.user_id
       )
    then
      raise exception
        'That is the last active admin of %. Removing or demoting them would leave the company with staff and nobody who can manage them.',
        coalesce((select c.name from public.companies c where c.id = co), co::text)
        using errcode = 'insufficient_privilege',
              hint = 'Promote someone first. In the app, as a platform admin: '
                  || 'select public.admin_add_company_admin(' || quote_literal(co::text)
                  || ', ''their@email''); — that RPC checks is_platform_admin(), which reads '
                  || 'auth.uid() and so always fails in the SQL editor. There, insert directly: '
                  || 'insert into public.memberships (user_id, company_id, role, active) select id, '
                  || quote_literal(co::text) || ', ''admin'', true from public.profiles where '
                  || 'lower(email) = ''their@email'' on conflict (user_id, company_id) do update '
                  || 'set role = ''admin'', active = true; — or, if leaving this tenant without an admin is '
                  || 'intended, run select set_config(''app.allow_last_admin_removal'', ''on'', true); '
                  || 'in the same transaction.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.membership_last_admin_guard() is
  'Refuses to delete, deactivate or demote a company''s last active admin while other '
  'active members remain. Exempt: app.allow_last_admin_removal = on, a company being '
  'deleted, service_role (the app''s own guarded paths), and a company with no other '
  'members. See supabase/59.';

drop trigger if exists membership_last_admin_guard_t on public.memberships;
create trigger membership_last_admin_guard_t
  before delete or update on public.memberships
  for each row execute function public.membership_last_admin_guard();

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. Installed, and SECURITY INVOKER (prosecdef = false):
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'membership_last_admin_guard';
--
--   select tgname, tgenabled from pg_trigger
--   where tgrelid = 'public.memberships'::regclass and not tgisinternal;
--
--   -- B. Which companies this would currently protect — anything with exactly one
--   --    active admin and somebody else on the books:
--   select c.name,
--          count(*) filter (where m.active and m.role = 'admin') as active_admins,
--          count(*) filter (where m.active)                      as active_members
--   from public.companies c
--   join public.memberships m on m.company_id = c.id
--   group by c.name
--   having count(*) filter (where m.active and m.role = 'admin') = 1
--   order by c.name;
--
--   -- C. It bites (run in a transaction you roll back). Pick a company from B:
--   --   begin;
--   --     delete from public.memberships
--   --     where company_id = '<uuid from B>' and role = 'admin' and active;
--   --     -- expect: 42501, 'That is the last active admin of …'
--   --   rollback;
-- ─────────────────────────────────────────────────────────────────────────────
