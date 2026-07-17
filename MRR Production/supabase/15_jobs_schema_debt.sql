-- Phase 8 (part 1) — retire the dead columns on `jobs`.
--
-- The table stores several facts under two or three names at once. Every write has to
-- set each spelling and every read has to `||` them together:
--
--     j.items || j.materials                       (13 places)
--     j.newforassigned || j.newForAssigned         (31 places)
--     j.title || j.name
--
-- That defensive || is load-bearing today — it is the only reason 3 rows where
-- newforassigned and newForAssigned disagree still notify the right person. It also
-- means the first reader that forgets a spelling breaks silently, which is the same
-- failure mode as the `plates`/`plate` typo in MaintenanceRequestsView.
--
-- This migration only removes what is PROVABLY dead — measured against production on
-- 2026-07-17, all 21 jobs:
--
--     name             0 rows populated   insert writes `title`            → drop
--     approvedAt       0 rows populated   insert writes `approved`         → drop
--     acculynxjobid    0 rows populated   no code reference at all         → drop
--     acculynxJobId    0 rows populated   code refs are local form vars,   → drop
--                                         the DB write is acculynx_job_id
--
-- Deliberately NOT dropped here:
--
--     newForAssigned   still written by DashboardView/PullInventoryView/BuildJobsView.
--                      Dropping it before that code ships would make those writes fail
--                      on an unknown column. Backfilled below so the survivor already
--                      carries the truth; the drop is part 2, after the code deploys.
--     items            7 jobs have `materials` and no `items`; consolidating needs the
--                      readers changed first. Separate migration.
--     created/createdAt  redundant (client stamp vs DB default, ~1s apart) but both
--                      populated on all 21 rows. Harmless; not worth the risk today.
--
-- Run after 14. Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill the survivor BEFORE anything is removed.
--
--    3 rows have newforassigned=true / newForAssigned=false. Readers OR the two, so
--    those jobs currently show as new; if the camel column were dropped without this,
--    the OR would collapse to the lowercase value and nothing would change for them.
--    But the reverse case (camel=true, lower=false) WOULD silently lose a
--    notification — so fold camel into lower first and make the survivor authoritative
--    regardless of which side happens to hold the truth.
-- ─────────────────────────────────────────────────────────────────────────────
update public.jobs
   set newforassigned = true
 where coalesce(newforassigned, false) = false
   and coalesce("newForAssigned", false) = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop the dead columns. IF EXISTS so re-running is safe.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.jobs drop column if exists "name";
alter table public.jobs drop column if exists "approvedAt";
alter table public.jobs drop column if exists "acculynxjobid";
alter table public.jobs drop column if exists "acculynxJobId";

commit;
