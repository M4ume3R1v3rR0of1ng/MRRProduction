-- Phase 63 — two more permissions that the server had never heard of.
--
-- REQUIRED if you grant "Manage Users" or "System Settings" to a non-admin role.
-- Run after 03 (it replaces set_company_branding from there), after 13 (it calls
-- has_perm) and alongside 62. Idempotent: one policy swap and one
-- create-or-replace.
--
-- WHY
--
-- 62 fixed users_manage for the user-management writes. Auditing the rest of the
-- permission matrix afterwards turned up two more places where a toggle in
-- Settings granted nothing, both the same shape as the bug 62 closed: the UI
-- opens on the permission, the server tests for the literal role 'admin'.
--
-- ── 1. THE AUDIT LOG READ ──
--
-- /logs and the sidebar's Audit Logs link are both gated on users_manage
-- (App.jsx, Sidebar.jsx), but audit_select_admin from 02 restricted the SELECT to
-- active_role() = 'admin'. The failure mode here is nastier than a 403: RLS
-- filters rows, it does not raise. So a users_manage holder reached the screen and
-- saw an EMPTY LIST — which reads as "nothing has ever happened in this company"
-- rather than "you cannot see this". Silent and wrong beats loud and wrong, and
-- this was the silent kind.
--
-- Widened to match the nav that offers it. Whoever manages users is precisely who
-- needs to see who changed whose role and who removed whom, and the log is
-- read-only and company-scoped: no write path changes. INSERT still belongs to
-- any member (audit_insert_member), and there is still no UPDATE or DELETE policy
-- at all, so the log stays append-only for everyone.
--
-- ── 2. COMPANY BRANDING ──
--
-- settings_manage opens the Settings route, where four of the six tabs wrote
-- through paths that demanded admin. This file hands over the one that is
-- genuinely company-config rather than company-security: branding — display name,
-- tagline, colors, logo, the sales-tax label and rate that every PDF reads.
--
-- WHAT IS DELIBERATELY LEFT ADMIN-ONLY, AND WHY
--
--   * set_company_integration() (03, redefined in 04) — the AccuLynx API key.
--     A credential for a system holding the company's whole job history. Someone
--     who may rename the company has no business rotating that.
--
--   * role_permissions and user_permission_overrides (RLS in 02) — the permission
--     matrix itself. This is the escalation that makes the rest moot: anyone who
--     can edit the matrix can grant themselves every other permission, including
--     the two above. The matrix stays with the admins, exactly as 62 reasoned
--     about overrides.
--
-- SettingsView hides both of those tabs from a non-admin rather than showing them
-- and letting the save fail, which is the state this whole pair of migrations
-- exists to stop happening.
--
-- NOT TOUCHED, because they already work: the Automations tab and the job
-- templates write to `settings`, and Warehouses writes to `warehouses` — both
-- carry company-scoped tenant_all policies from 02 that any member satisfies.
--
-- LEDGER
--
-- Add to 33's do-block and re-run that file:
--
--   perform public._mig_record('63_delegated_reads_and_branding.sql',
--     public._mig_has_policy('audit_select_member_manager', 'audit_logs'),
--     'policy audit_select_member_manager');

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The audit log is readable by admins AND by whoever holds users_manage.
--
-- Replaced under a new name, because the old one said 'admin' and would now be
-- lying about what it does. 33's probe keys off the new name, so a database still
-- carrying audit_select_admin reads as 'missing' — which is correct: it is.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists audit_select_admin on public.audit_logs;
drop policy if exists audit_select_member_manager on public.audit_logs;

create policy audit_select_member_manager on public.audit_logs
  for select to authenticated
  using (
    (company_id = public.active_company_id()
      and (public.active_role() = 'admin' or public.has_perm('users_manage')))
    or public.is_platform_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Branding accepts settings_manage.
--
-- Unchanged from 03 apart from the authorization line. has_perm() already returns
-- true for every key when active_role() is 'admin', so the admin branch is kept
-- explicit only to mirror how 62 reads — and so that a company that has somehow
-- set settings_manage to false for the admin role still cannot lock its own
-- admins out of their branding.
-- ─────────────────────────────────────────────────────────────────────────────
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
  if public.active_role() <> 'admin'
     and not public.is_platform_admin()
     and not public.has_perm('settings_manage') then
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

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- As a non-admin holding users_manage, this returns rows rather than nothing:
--
--   select count(*) from public.audit_logs;
--
-- As a non-admin holding neither users_manage nor admin, it returns 0 — the same
-- filtering as before, just with the right people let in:
--
--   select count(*) from public.audit_logs;
--
-- As a non-admin holding settings_manage, the first succeeds and the second is
-- still refused:
--
--   select public.set_company_branding('{"tagline": "test"}');
--   select public.set_company_integration('acculynx', '"x"');
--   -- ERROR: Admin access required
--
-- And the matrix stays shut (RLS, so this reports 0 rows updated, not an error):
--
--   update public.role_permissions set permissions = permissions where true;
-- ─────────────────────────────────────────────────────────────────────────────
