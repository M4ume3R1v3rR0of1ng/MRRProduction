-- Phase 60 — one training library, and every company reads all of it.
--
-- Run after 56. Idempotent.
--
-- WHY
--
-- Reported from the field: "all training videos are being logged only to MRR."
--
-- 45 made is_global default to FALSE, so every clip uploaded since landed as a
-- private clip belonging to one company — Steadwerk's own included, because the
-- Owner works from inside a tenant and company_id comes off that session's
-- default. The library the Owner thought they were publishing to every customer
-- was visible to exactly one of them, and a company signing up tomorrow would
-- see an empty page.
--
-- This file fixes VISIBILITY and nothing else. Every clip, uploaded already or
-- uploaded in a year, is readable by every company. The per-company private tier
-- is gone, because that is the thing that was hiding them.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- It does not change who may add, edit or remove a clip. 56's reach stands: a
-- platform admin anywhere, and a company's own Admin for any clip their company
-- can see. That question is being decided separately and on purpose.
--
-- But read the next section before running this, because leaving that question
-- open is not the same as leaving it unchanged.
--
-- READ THIS BEFORE RUNNING IT
--
--   1. THE BACKFILL PUBLISHES EVERY ROW TO EVERY COMPANY. If some tenant
--      genuinely uploaded something of their own under 45's private tier ("here
--      is how WE tarp a roof"), this makes it readable by every other tenant and
--      by anyone who opens the logged-out training page. Look first:
--
--        select id, company_id, is_global, title, created_by_name, created_at
--        from public.training_media
--        where not is_global
--        order by created_at;
--
--      An empty result means there is nothing to think about. Otherwise delete
--      or re-home those rows first — after this file there is no private tier to
--      leave them in.
--
--   2. 56'S EDIT AND DELETE REACH WIDENS ON ITS OWN, without a line of its text
--      changing. It reads `company_id = active_company_id() or is_global`. Every
--      row is now global, so that clause is now true for every row: ANY
--      company's Admin can rename or DELETE ANY clip, and it lands for every
--      other company and on the logged-out page. A delete cascades too — every
--      company's assignments (48) and read receipts (46) for that clip go with
--      it, so one Admin tidying up clears another company's training record.
--
--      56's own header called that blast radius out when it was limited to
--      Steadwerk's clips. It is now the whole library. The fix is to make writes
--      platform-admin only; that is the deferred decision, and this note is here
--      so it is deferred knowingly rather than by accident.
--
-- WHAT CHANGES
--
--   - Every existing row is published, and the column default goes back to true.
--     This is the fix: clips currently readable inside one company become
--     readable everywhere.
--   - Select loses its tier filter. 45 filtered on is_global; with one tier there
--     is nothing to filter, and "unfiltered" is the property being asked for — a
--     company that signs up tomorrow sees the whole library on its first login,
--     with no backfill and nothing to configure.
--   - Insert loses `not is_global`, and ONLY that. 56 used it to pin a company
--     Admin's upload into the private tier; with the tier gone it would simply
--     stop a company Admin uploading at all, since the guard below refuses the
--     hidden row the policy would be demanding. Who may insert is unchanged:
--     platform admin, or a company Admin into their own company's name.
--   - 56's guard stops policing which tier a clip sits in and starts holding the
--     one invariant worth holding: a clip can never be made invisible.
--
-- WHAT DOES NOT CHANGE
--
--   - UPDATE and DELETE policies. Not dropped, not recreated — see point 2 above
--     for what that means in practice.
--   - ALL FOUR STORAGE POLICIES, including 45's folder-scoped write (a company
--     Admin writes only inside their own folder, which mediaObjectPath still
--     honours) and 56's orphan-delete branch.
--   - ASSIGNMENTS. A company's Admin points clips at their own crew with their
--     own due dates (48). That was always their company's row rather than a
--     change to the clip. Nothing here touches 48 or 49.
--   - The bundled tier in src/shared/data/trainingVideos.js, which ships in the
--     build and was never writable by anyone at runtime. Empty today.
--   - company_id stays on the table. It is the "Added by" byline and a record of
--     which session uploaded the file, not a visibility gate any more.
--
-- LEDGER
--
-- Probed in 33 by the column DEFAULT, not by a policy or a function: 60 reuses
-- 45's column and 56's function name and replaces same-named policies, so
-- existence proves nothing. is_global defaults to false under 45 and true under
-- 60, which is the one difference that distinguishes the two states cheaply.
-- Same trap as 11/13, 38, 50 and 57.

begin;

-- ── 56's trigger comes off FIRST, before the backfill ───────────────────────
-- Not housekeeping — the backfill below cannot run while it is attached. 56's
-- guard refuses any change to is_global unless is_platform_admin() returns true,
-- and that function reads auth.uid(), which is NULL in the SQL editor. So the
-- update raises 42501 'Only Steadwerk can move a training clip in or out of the
-- shared library' and takes the whole file down with it. The new guard is created
-- further down and is attached again at the end.
--
-- Safe because it is all one transaction: the table is never actually unguarded
-- for anyone else, and a failure anywhere rolls the trigger back into place.
drop trigger if exists training_media_global_guard_t on public.training_media;

-- ── Publish everything, and keep it that way by default ─────────────────────
-- 45 flipped this default to false after backfilling the then-existing rows to
-- true. That is the line that made every upload since private to one tenant.
update public.training_media set is_global = true where not is_global;

alter table public.training_media
  alter column is_global set default true;

comment on column public.training_media.is_global is
  'Always true from supabase/60 onward, held there by training_media_global_guard(). '
  'The per-company private tier 45 introduced is gone: there is one library and every '
  'company reads all of it. The column is kept because the logged-out training page and '
  'the ledger probe in 33 both read it, and because a false row would be invisible to '
  'every tenant — which is the state the guard exists to refuse.';

-- ── Read ────────────────────────────────────────────────────────────────────
-- anon as well as authenticated, unchanged from 44/45; restated because 45's
-- tier filter has to come out of it.
drop policy if exists training_media_row_select on public.training_media;
create policy training_media_row_select on public.training_media
  for select to authenticated, anon
  using (true);

-- ── Insert ──────────────────────────────────────────────────────────────────
-- 56's policy with `and not is_global` removed from the company-Admin branch,
-- and nothing else touched. That clause put their upload in the private tier; the
-- guard below now refuses a hidden row, so leaving it would make the policy and
-- the trigger demand opposite things and a company Admin's upload would fail.
--
-- company_id is still pinned to their own company: it keeps the "Added by" byline
-- honest and keeps the storage folder they are allowed to write to matching the
-- row they are writing.
drop policy if exists training_media_row_write on public.training_media;
drop policy if exists training_media_row_insert on public.training_media;
create policy training_media_row_insert on public.training_media
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      company_id = public.active_company_id()
      and public.active_role() = 'admin'
    )
  );

-- ── Update and delete: left exactly as 56 wrote them ────────────────────────
-- Not dropped and not recreated, deliberately. Their text still says
-- `company_id = active_company_id() or is_global`, and every row being global is
-- what makes that reach the whole library — see point 2 of the header. Changing
-- it is the deferred decision, not this file's job.

-- ── Guard ───────────────────────────────────────────────────────────────────
-- Same division of labour 56 wrote down: RLS decides which ROWS, the trigger
-- decides which COLUMNS. What it decides has changed.
--
-- 56 used it to stop a company Admin promoting their own private clip into the
-- shared tier. There is no private tier to promote out of, so that job is gone.
-- The job worth doing now is the opposite one, and it binds EVERYONE including a
-- platform admin: is_global = false is no longer a tier, it is just a row no
-- tenant can see — the bug this file exists to fix — so it is refused at the door
-- rather than left to be noticed weeks later by the one person who can still see
-- it. That check runs BEFORE the platform-admin branch on purpose; 56's returned
-- early for an Owner, and an Owner is exactly who hid the library last time.
--
-- 56's is_global-immutability check is dropped rather than kept: both old and new
-- are now always true, so `is distinct from` could never fire again.
--
-- SECURITY INVOKER (the default), unchanged from 56: it has to answer for the
-- caller, and a definer would evaluate as the owner and wave everything through.
create or replace function public.training_media_global_guard()
returns trigger
language plpgsql
as $$
begin
  if not coalesce(new.is_global, false) then
    raise exception
      'A training clip cannot be hidden from companies. There is one shared library: is_global must stay true.'
      using errcode = 'insufficient_privilege',
            hint = 'Delete the clip if it should not be published. There is no '
                || 'per-company tier to hide it in — see supabase/60.';
  end if;

  -- 56's other column lock, kept: a company Admin may not re-home a clip to
  -- another company. Nothing to compare against on INSERT, and a platform admin
  -- owns every column.
  if tg_op = 'UPDATE'
     and not public.is_platform_admin()
     and new.company_id is distinct from old.company_id
  then
    raise exception
      'A training clip cannot be moved to another company'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function public.training_media_global_guard() is
  'Refuses any training_media row with is_global = false, on insert or update, for '
  'every caller including a platform admin: there is one shared library (supabase/60), '
  'so a false row is not a private clip, it is a clip nobody can see. Also keeps 56''s '
  'rule that a company Admin cannot re-home a clip to another company. Replaces 56''s '
  'version, which policed which tier a clip sat in.';

-- Attached again now that the backfill is done (it came off at the top of this
-- file — see the note there). INSERT as well as UPDATE this time: 56 only needed
-- to watch edits, because its insert policy already pinned the column. The policy
-- above no longer does.
create trigger training_media_global_guard_t
  before insert or update on public.training_media
  for each row execute function public.training_media_global_guard();

comment on table public.training_media is
  'The training library: one library, and every company reads all of it, logged in or '
  'not (supabase/60, which removed the per-company private tier 45 introduced — that '
  'tier is why uploads were landing visible to one company only). WHO MAY WRITE IS '
  'STILL 56''S RULE and is wider than it looks: a platform admin anywhere, and a '
  'company''s own Admin for any clip their company can see — which is now every clip, '
  'so any company''s Admin can edit or delete one and it lands for all of them. See '
  'point 2 of 60''s header. A company''s Admin also ASSIGNS clips to their own crew with '
  'their own due dates (48); that is their company''s row, not a change to the clip. '
  'Steadwerk''s bundled product tour is NOT here when it is used — it ships in the '
  'build via src/shared/data/trainingVideos.js and is never editable at runtime.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. Nothing is hidden from anyone, and new rows default to published:
--   select count(*) filter (where is_global)     as published,
--          count(*) filter (where not is_global) as hidden   -- expect 0
--   from public.training_media;
--
--   select column_default      -- expect 'true'
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'training_media'
--     and column_name = 'is_global';
--
--   -- B. Four table policies. _row_select is now `true`; _row_insert no longer
--   --    mentions is_global; _row_update and _row_delete are still 56's text,
--   --    word for word; no _row_write survives from 45:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media'
--   order by policyname;
--
--   -- C. The four storage policies are untouched by this file — 45's
--   --    folder-scoped insert/update and 56's orphan-delete branch all intact:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like 'training_media_%'
--   order by policyname;
--
--   -- D. The guard fires on INSERT as well as UPDATE (56's fired on update only).
--   --    tgtype bit 2 (value 4) is INSERT, bit 4 (value 16) is UPDATE:
--   select tgname, (tgtype & 4) > 0 as on_insert, (tgtype & 16) > 0 as on_update
--   from pg_trigger
--   where tgrelid = 'public.training_media'::regclass and not tgisinternal;
--
--   -- E. Hiding a clip is refused, for a platform admin too (run and roll back):
--   --   begin;
--   --     update public.training_media set is_global = false where is_global;
--   --     -- expect: 42501, 'A training clip cannot be hidden from companies…'
--   --   rollback;
--
--   -- F. As a COMPANY ADMIN (not a platform admin), with a session for one:
--   --      select count(*) from public.training_media;     -- the whole library
--   --      insert ... (their own company_id)               -- allowed, lands global
--   --      update public.training_media set title = title; -- allowed for EVERY row,
--   --                                                      -- which is point 2
--   --    A refused write under RLS is a silent no-op, not an error: count the rows
--   --    affected rather than waiting for an exception.
--
--   -- G. Orphaned bucket objects, using 56's function (platform admin):
--   select o.name
--   from storage.objects o
--   where o.bucket_id = 'training-media'
--     and not public.training_media_object_referenced(o.name);
-- ─────────────────────────────────────────────────────────────────────────────
