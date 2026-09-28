-- Phase 42 — training media becomes one shared library, Steadwerk-managed only.
--
-- Run after 41. Idempotent.
--
-- WHY
--
-- 26_training_media.sql gave every company its own training library: each
-- tenant's admins could upload and remove their own company's clips, visible
-- only inside that company. That is no longer the model. Training videos are
-- now a single shared library every company sees, and only Steadwerk (a
-- platform admin) can add or remove a clip. No tenant admin manages this
-- anymore — matches src/features/training/TrainingView.jsx and
-- src/features/training/trainingMedia.js, updated alongside this file.
--
-- This does not touch the bundled product-tour clips in
-- src/shared/data/trainingVideos.js — those already ship in the build and were
-- already uneditable by any tenant. This migration brings the *runtime*
-- library (public.training_media + the training-media bucket) in line with
-- the same rule.
--
-- DATA NOTE
--
-- Any row already in public.training_media before this runs was uploaded
-- under the old per-company model and was private to its company_id. Loosening
-- the select policy below makes every existing row visible to every company,
-- same as new ones. If a tenant uploaded something company-specific (not
-- meant for other tenants) before this migration, delete or re-home that row
-- by hand first:
--
--   select id, company_id, title, created_by_name, created_at
--   from public.training_media
--   order by created_at;

begin;

-- ── Storage policies ─────────────────────────────────────────────────────────
-- Read: any authenticated user, not just members of the uploading company —
-- the whole point now is that every company sees the same library.
drop policy if exists training_media_select on storage.objects;
create policy training_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'training-media');

-- Write: platform admins only. No company-folder check anymore — a platform
-- admin's active company is not necessarily Steadwerk's (see 32's note that
-- is_platform_admin is a property of the person, not the tenant they are
-- currently in), so scoping writes to a folder would be the wrong gate.
drop policy if exists training_media_insert on storage.objects;
create policy training_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'training-media' and public.is_platform_admin());

drop policy if exists training_media_update on storage.objects;
create policy training_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'training-media' and public.is_platform_admin())
  with check (bucket_id = 'training-media' and public.is_platform_admin());

drop policy if exists training_media_delete on storage.objects;
create policy training_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'training-media' and public.is_platform_admin());

-- ── Table policies ───────────────────────────────────────────────────────────
-- Read: every authenticated user, regardless of company. company_id stays on
-- the table (who uploaded it, for the "Added by" byline) but no longer scopes
-- visibility.
drop policy if exists training_media_row_select on public.training_media;
create policy training_media_row_select on public.training_media
  for select to authenticated
  using (true);

-- Write: platform admins only. Replaces the old company-admin-or-platform-admin
-- policy with platform-admin-only, and gets a clearer name since "_admin" used
-- to mean "this company's admin" and now means something narrower.
drop policy if exists training_media_row_write_admin on public.training_media;
drop policy if exists training_media_row_write_platform_admin on public.training_media;
create policy training_media_row_write_platform_admin on public.training_media
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

comment on table public.training_media is
  'The shared training library, visible to every company. Only a platform admin '
  '(Steadwerk) can add, edit or remove a row or its file - see supabase/42. Steadwerk''s '
  'bundled product tour is NOT here - it ships in the build via '
  'src/shared/data/trainingVideos.js and never was editable by anyone at runtime.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Policies should read as above:
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media'
--   order by policyname;
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'training_media_%'
--   order by policyname;
--
-- And check the data note above for any pre-existing row that should not be
-- shown to every company now that select is unscoped.
-- ─────────────────────────────────────────────────────────────────────────────
