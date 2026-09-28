-- Phase 1e — tenant-scope the storage buckets.
--
-- Before this, all five photo buckets had policies that only checked bucket_id, so
-- any authenticated user could upload into, overwrite, delete, or list any file in
-- any bucket — across companies. Files were also stored at flat paths (veh123_ts.jpg)
-- with no company prefix, so there was nothing to scope by.
--
-- The fix has two halves that must ship together:
--   • this migration: policies keyed on the first path segment = the caller's company
--   • storageBucketUpload.js: uploads now write to  <company_id>/<file>  paths
--
-- Reads stay public: the buckets remain public: true, so the CDN still serves a photo
-- URL to anyone who has it (that was the deliberate choice — it keeps <img src> simple
-- and needs no signed-URL plumbing). What these policies additionally stop is
-- ENUMERATION: a company can no longer LIST another company's files via the API to
-- discover their paths.
--
-- Existing flat-path files keep serving over their public URLs untouched; they simply
-- can't be listed or overwritten by anyone (their path has no company folder, so it
-- matches no policy). New uploads land in the scoped path and update the row's URL.

begin;

-- ── Clean slate ──────────────────────────────────────────────────────────────
-- Every existing policy on storage.objects is app-created for these five buckets.
-- Drop them all and recreate a coherent scoped set, so nothing permissive lingers
-- (the same OR-ing trap that bit the table policies applies here too).
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- Our buckets. Kept as an inline list rather than a lookup so the policy is legible.
-- vehicle-photos / inventory-photos / job-attachments are the live ones;
-- vehicle-attachments / inventory-attachments are pre-existing and scoped for safety.

-- ── LIST / read-through the API: own company only ────────────────────────────
-- This governs storage.from(bucket).list() and authenticated object reads. It does
-- NOT govern the public CDN URL (public buckets serve those without RLS), so images
-- still render. Its job is purely to stop cross-tenant enumeration.
create policy tenant_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

-- ── INSERT: may only write into your own company's folder ────────────────────
create policy tenant_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

-- ── UPDATE (upsert overwrite): same scope on both the old and new row ─────────
create policy tenant_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  )
  with check (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

-- ── DELETE: only your own company's files ────────────────────────────────────
create policy tenant_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

commit;
