-- Phase 48 — assign a training clip to specific people, with a due date and a
-- record of who actually watched it.
--
-- Run after 47. Idempotent.
--
-- WHY
--
-- 45 gave a company's own Admin a library to upload into, and 46 told the crew when
-- something new landed in it. Neither says "Luis, watch this one before Friday."
-- The library is a shelf: everything on it is equally optional, nothing is directed
-- at anybody, and an owner who needs the whole crew through a ladder-safety clip
-- has no way to do it from the app and no way to find out who complied.
--
-- WHAT THIS DOES
--
-- training_assignments: one row per (company, clip, person). An admin creates them,
-- the assignee marks their own watched, and the due date is optional — plenty of
-- assignments are "when you get a minute", and forcing a deadline onto those would
-- make every one of them look urgent.
--
--   due_on       null = no deadline. A date, not a timestamptz: "by Friday" is a
--                calendar day in the crew's own time zone, and the same
--                day-vs-instant distinction helpers.js documents for parseDay.
--   completed_at null = not watched yet. Set by the assignee themselves.
--
-- WHO CAN DO WHAT
--
-- Admins (that company's own, or a platform admin) create, re-date and withdraw
-- assignments and read every row in their company. Everyone else sees only their
-- own rows, and may change only completed_at on them. That last part is not left
-- to the UI: RLS decides which ROWS you can touch, and the guard trigger below
-- decides which COLUMNS, because a policy alone cannot stop an assignee from
-- PATCHing their own due_on a week later and calling themselves on time.
--
-- Two integrity rules also live in the trigger rather than in the client, for the
-- same reason migration 12 moved job permissions into the database:
--
--   1. You may only assign a clip the company can actually see — a global one, or
--      one of its own. Without this, an admin who learns another company's clip id
--      could assign it to their crew and hand them a 403 at play time.
--   2. You may only assign to someone with an active membership in that company.
--
-- PER-COMPANY, NOT PER-PERSON
--
-- Uniqueness is (company_id, media_id, user_id), not (media_id, user_id). Someone
-- who works at two companies — the case CompanySwitcher exists for — can be
-- assigned the same global clip by each of them, and watching it for one must not
-- silently tick it off for the other. Same reasoning as training_media_reads'
-- composite key in 46.

begin;

create table if not exists public.training_assignments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null default public.active_company_id()
                   references public.companies(id) on delete cascade,
  media_id         uuid not null references public.training_media(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,

  -- Optional deadline. See the header: a date, not an instant.
  due_on           date,

  assigned_by      uuid,
  -- Denormalised for the same reason training_media.created_by_name is: a deleted
  -- account otherwise leaves an orphaned id and no way to say who assigned it.
  assigned_by_name text,
  assigned_at      timestamptz not null default now(),

  completed_at     timestamptz,

  constraint training_assignments_unique unique (company_id, media_id, user_id)
);

-- "What is outstanding for me", the query every crew member's Training tab runs.
create index if not exists training_assignments_user_idx
  on public.training_assignments (company_id, user_id, completed_at);

-- "Who has watched this clip", the admin roster.
create index if not exists training_assignments_media_idx
  on public.training_assignments (company_id, media_id);

-- The nightly due/overdue sweep only ever looks at unfinished, dated rows.
create index if not exists training_assignments_due_idx
  on public.training_assignments (due_on)
  where completed_at is null and due_on is not null;

alter table public.training_assignments enable row level security;

-- ── Read ─────────────────────────────────────────────────────────────────────
-- Your own rows, or everything in the company if you administer it.
drop policy if exists training_assignments_select on public.training_assignments;
create policy training_assignments_select on public.training_assignments
  for select to authenticated
  using (
    public.is_platform_admin()
    or (
      company_id = public.active_company_id()
      and (user_id = auth.uid() or public.active_role() = 'admin')
    )
  );

-- ── Admin write ──────────────────────────────────────────────────────────────
-- Create, re-date and withdraw, within your own company only.
drop policy if exists training_assignments_admin_write on public.training_assignments;
create policy training_assignments_admin_write on public.training_assignments
  for all to authenticated
  using (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.active_role() = 'admin')
  )
  with check (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.active_role() = 'admin')
  );

-- ── Assignee marks their own watched ─────────────────────────────────────────
-- Rows only. The guard trigger is what limits this to completed_at.
drop policy if exists training_assignments_mark_own on public.training_assignments;
create policy training_assignments_mark_own on public.training_assignments
  for update to authenticated
  using      (company_id = public.active_company_id() and user_id = auth.uid())
  with check (company_id = public.active_company_id() and user_id = auth.uid());

-- ── Guard ────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default) on purpose: it has to see the CALLER's role and
-- active company, and a definer would evaluate as the owner and wave everything
-- through. verify-atomic-materials.mjs pins the same property on the materials
-- function for the same reason.
create or replace function public.training_assignment_guard()
returns trigger
language plpgsql
as $$
declare
  is_admin boolean := public.is_platform_admin()
    or (new.company_id = public.active_company_id() and public.active_role() = 'admin');
begin
  if tg_op = 'INSERT' then
    -- Rule 1: the clip has to be one this company can see.
    if not exists (
      select 1 from public.training_media tm
      where tm.id = new.media_id
        and (tm.is_global or tm.company_id = new.company_id)
    ) then
      raise exception
        'Cannot assign a training clip this company cannot see (media_id %)', new.media_id
        using errcode = 'check_violation';
    end if;

    -- Rule 2: the assignee has to actually be in the company.
    if not exists (
      select 1 from public.memberships m
      where m.user_id = new.user_id
        and m.company_id = new.company_id
        and m.active
    ) then
      raise exception
        'Cannot assign training to someone who is not an active member of this company'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- UPDATE. An admin may move anything; everyone else may move completed_at and
  -- nothing else, however the request was crafted.
  if is_admin then
    return new;
  end if;

  if new.id            is distinct from old.id
  or new.company_id    is distinct from old.company_id
  or new.media_id      is distinct from old.media_id
  or new.user_id       is distinct from old.user_id
  or new.due_on        is distinct from old.due_on
  or new.assigned_by   is distinct from old.assigned_by
  or new.assigned_by_name is distinct from old.assigned_by_name
  or new.assigned_at   is distinct from old.assigned_at then
    raise exception
      'Only completed_at may be changed on your own training assignment'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists training_assignment_guard_t on public.training_assignments;
create trigger training_assignment_guard_t
  before insert or update on public.training_assignments
  for each row execute function public.training_assignment_guard();

comment on table public.training_assignments is
  'A training clip directed at one person, with an optional due date and the time '
  'they marked it watched. Admins own every column; the assignee may only move '
  'completed_at, enforced by training_assignment_guard(). See supabase/48.';

comment on column public.training_assignments.due_on is
  'Optional deadline, as a calendar day rather than an instant. Null means "no '
  'deadline" — most assignments have none, and defaulting one would make every '
  'row look urgent.';

comment on column public.training_assignments.completed_at is
  'When the assignee marked it watched. Null = outstanding. Only the assignee '
  'themselves (or an admin) can set it.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select policyname, cmd, roles
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_assignments'
--   order by policyname;
--   -- Expect three: training_assignments_admin_write (ALL),
--   -- training_assignments_mark_own (UPDATE), training_assignments_select (SELECT).
--
--   select tgname, tgenabled from pg_trigger
--   where tgrelid = 'public.training_assignments'::regclass and not tgisinternal;
--   -- Expect training_assignment_guard_t, enabled ('O').
--
--   select prosecdef from pg_proc
--   where proname = 'training_assignment_guard' and pronamespace = 'public'::regnamespace;
--   -- Expect false. A security-definer guard would evaluate the OWNER's role and
--   -- let every assignee edit their own due date.
--
--   select count(*) from public.training_assignments;
--   -- Empty on first run; rows appear as admins start assigning.
--
--   -- Rule 1, from a company admin's session — expect check_violation, not a row:
--   --   insert into public.training_assignments (media_id, user_id)
--   --   values ('<some other company''s private clip>', auth.uid());
-- ─────────────────────────────────────────────────────────────────────────────
