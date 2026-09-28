-- Phase 46 — an unread badge on the sidebar's Training tab.
--
-- Run after 45. Idempotent.
--
-- WHY
--
-- Nothing told anyone a clip had been added. An admin (company or platform) could
-- upload a new video and every other member of that library's audience — the whole
-- company for a private clip, every company for a global one — had no way to find
-- out short of opening Training and checking. The sidebar already does this pattern
-- for chat (team_chat_reads, see 02) and this is the same shape: one row per
-- (company, user) recording when THEY last looked, compared against the newest
-- training_media row THEY can see.
--
-- WHAT THIS DOES
--
-- training_media_reads: one row per company member, holding when they last opened
-- Training. useAppData.js computes the sidebar badge as the count of training_media
-- rows newer than that timestamp and not created by the viewer themselves (mirroring
-- team_chat_reads excluding your own messages) — added by anyone, then subtracted
-- back to zero and re-stamped the moment they navigate to /training.
--
-- Composite PK (company_id, user_id), same as team_chat_reads: a platform admin
-- reading a customer's private library while visiting their tenant and reading
-- Steadwerk's own global library from home get two independent rows, not one that
-- fights over which company they most recently checked in.

begin;

create table if not exists public.training_media_reads (
  company_id    uuid not null default public.active_company_id()
                references public.companies(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table public.training_media_reads enable row level security;

-- Same shape as chat_reads_own in 02: a member may only ever read or write their
-- own row, in whichever company is currently active.
drop policy if exists training_media_reads_own on public.training_media_reads;
create policy training_media_reads_own on public.training_media_reads
  for all to authenticated
  using      (company_id = public.active_company_id() and user_id = auth.uid())
  with check (company_id = public.active_company_id() and user_id = auth.uid());

comment on table public.training_media_reads is
  'When each member last opened Training, one row per (company, user). Drives the '
  'sidebar''s unread badge: any training_media row newer than this, not authored by '
  'the viewer, counts as unread. See supabase/46.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media_reads'
--   order by policyname;
--
--   -- Expect exactly one ALL policy, training_media_reads_own.
--
--   select count(*) from public.training_media_reads;
--   -- Empty on first run — every member gets a row the first time useAppData's
--   -- effect runs for them, stamped "now" so the whole pre-existing library
--   -- doesn't show as unread on day one.
-- ─────────────────────────────────────────────────────────────────────────────
