-- Phase 45 — let a company's own Admin manage their company's videos too.
--
-- Run after 44. Idempotent.
--
-- WHY
--
-- 42 and 44 built one shared, Steadwerk-only library: every company reads it
-- (logged-in or not, after 44), and only a platform admin (Owner) could add, edit
-- or remove a clip. That is right for Steadwerk's own product training, but it
-- took away something 26 originally built: a company's OWN admin uploading their
-- own crew's material ("here is how WE tarp a roof"), visible only to that
-- company.
--
-- Both are true at once now. The library has three tiers:
--
--   1. Bundled product tour   - ships in the build (src/shared/data/trainingVideos.js).
--                                Empty today - see that file. Nobody can touch this
--                                tier at runtime even if it is used again later.
--   2. Global clips           - is_global = true. Every company sees these, logged
--                                in or not (44). Only a platform admin (Owner) may
--                                add, edit or remove one.
--   3. Company-private clips  - is_global = false. Only that company sees them.
--                                Only that company's own Admin (or a platform admin)
--                                may add, edit or remove one - never another
--                                company's, and never a global one.
--
-- DATA NOTE
--
-- Every row already in public.training_media - including "The Full Tour", if 44's
-- seed insert already ran - predates this split and was created under "everyone
-- sees everything." Backfilled to is_global = true below, so nothing that was
-- visible to every company yesterday goes private today. New rows default to
-- is_global = false: a company admin's upload is private unless a platform admin
-- explicitly marks it otherwise, not global by accident.

begin;

alter table public.training_media
  add column if not exists is_global boolean not null default true;

alter table public.training_media
  alter column is_global set default false;

comment on column public.training_media.is_global is
  'true = every company sees this clip, logged in or not, and only a platform admin '
  '(Owner) may add, edit or remove it. false = visible only to company_id, managed by '
  'that company''s own Admin (or a platform admin). See supabase/45.';

-- ── Table policies ───────────────────────────────────────────────────────────
-- Read: unchanged in spirit from 44 - anon and authenticated both allowed - but now
-- actually filtered by tier. active_company_id() and is_platform_admin() both
-- resolve to null/false for an anonymous caller (no JWT), so an anon request is
-- naturally left with only "is_global" to match on - it can never see a private
-- company row, without needing a separate anon-only policy to say so.
drop policy if exists training_media_row_select on public.training_media;
create policy training_media_row_select on public.training_media
  for select to authenticated, anon
  using (
    is_global
    or company_id = public.active_company_id()
    or public.is_platform_admin()
  );

-- Write: a company's own Admin may add/edit/remove within their own company AND
-- may never touch is_global (with-check pins it false on anything they write) - or
-- a platform admin (Owner), unrestricted. This is what actually stops a company
-- admin from editing or deleting Steadwerk's global clips or another company's
-- private ones: RLS, not the UI hiding a button.
drop policy if exists training_media_row_write_admin on public.training_media;
drop policy if exists training_media_row_write_platform_admin on public.training_media;
drop policy if exists training_media_row_write on public.training_media;
create policy training_media_row_write on public.training_media
  for all to authenticated
  using (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.active_role() = 'admin' and not is_global)
  )
  with check (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.active_role() = 'admin' and not is_global)
  );

-- ── Storage policies ─────────────────────────────────────────────────────────
-- Read stays exactly as 44 left it (any authenticated or anon request) - see that
-- file's own note on why: the bucket is public:true, so this was never the real
-- access boundary. The table policy above is.
--
-- Write goes back to folder-scoped, like 26 originally had it: a company admin may
-- only write inside their own company's folder, and a platform admin may write
-- anywhere (their active company when uploading a global clip is not necessarily
-- Steadwerk's own row - see 32's note that is_platform_admin is a property of the
-- person, not of whichever tenant they are currently in).
drop policy if exists training_media_insert on storage.objects;
create policy training_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'training-media'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = public.active_company_id()::text
        and public.active_role() = 'admin'
      )
    )
  );

drop policy if exists training_media_update on storage.objects;
create policy training_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'training-media'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = public.active_company_id()::text
        and public.active_role() = 'admin'
      )
    )
  )
  with check (
    bucket_id = 'training-media'
    and (
      public.is_platform_admin()
      or (
        (storage.foldername(name))[1] = public.active_company_id()::text
        and public.active_role() = 'admin'
      )
    )
  );

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
    )
  );

comment on table public.training_media is
  'The training library. is_global = true rows (Steadwerk''s own) are visible to every '
  'company, logged in or not, and only a platform admin (Owner) may add, edit or remove '
  'one. is_global = false rows are private to company_id and that company''s own Admin '
  '(or a platform admin) may add, edit or remove one. Steadwerk''s bundled product tour '
  'is NOT here when it is used - it ships in the build via '
  'src/shared/data/trainingVideos.js and is never editable by anyone at runtime. See '
  'supabase/45.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media'
--   order by policyname;
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'storage' and tablename = 'objects' and policyname like 'training_media_%'
--   order by policyname;
--
--   -- Every pre-existing row should read true here (backfilled by the column default):
--   select count(*) filter (where is_global) as global_rows,
--          count(*) filter (where not is_global) as private_rows
--   from public.training_media;
-- ─────────────────────────────────────────────────────────────────────────────
