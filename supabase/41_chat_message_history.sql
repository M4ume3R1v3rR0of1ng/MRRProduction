-- Phase 41 — give the Steadwerk Assistant a memory.
--
-- Run after 40. Idempotent.
--
-- THE PROBLEM
--
-- ChatWidget.jsx has only ever kept its conversation in a local useState —
-- gone on refresh, gone on navigating away and back if the component
-- unmounts, gone across devices. The oil-due reminder added in 39/40 made
-- that sharper: a driver who reloads before opening the chat loses the
-- assistant's note entirely, with nothing left but the toast they may have
-- already dismissed.
--
-- WHAT THIS DOES
--
-- One table, chat_messages, holding every turn of a user's own conversation
-- with the assistant — their questions, its replies, AND the reminders it
-- raises on its own (send-maintenance-push-notices.js writes those directly
-- too, via the same service-role client that bypasses RLS everywhere else in
-- this app — no extra grant needed for that). ChatWidget loads recent
-- history on mount and subscribes to live inserts, so the conversation now
-- survives a reload and a proactive reminder actually sits in it durably
-- rather than as a one-shot toast.
--
-- WHY THE BROWSER CAN READ BUT NEVER WRITE
--
-- Every row is written server-side — chat.js persists both the user's turn
-- and the assistant's reply after a real model call, using the verified
-- caller's own id; send-maintenance-push-notices.js does the same for a
-- reminder. Letting the browser INSERT directly would mean a "user" row could
-- say anything without ever having gone through rate limiting or the model,
-- and an "assistant" row could be forged. The one thing the browser DOES get
-- to do on its own is DELETE its own rows — ChatWidget's existing delete/edit
-- flows need that to keep a reload from resurrecting a message someone
-- explicitly removed locally.
--
-- WHY origin_session_id
--
-- ChatWidget both (a) renders its own optimistic copy of a message the moment
-- chat.js's HTTP response comes back, and (b) subscribes to this table's own
-- realtime inserts so a reminder written by the cron job shows up live. Doing
-- both without origin_session_id would double-render every message THIS TAB
-- just sent, the instant its own insert echoes back over Realtime. Tagging
-- each row with a random id ChatWidget generates once per mount lets it skip
-- exactly the inserts it already rendered itself, while still catching
-- everything written by another tab or by the cron job (whose rows carry no
-- session id at all, and so are never skipped).

begin;

create table if not exists public.chat_messages (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  role               text not null,
  text               text not null default '',
  -- True for a message the assistant raised on its own (an oil-due reminder),
  -- as opposed to a reply to something the user asked.
  proactive          boolean not null default false,
  -- Set by the tab that sent it; null for anything written by a backend job.
  -- See "WHY origin_session_id" above.
  origin_session_id  uuid,
  created_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_role_known') then
    alter table public.chat_messages
      add constraint chat_messages_role_known check (role in ('user', 'assistant'));
  end if;
end $$;

-- Newest-first is how ChatWidget loads a window of recent history.
create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_owner_read on public.chat_messages;
create policy chat_messages_owner_read on public.chat_messages
  for select to authenticated
  using (user_id = auth.uid());

-- See "WHY THE BROWSER CAN READ BUT NEVER WRITE" above — delete only.
drop policy if exists chat_messages_owner_delete on public.chat_messages;
create policy chat_messages_owner_delete on public.chat_messages
  for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime add table public.chat_messages;
  exception when duplicate_object then null; end;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Exactly two policies, SELECT and DELETE, nothing for insert/update:
--
--   select policyname, cmd from pg_policies where tablename = 'chat_messages';
--
--   Expect chat_messages_owner_read (SELECT) and chat_messages_owner_delete
--   (DELETE) only.
--
-- 2. As an authenticated user, confirm a direct insert is refused:
--
--   insert into public.chat_messages (company_id, user_id, role, text)
--   values (public.active_company_id(), auth.uid(), 'assistant', 'forged');
--
--   Expect it to fail (no INSERT policy => denied by RLS).
--
-- 3. Table is in the realtime publication:
--
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'chat_messages';
--
--   Expect one row back.
