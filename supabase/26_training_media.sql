-- Phase 13 - let an admin upload training media from inside the app.
--
-- Run after 25. Idempotent.
--
-- WHY
--
-- The training library was a build artefact: a file dropped in public/ and an entry
-- added to src/data/trainingVideos.js, which means a developer, a commit and a deploy
-- for every clip. That is the right shape for Steadwerk's own product tour, which ships
-- with the app and is the same for every tenant. It is the wrong shape for "here is how
-- WE tarp a roof", which is per-company, changes often, and should not need an engineer.
--
-- This adds the runtime half. The bundled clips stay in the build and stay uneditable.
--
-- WHY A SEPARATE BUCKET
--
-- 05_storage.sql scopes five photo buckets by a <company_id>/ path prefix and lets any
-- member write to them. Training media does not want that second half: uploading a video
-- everyone in the company sees on login is an admin act, not a warehouse one. A separate
-- bucket gets its own policies without loosening or complicating the photo ones.
--
-- WHY public: true
--
-- Same reason as the photo buckets: the <video> and <img> tags render from the public CDN
-- URL, which does not carry the user's JWT. The select policy below still governs
-- authenticated reads and list(), so it stops cross-tenant enumeration; it cannot stop
-- someone who already has the exact URL. Do not put anything confidential here.
--
-- NOTE: the app CSP had no media-src at all, so it fell back to default-src 'self' and
-- blocked video from any origin but the app's own. public/_headers now names this
-- project's storage origin under media-src. Without that change, uploads succeed and
-- nothing plays.

begin;

-- ── Bucket ───────────────────────────────────────────────────────────────────
-- file_size_limit is bytes and mirrors MAX_VIDEO_BYTES in src/utils/trainingMedia.js.
-- The Supabase plan also applies a global upload ceiling which may be LOWER than this;
-- when it is, the plan wins and the client shows the API error.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-media',
  'training-media',
  true,
  104857600, -- 100 MB
  array['video/mp4','video/webm','image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── Storage policies ─────────────────────────────────────────────────────────
-- Read: any member of the owning company. Write: that company's admins only.
drop policy if exists training_media_select on storage.objects;
create policy training_media_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'training-media'
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

drop policy if exists training_media_insert on storage.objects;
create policy training_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'training-media'
    and (storage.foldername(name))[1] = public.active_company_id()::text
    and (public.active_role() = 'admin' or public.is_platform_admin())
  );

drop policy if exists training_media_update on storage.objects;
create policy training_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'training-media'
    and (storage.foldername(name))[1] = public.active_company_id()::text
    and (public.active_role() = 'admin' or public.is_platform_admin())
  )
  with check (
    bucket_id = 'training-media'
    and (storage.foldername(name))[1] = public.active_company_id()::text
    and (public.active_role() = 'admin' or public.is_platform_admin())
  );

drop policy if exists training_media_delete on storage.objects;
create policy training_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'training-media'
    and (storage.foldername(name))[1] = public.active_company_id()::text
    and (public.active_role() = 'admin' or public.is_platform_admin())
  );

-- ── Metadata table ───────────────────────────────────────────────────────────
create table if not exists public.training_media (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.active_company_id()
             references public.companies(id) on delete cascade,

  kind       text not null,
  title      text not null,
  blurb      text,

  -- Public CDN URL of the object in training-media. Kept rather than recomputed from
  -- the path so a bucket rename does not silently blank the whole library.
  url        text not null,
  -- Storage object path, so delete can remove the file as well as the row.
  object_path text,

  sort_order integer not null default 0,

  created_by      uuid,
  -- Denormalised for the same reason four other tables do it: a deleted account
  -- otherwise leaves an orphaned id and no way to say who added the clip.
  created_by_name text,
  created_at      timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_media_kind_chk') then
    alter table public.training_media
      add constraint training_media_kind_chk check (kind in ('video','photo'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'training_media_title_len') then
    alter table public.training_media
      add constraint training_media_title_len check (char_length(title) between 1 and 160);
  end if;
end $$;

create index if not exists training_media_company_idx
  on public.training_media (company_id, sort_order, created_at);

alter table public.training_media enable row level security;

-- Read: every member, because the whole point is that the crew watches these.
drop policy if exists training_media_row_select on public.training_media;
create policy training_media_row_select on public.training_media
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

-- Write: this company's admins, matching the storage policies above and the
-- role_permissions pattern in 02.
drop policy if exists training_media_row_write_admin on public.training_media;
create policy training_media_row_write_admin on public.training_media
  for all to authenticated
  using      ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin())
  with check ((company_id = public.active_company_id() and public.active_role() = 'admin')
              or public.is_platform_admin());

comment on table public.training_media is
  'Per-company training clips and photos uploaded by an admin at runtime. Steadwerk''s own '
  'product tour is NOT here - it ships in the build via src/data/trainingVideos.js and '
  'cannot be edited or removed by a tenant.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Expect the bucket to exist and the table to be empty on first run.
-- ─────────────────────────────────────────────────────────────────────────────
select id, public, file_size_limit from storage.buckets where id = 'training-media';
select count(*) as clips from public.training_media;
