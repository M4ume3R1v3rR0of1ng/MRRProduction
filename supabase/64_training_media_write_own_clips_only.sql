-- Phase 64 — a company's Admin edits and deletes only the clips their company added.
--
-- Run after 60. Idempotent.
--
-- WHY
--
-- 60 made every clip readable by every company and, on purpose, left 56's update and
-- delete policies alone. They read `company_id = active_company_id() or is_global`, and
-- 60 made every row global, so any company's Admin could rename or DELETE any clip in
-- the library — and a delete cascades into every company's assignments (48) and read
-- receipts (46) for it. 60's header called that out as a deferred decision. This is the
-- decision: the shared library is Steadwerk's to curate, and a company's Admin keeps
-- authority over what their own company uploaded and nothing else.
--
-- WHAT CHANGES
--
--   - UPDATE and DELETE: a platform admin, or a company Admin on a clip whose
--     company_id is their active company. The `or is_global` branch is gone. "Added by
--     the company" is company_id, the same value the byline shows and the storage
--     folder is keyed on, and insert already pins it to the uploader's own company.
--
-- WHAT DOES NOT CHANGE
--
--   - SELECT: still `true`, anon included. Every company still reads every clip.
--   - INSERT: platform admin, or a company Admin into their own company's name.
--   - The guard trigger from 60 (no hidden rows, no re-homing a clip).
--   - STORAGE policies. 45's folder-scoped write and 56's folder-scoped delete already
--     confine a company Admin to their own company's folder. 56's orphan branch (an
--     Admin may clear a file no row references any more) is kept: it reaches nothing
--     anyone can still watch.
--   - ASSIGNMENTS (48): a company's Admin still assigns ANY clip to their own crew. That
--     is their company's row, not a change to the clip.
--
-- CLIPS ALREADY IN THE LIBRARY
--
-- Each clip's company_id is the session it was uploaded from. Clips Steadwerk's Owner
-- uploaded carry Steadwerk's company id (or a tenant's, if they were visiting one), so a
-- tenant Admin keeps edit rights only on rows stamped with their own company. Look
-- before running if that matters:
--
--   select company_id, count(*) from public.training_media group by company_id;

begin;

drop policy if exists training_media_row_update on public.training_media;
create policy training_media_row_update on public.training_media
  for update to authenticated
  using (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and company_id = public.active_company_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and company_id = public.active_company_id()
    )
  );

drop policy if exists training_media_row_delete on public.training_media;
create policy training_media_row_delete on public.training_media
  for delete to authenticated
  using (
    public.is_platform_admin()
    or (
      public.active_role() = 'admin'
      and company_id = public.active_company_id()
    )
  );

comment on table public.training_media is
  'The training library: one library, and every company reads all of it, logged in or '
  'not (supabase/60). WHO MAY WRITE (supabase/64): a platform admin anywhere, and a '
  'company''s own Admin only for clips whose company_id is their company. Another '
  'company''s clips are read-only to them. A company''s Admin also ASSIGNS any clip to '
  'their own crew with their own due dates (48); that is their company''s row, not a '
  'change to the clip. Steadwerk''s bundled product tour is NOT here when it is used — '
  'it ships in the build via src/shared/data/trainingVideos.js.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. Update and delete no longer mention is_global:
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media'
--   order by policyname;
--
--   -- B. As a COMPANY ADMIN, a write to another company's clip is a silent no-op
--   --    under RLS, not an error — count rows affected:
--   --      update public.training_media set title = title
--   --      where company_id <> public.active_company_id();   -- expect 0 rows
--   --      delete from public.training_media
--   --      where company_id <> public.active_company_id();   -- expect 0 rows
--   --    and their own company's clips still update (>0 rows if they have any).
--
--   -- C. As a PLATFORM ADMIN, any clip still updates and deletes.
-- ─────────────────────────────────────────────────────────────────────────────
