-- Phase 44 — make the training library editable, and let "The Full Tour" join it.
--
-- Run after 42 (43 was rolled back and does not apply). Idempotent, EXCEPT the seed
-- insert near the bottom, which is written to run at most once — see its own note.
--
-- WHY
--
-- Two things prompted this:
--
--   1. The portal's "Remove" button becomes "Edit", which can rename a clip as well
--      as remove it. That is a UI-only change - no RLS to add, updating a row's
--      title/blurb was already covered by the existing "for all" write policy from
--      42, the same one that already allowed insert/delete.
--
--   2. "The Full Tour" (src/shared/data/trainingVideos.js) was the one video that
--      COULDN'T be edited or removed, because it isn't a database row at all - it
--      ships hardcoded in the build, specifically so the public, logged-out
--      marketing page (src/public/TrainingPage.jsx) can show it without a database
--      round trip. Making it editable means making it a real row. That only works
--      end to end if the public page can also read it, which means the select
--      policy has to admit anon, not just authenticated.
--
-- The video FILE does not move. Its row's url stays "/steadwerk-demo.mp4", the same
-- self-hosted, same-origin path it always was - only the metadata (title, blurb,
-- whether it still exists at all) becomes a database row instead of a source file.
-- Deleting this row later does not delete /steadwerk-demo.mp4 from the build; it
-- just stops the library from listing it, same as it does for any other row.

begin;

-- ── Table policy: let anyone (including logged-out) read the library ─────────
-- Write stays authenticated-only (unchanged from 42) - a platform admin, same as
-- before. Only SELECT widens, and only to add the anon role alongside authenticated.
drop policy if exists training_media_row_select on public.training_media;
create policy training_media_row_select on public.training_media
  for select to authenticated, anon
  using (true);

-- ── Storage policy: same widening, same reasoning ─────────────────────────────
-- The bucket was already public:true, so an object's CDN URL was already fetchable
-- by anyone with the link (see 26's own note on that) - this just lets an anonymous
-- visitor's Supabase client list/read training-media the same way an authenticated
-- one already could after 42, for parity with the table.
drop policy if exists training_media_select on storage.objects;
create policy training_media_select on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'training-media');

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed "The Full Tour" as a real row - ONCE.
--
-- Not wrapped in the transaction above: this is data, not schema, and the guard
-- below (by title) is what makes re-running the file safe rather than the
-- transaction boundary. If a platform admin later renames or deletes this row,
-- re-running this file must NOT bring back a duplicate under the old title.
--
-- company_id is NOT NULL and defaults to active_company_id() - which reads the
-- caller's JWT, and the SQL Editor has none, so that default resolves to null and
-- the plain insert fails the not-null constraint. Set it explicitly instead, to
-- Steadwerk's own company row (is_platform_company = true, see supabase/32). This
-- column no longer scopes who can SEE the row - after 42/44 every row is readable
-- by everyone - it is only "which company is on file as having added this."
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.training_media
  (company_id, kind, title, blurb, url, sort_order, created_by, created_by_name)
select
  (select id from public.companies where is_platform_company = true limit 1),
  'video',
  'Build a job to a costed report',
  'The whole loop, start to finish. Build the job, approve it, pull the materials, return what came back, and read the costed report that falls out the other end.',
  '/steadwerk-demo.mp4',
  -1000, -- sorts before every existing upload, matching where it always rendered
  null,
  'Steadwerk'
where not exists (
  select 1 from public.training_media where title = 'Build a job to a costed report'
)
and exists (
  select 1 from public.companies where is_platform_company = true
);

-- Loud rather than silent: the guard above means "no company is marked
-- is_platform_company yet" quietly skips the insert with no error at all, which
-- reads as success in the SQL Editor while nothing actually happened. Surface it.
do $$
begin
  if not exists (select 1 from public.companies where is_platform_company = true) then
    raise warning 'No company has is_platform_company = true, so "The Full Tour" was NOT seeded. Run: update public.companies set is_platform_company = true where slug = ''steadwerk''; (see supabase/32), then re-run this file.';
  elsif not exists (select 1 from public.training_media where title = 'Build a job to a costed report') then
    raise warning 'The Full Tour insert did not take. Check for an error above.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   select policyname, cmd, roles, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'training_media' and policyname = 'training_media_row_select';
--   -- roles should list both authenticated and anon.
--
--   select id, title, url, sort_order, created_by_name
--   from public.training_media
--   where title = 'Build a job to a costed report';
--   -- exactly one row.
-- ─────────────────────────────────────────────────────────────────────────────
