-- Phase 10 — a deactivated employee keeps their name in your records.
--
-- Run after 20. Idempotent.
--
-- THE BUG
--
-- profiles_select_same_company (02) admits a row when:
--
--   id = auth.uid() or shares_active_company(id) or is_platform_admin()
--
-- and shares_active_company requires `m.active`. So the moment someone is
-- deactivated, their profile row stops being readable by everyone they worked
-- with. useAppData asks for every membership in the company (it does NOT filter
-- on active) and then fetches those profiles — RLS quietly drops the deactivated
-- ones from the result, no error, just fewer rows than were asked for.
--
-- The consequences are all silent:
--
--   * Every inventory batch that person ever received renders with no name. The
--     batch ledger is the only durable record of who took delivery of what, and
--     it goes anonymous the day someone leaves — which is precisely when you are
--     most likely to be reading it.
--   * UserManagementView already draws an "Inactive" badge and greys the row. That
--     branch is unreachable today, so an admin cannot SEE a deactivated employee,
--     and therefore cannot reactivate one.
--   * Job assignment history, maintenance requests, and chat mentions lose the
--     same names for the same reason.
--
-- WHY LOOSENING THIS IS SAFE
--
-- Deactivation is an ACCESS control: it must stop that person signing in and
-- touching data. It is not a redaction of their name from their former
-- colleagues' own history. Their name is already written into rows those
-- colleagues can read; hiding the profile does not un-write it, it only replaces
-- a name with a UUID.
--
-- The tenant boundary is untouched. Membership in the active company is still
-- required, so this reveals nothing across companies. The only thing that changes
-- is that `active` no longer gates READING a name.
--
-- WHY A SEPARATE FUNCTION AND NOT AN EDIT TO shares_active_company
--
-- That function also backs profiles_update_company_admin and would silently widen
-- who an admin may EDIT. Reading a former colleague's name and editing their
-- profile are different permissions, so they get different predicates. The update
-- policy keeps requiring an active membership.

begin;

-- Same as shares_active_company, without the `active` requirement. Read-only use
-- only: see the note above before reaching for this in a write policy.
create or replace function public.shares_company_any_status(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id    = target_user
      and m.company_id = public.active_company_id()
  );
$$;

drop policy if exists profiles_select_same_company on public.profiles;
create policy profiles_select_same_company on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_company_any_status(id)
    or public.is_platform_admin()
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Run as a signed-in member. Every membership in your active company should now
-- come back with a profile attached. A NULL in full_name is a blank profile; a
-- MISSING row would mean the policy is still filtering, which is the bug.
-- ─────────────────────────────────────────────────────────────────────────────
select m.user_id,
       m.active as membership_active,
       p.full_name,
       p.email,
       case when p.id is null then 'HIDDEN BY RLS' else 'readable' end as visibility
from public.memberships m
left join public.profiles p on p.id = m.user_id
where m.company_id = public.active_company_id()
order by m.active desc, p.full_name;
