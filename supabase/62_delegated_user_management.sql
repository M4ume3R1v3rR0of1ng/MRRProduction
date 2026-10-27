-- Phase 62 — set_member_role() honours the users_manage permission.
--
-- REQUIRED if you grant "Manage Users" to any non-admin role. Run after 03 (it
-- replaces set_member_role from there) and after 13 (it calls has_perm).
-- Idempotent: it is a create-or-replace of one function and nothing else.
--
-- WHY
--
-- Settings has had a per-role "Manage Users" toggle (users_manage) since the
-- permission matrix landed. Flipping it on for, say, managers makes the User
-- Management screen appear for them — App.jsx gates that route on the permission.
-- But nothing on the server had ever heard of it: every write path tested for the
-- literal role 'admin'. So the screen appeared and every button on it failed with
-- "Admin access required", which reads like a database fault rather than a
-- permission that was never wired up.
--
-- The Netlify functions (create-user, update-user, delete-user, reset-password)
-- now resolve this through _shared/userAdmin.js. This file is the same policy for
-- the one user-management write that does NOT go through a function: the role
-- dropdown, which calls set_member_role() straight from the browser.
--
-- THE DELEGATE RULES
--
-- A caller who holds users_manage but is not an admin is a DELEGATE. They may
-- change roles, with three refusals — each one closing a route from the
-- permission back up to full admin:
--
--   1. They may not set anyone's role to 'admin'. Otherwise the permission is a
--      self-service promotion: grant it to an account you control, sign in.
--
--   2. They may not change a membership that IS an admin's. Otherwise a delegate
--      can demote every admin in the company — the no-admins-left outage that
--      59_last_admin_guard.sql exists to prevent, reached through a supported
--      button instead of hand-written SQL.
--
--   3. They may not change their own role at all. Rule 1 already blocks the only
--      move that would gain them anything; this is stated separately so the
--      intent survives anyone later relaxing rule 1 for a narrower case.
--
-- A real admin and the platform owner are unaffected: same behaviour as before.
--
-- WHAT IS DELIBERATELY NOT DELEGATED
--
-- role_permissions and user_permission_overrides keep their admin-only RLS from
-- 02. Handing out individual permissions is how a delegate would grant
-- settings_manage to a friendly account and get everything the rules above deny,
-- so the permission matrix itself stays with the admins. The UI hides the
-- Override button from delegates to match.
--
-- MIRROR WARNING
--
-- _shared/userAdmin.js implements these same three rules in JavaScript, because
-- the service-role key means the database will not enforce them for the Netlify
-- functions. Change one, change both — the same standing hazard resolveCaller
-- already carries for active_company_id().
--
-- LEDGER
--
-- Add to 33's do-block and re-run that file:
--
--   perform public._mig_record('62_delegated_user_management.sql',
--     'set_member_role() accepts has_perm(''users_manage'') with the three delegate refusals.',
--     'Verify: a non-admin holding users_manage can set a member to manager but not to admin.', now());

begin;

create or replace function public.set_member_role(target_user uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target      uuid := public.active_company_id();
  full_admin  boolean;
  target_role text;
begin
  if target is null then
    raise exception 'No active company';
  end if;

  full_admin := public.active_role() = 'admin' or public.is_platform_admin();

  -- The widening: an admin as before, or anyone the company granted users_manage.
  -- has_perm() already returns true for every permission when active_role() is
  -- 'admin', so this is strictly additive — no existing caller changes behaviour.
  if not full_admin and not public.has_perm('users_manage') then
    raise exception 'Admin access required';
  end if;

  if new_role not in ('admin','warehouse','coordinator','manager','field','employee','bookkeeper') then
    raise exception 'Invalid role: %', new_role;
  end if;

  -- Read the target's CURRENT role before touching it: rules 2 and 3 both turn on
  -- who the target is, and rule 2 needs the role as it stands, not as requested.
  select m.role into target_role
  from public.memberships m
  where m.user_id = target_user
    and m.company_id = target;

  if target_role is null then
    raise exception 'That user is not a member of your company';
  end if;

  if not full_admin then
    -- Rule 1.
    if new_role = 'admin' then
      raise exception 'Only an admin can give someone admin access. Ask an admin to make this change.';
    end if;
    -- Rule 2.
    if target_role = 'admin' then
      raise exception 'Only an admin can change another admin''s account.';
    end if;
    -- Rule 3.
    if target_user = auth.uid() then
      raise exception 'You cannot change your own role. Ask an admin to make this change.';
    end if;
  end if;

  update public.memberships
  set role = new_role
  where user_id = target_user
    and company_id = target;

  -- profiles.role is DEPRECATED but still read by the React app at a few sites.
  -- Keep it in step until those are gone, then drop this line and the column.
  update public.profiles set role = new_role where id = target_user;
end;
$$;

grant execute on function public.set_member_role(uuid, text) to authenticated;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- As an admin, nothing should have changed:
--
--   select public.set_member_role('<some member uuid>', 'manager');
--
-- As a non-admin holding users_manage, the first succeeds and the second fails:
--
--   select public.set_member_role('<some non-admin member>', 'coordinator');
--   select public.set_member_role('<some non-admin member>', 'admin');
--   -- ERROR: Only an admin can give someone admin access.
--
-- As a non-admin WITHOUT users_manage, still refused outright:
--
--   select public.set_member_role('<anyone>', 'field');
--   -- ERROR: Admin access required
-- ─────────────────────────────────────────────────────────────────────────────
