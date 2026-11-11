-- Phase 66 — an approved reorder can be emailed to the supplier and marked received.
--
-- Run after 65. Idempotent.
--
-- WHY
--
-- 65 stopped at "approved": it records who said yes to what quantity and nothing leaves the
-- building. This adds the two steps after it, so the queue can follow a reorder to the end:
--
--   pending -> approved -> ordered -> received      (or pending -> dismissed)
--
--   ordered   a purchase order was emailed to the supplier (anvil-reorder.js, "send_po")
--   received  somebody marked the delivery as arrived ("receive"); also allowed straight
--             from approved, for an order that was phoned in
--
-- WHAT CHANGES
--
--   - status accepts 'ordered' and 'received'.
--   - po_number, ordered_at, ordered_by, ordered_to: who the PO went to, when, and by whom.
--   - received_at, received_by.
--
-- WHAT DOES NOT CHANGE
--
--   - RLS. Browsers still have SELECT only; every write goes through the Netlify function,
--     which checks Pro, inv_edit and the company. No policy is added here.
--   - Nothing is sent by the database. Sending the email is the function's job.

begin;

alter table public.anvil_reorder_proposals
  add column if not exists po_number   text,
  add column if not exists ordered_at  timestamptz,
  add column if not exists ordered_by  uuid,
  add column if not exists ordered_to  text,
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid;

-- The check constraint from 65 was created inline, so it carries Postgres' default name.
alter table public.anvil_reorder_proposals
  drop constraint if exists anvil_reorder_proposals_status_check;

alter table public.anvil_reorder_proposals
  add constraint anvil_reorder_proposals_status_check
  check (status in ('pending', 'approved', 'ordered', 'received', 'dismissed'));

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. The new columns exist:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'anvil_reorder_proposals'
--     and column_name in ('po_number','ordered_at','ordered_by','ordered_to','received_at','received_by');
--   -- expect 6 rows
--
--   -- B. The constraint now lists five statuses:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'anvil_reorder_proposals_status_check';
-- ─────────────────────────────────────────────────────────────────────────────
