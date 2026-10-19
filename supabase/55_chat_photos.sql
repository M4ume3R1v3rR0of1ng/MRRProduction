-- Phase 55 — let a photo sent to A.N.V.I.L. survive the reload.
--
-- Run after 54. Idempotent.
--
-- THE PROBLEM
--
-- ChatWidget has been able to attach a photo since the assistant could see
-- one: compressImg turns the file into a base64 string, sendFrom puts it in
-- the request, and chat.js forwards it to the model as an image block. That
-- half works.
--
-- What never worked is the half after. chat.js persists the user's turn as the
-- literal string "[Photo attached]" (see persistTurn's extractText fallback),
-- because a base64 JPEG has no business in a text column — a handful of them
-- would be megabytes of row data on a table ChatWidget selects 50 rows from on
-- every mount. So the photo existed only in React state: present until the
-- tab reloaded, then replaced in the history by a placeholder describing a
-- photo nobody can see any more.
--
-- That is worse than it sounds for the thing this feature is actually for. A
-- driver photographs a cracked mirror, asks "can you file this?", reloads, and
-- the conversation now reads as though they attached nothing.
--
-- WHAT THIS DOES
--
-- Two halves, and they have to ship together:
--
--   • here: a photo_url column on chat_messages, and a chat-photos bucket
--     scoped the same way as every other bucket in this app.
--   • ChatWidget: upload the compressed image to that bucket first, send the
--     resulting public URL alongside the base64, and render photo_url when
--     replaying history.
--
-- WHY A URL AND NOT THE IMAGE
--
-- Same reason the other five buckets exist. The row stays small, the CDN
-- serves the image straight into an <img src>, and a 50-row history fetch
-- stays a 50-row history fetch. The model still receives the base64 on the
-- turn the photo is sent — that path is untouched, deliberately, so this
-- change cannot alter what the assistant sees or says.
--
-- WHY THE BUCKET IS PUBLIC, LIKE THE OTHERS
--
-- Public reads with tenant-scoped writes is the choice 05_storage.sql already
-- made and explains: the CDN serves a URL to anyone holding it, which keeps
-- <img src> plumbing-free, while the policies below stop one company from
-- LISTING another's files and discovering those URLs in the first place.
--
-- WHY THE POLICIES ARE DROPPED AND REBUILT
--
-- 05_storage.sql keyed its four policies on an inline list of five bucket
-- names, for legibility. A sixth bucket means that list changes, and a USING
-- clause cannot be amended in place — so the set is recreated whole, exactly
-- as 05 did, rather than adding a second permissive policy per command. Two
-- policies OR-ing together is the trap 05's own header warns about.

begin;

-- ── The column ───────────────────────────────────────────────────────────────
-- Nullable: almost every row has no photo, and a message whose photo failed to
-- upload is still a message worth keeping (see ChatWidget's degrade path).
alter table public.chat_messages
  add column if not exists photo_url text;

-- ── The bucket ───────────────────────────────────────────────────────────────
-- Created here rather than by hand in the dashboard so a fresh environment
-- comes up complete. public = true matches the other five.
insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', true)
on conflict (id) do nothing;

-- ── Rescope every bucket policy to include it ────────────────────────────────
drop policy if exists tenant_objects_select on storage.objects;
create policy tenant_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments','chat-photos')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

drop policy if exists tenant_objects_insert on storage.objects;
create policy tenant_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments','chat-photos')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

drop policy if exists tenant_objects_update on storage.objects;
create policy tenant_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments','chat-photos')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  )
  with check (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments','chat-photos')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

drop policy if exists tenant_objects_delete on storage.objects;
create policy tenant_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('vehicle-photos','inventory-photos','job-attachments','vehicle-attachments','inventory-attachments','chat-photos')
    and (storage.foldername(name))[1] = public.active_company_id()::text
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The column is there and nullable:
--
--   select column_name, is_nullable from information_schema.columns
--   where table_name = 'chat_messages' and column_name = 'photo_url';
--
--   Expect one row, is_nullable = YES.
--
-- 2. The bucket exists and is public:
--
--   select id, public from storage.buckets where id = 'chat-photos';
--
--   Expect one row, public = true.
--
-- 3. Still exactly four policies on storage.objects, each naming six buckets:
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects';
--
--   Expect tenant_objects_select / _insert / _update / _delete and nothing
--   else. A fifth policy means an earlier migration's set survived and is
--   OR-ing with this one.
--
-- 4. As an authenticated user, confirm a write outside your own folder fails:
--
--   insert into storage.objects (bucket_id, name) values ('chat-photos', 'nope/x.jpg');
--
--   Expect it to be refused by tenant_objects_insert.
--
-- 5. chat_messages is still browser-read-only (41's guarantee, unchanged):
--
--   select policyname, cmd from pg_policies where tablename = 'chat_messages';
--
--   Expect chat_messages_owner_read (SELECT) and chat_messages_owner_delete
--   (DELETE) only — adding a column must not have added a write path.
