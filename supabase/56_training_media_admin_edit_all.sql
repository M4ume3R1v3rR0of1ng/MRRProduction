-- Phase 56 — a company's own Admin may edit every clip they can see, Steadwerk's
-- global ones included.
--
-- Run after 45 (and after 46/48, which reference training_media but are untouched
-- here). Idempotent.
--
-- WHY
--
-- 45 gave a company Admin their own tier and stopped there: they could add, edit
-- and remove their company's private clips, and the global tier stayed
-- Owner-only. That left an Admin unable to fix a typo or a stale instruction in
-- the clip sitting at the TOP of their crew's training page — the one everybody
-- actually watches — and no way to take down a global clip that does not apply to
-- their shop.
--
-- So Edit and Remove now reach as far as Assign already did in 48: any clip the
-- company can see. A platform admin (Owner) is unchanged — unrestricted.
--
-- READ THIS BEFORE RUNNING IT
--
-- A global clip is ONE row shared by every tenant. After this file, an Admin at
-- any company can rename, re-describe or DELETE it, and the change lands for
-- every other company and on the logged-out /training page (44). That is the
-- change that was asked for, not an oversight — but it is the whole of the
-- blast radius, and it is wider than anything else an Admin can reach, so it is
-- written down here rather than left to be discovered. A delete also cascades:
-- every company's assignments for that clip (48) and read receipts (46) go with
-- it, so one Admin taking a global clip down clears another company's training
-- record of it.
--
-- If that is not wanted, this file is the only thing to revert: 45's policy is
-- reinstated verbatim at the bottom of this header.
--
-- WHAT STAYS SHUT
--
--   - Tier 1, the bundled clips in src/shared/data/trainingVideos.js, ships in
--     the build and is still beyond reach of anyone at runtime. Empty today.
--   - INSERT is unchanged from 45: a company Admin's upload is private to their
--     company. Only a platform admin can put a NEW clip in the global tier, so
--     "edit what Steadwerk published" does not become "publish to every tenant."
--   - is_global and company_id become immutable for a company Admin, enforced by
--     the guard trigger below. Without it, the widened UPDATE policy would let an
--     Admin flip their own private clip to is_global = true and broadcast it to
--     every company — a route to exactly the publish right the paragraph above
--     withholds.
--   - Another company's PRIVATE clips. Those were never selectable (45's read
--     policy) and are not writable here either: the new policies reach
--     `company_id = active_company_id() or is_global`, nothing else.
--
-- To revert to 45's narrower rule, drop the three policies and the trigger this
-- file creates and run:
--
--   create policy training_media_row_write on public.training_media
--     for all to authenticated
--     using      (public.is_platform_admin() or (company_id = public.active_company_id()
--                 and public.active_role() = 'admin' and not is_global))
--     with check (public.is_platform_admin() or (company_id = public.active_company_id()
--                 and public.active_role() = 'admin' and not is_global));

begin;

-- ── Table policies ──────────────────────────────────────────────────────────
-- 45's single FOR ALL policy splits into three, because insert no longer wants
-- the same reach as update and delete.
drop policy if exists training_media_row_write on public.training_media;

-- Insert: exactly 45's rule. Own company, own tier, never global.
drop policy if exists training_media_row_insert on public.training_media;
create policy training_media_row_insert on public.training_media
  for insert to authenticated
  with check (
    public.is_platform_admin()
    or (
      company_id = public.active_company_id()
      and public.active_role() = 'admin'
      and not is_global
    )
  );

-- Update: own company's clips OR any global one. The with-check mirrors the
-- using clause so a row cannot be edited OUT of reach (re-tagged to another
-- company, say); which columns may move is the guard trigger's job, not this
-- policy's — a with-check cannot see the old row.
drop policy if exists training_media_row_update on public.training_media;
create policy training_media_row_update on public.training_media
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and (company_id = public.active_company_id() or is_global)
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and (company_id = public.active_company_id() or is_global)
    )
  );

-- Delete: same reach as update.
drop policy if exists training_media_row_delete on public.training_media;
create policy training_media_row_delete on public.training_media
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and (company_id = public.active_company_id() or is_global)
    )
  );

-- ── Guard ───────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default) on purpose, for the same reason 48's
-- training_assignment_guard() is: it has to see the CALLER's role and active
-- company, and a definer would evaluate as the owner and wave everything
-- through.
--
-- RLS decides which ROWS an Admin may touch; this decides which COLUMNS, because
-- a policy alone cannot tell "fixed the title on a global clip" from "promoted my
-- own clip to global."
create or replace function public.training_media_global_guard()
returns trigger
language plpgsql
as $$
begin
  -- A platform admin owns every column, including moving a clip between tiers.
  if public.is_platform_admin() then
    return new;
  end if;

  if new.is_global is distinct from old.is_global then
    raise exception
      'Only Steadwerk can move a training clip in or out of the shared library'
      using errcode = 'insufficient_privilege';
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception
      'A training clip cannot be moved to another company'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists training_media_global_guard_t on public.training_media;
create trigger training_media_global_guard_t
  before update on public.training_media
  for each row execute function public.training_media_global_guard();

-- ── Storage policies ────────────────────────────────────────────────────────
-- Read and insert stay exactly as 45 left them. Update stays too: there is no
-- replace-the-file path in the UI — an edit moves title and blurb only — so
-- widening it would grant a reach nothing uses.
--
-- Delete is the one that has to give. Removing a clip deletes the row and then
-- the file behind it (TrainingView.removeMedia), and a global clip's file sits in
-- whichever company folder the Owner uploaded it from — never the Admin's own.
-- Under 45's folder-scoped rule that second step silently failed and left a
-- paid-for orphan in the bucket.
--
-- So an Admin may also delete an object in this bucket that NOTHING references.
-- Checked through a definer function, because the Admin cannot SELECT another
-- company's rows: asked as the caller, "is this file referenced?" would answer
-- "no" for a file still backing someone else's private clip and hand over the
-- right to delete it. The check is honest about rows it cannot see, which leaves
-- this branch reaching true orphans only — files whose row is already gone.
create or replace function public.training_media_object_referenced(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- object_path is the modern column; the url suffix is checked too because rows
  -- predating it (26) and 44's seeded tour carry only a url.
  select exists (
    select 1 from public.training_media m
    where m.object_path = object_name
       or m.url like '%' || object_name
  );
$$;

comment on function public.training_media_object_referenced(text) is
  'True when some training_media row still points at this storage object. Definer '
  'so it answers for rows the caller cannot select — the whole point of asking. '
  'Used by the training-media delete policy to let an admin clear a true orphan. '
  'See supabase/56.';

revoke all on function public.training_media_object_referenced(text) from public;
grant execute on function public.training_media_object_referenced(text) to authenticated;

drop policy if exists training_media_delete on storage.objects;
create policy training_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'training-media'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = public.active_company_id()::text
        and public.active_role() = 'admin'
      )
      -- The orphan branch: the row is already deleted, so this file is referenced
      -- by nothing and costs storage for nobody's benefit.
      or (
        public.active_role() = 'admin'
        and not public.training_media_object_referenced(name)
      )
    )
  );

comment on table public.training_media is
  'The training library. is_global = true rows (Steadwerk''s own) are visible to every '
  'company, logged in or not, and only a platform admin (Owner) may ADD one — but any '
  'company''s Admin may edit or remove one, which lands for every other company (56). '
  'is_global = false rows are private to company_id and only that company''s own Admin '
  '(or a platform admin) may add, edit or remove one. Moving a row between the two tiers '
  'is a platform admin''s right alone, held by training_media_global_guard(). Steadwerk''s '
  'bundled product tour is NOT here when it is used - it ships in the build via '
  'src/shared/data/trainingVideos.js and is never editable by anyone at runtime. See '
  'supabase/56.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. Three policies where 45 had one FOR ALL, and update/delete reach is_global:
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media'
--   order by policyname;
--   -- expect: _row_select (select), _row_insert (insert, 'not is_global'),
--   --         _row_update (update), _row_delete (delete), and NO _row_write.
--
--   -- B. The guard is installed and is SECURITY INVOKER (prosecdef = false):
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'training_media_global_guard';
--
--   select tgname, tgenabled from pg_trigger
--   where tgrelid = 'public.training_media'::regclass and not tgisinternal;
--
--   -- C. The orphan check IS a definer (prosecdef = true), unlike the guard:
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'training_media_object_referenced';
--
--   -- D. No orphans today (every bucket object still has a row). Run as a
--   --    platform admin; a long list here means earlier deletes left files behind:
--   select o.name
--   from storage.objects o
--   where o.bucket_id = 'training-media'
--     and not public.training_media_object_referenced(o.name);
--
--   -- E. As a company Admin (not a platform admin), in the SQL Editor with a
--   --    session for one, these should hold:
--   --      update public.training_media set title = title where is_global;        -- ok
--   --      update public.training_media set is_global = true where not is_global; -- 42501
-- ─────────────────────────────────────────────────────────────────────────────
