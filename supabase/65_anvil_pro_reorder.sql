-- Phase 65 — Anvil Pro: the paid AI add-on, and the first thing behind it,
-- automatic low-stock reordering.
--
-- Run after 61 (inventory exists, and the ledger probes it). Idempotent.
--
-- WHAT THIS ADDS
--
--   companies.anvil_pro          Mirror of "the Anvil Pro line item is on the live Stripe
--                                subscription". Written ONLY by the stripe-webhook, the
--                                same discipline as recurring_seat_packs (27): the
--                                subscription is the truth, because a customer can drop
--                                the add-on from Stripe's billing portal without
--                                touching our UI.
--   companies.anvil_pro_comped   Steadwerk grants Pro with no charge (a pilot, a
--                                friendly shop). Set by a platform admin in SQL for now;
--                                the webhook never touches it, so a webhook replay cannot
--                                take away something nobody is billing for.
--
--   Effective Pro = anvil_pro OR anvil_pro_comped, AND the subscription is usable.
--   The server computes that in netlify/functions/_shared/anvilPro.js; nothing in the
--   browser decides it. The browser only reads these columns to decide what to SHOW.
--
--   inventory.reorder_qty / supplier_name / supplier_email
--                                What to reorder and from whom, per item. All nullable:
--                                an item with no reorder_qty simply has no suggested
--                                quantity and the proposal says so.
--
--   anvil_reorder_settings       One row per company: is auto-reorder on, and who is
--                                told about it.
--
--   anvil_reorder_proposals      One row per "this item is low, here is what to order".
--                                The approval queue. NOTHING is ordered from a supplier
--                                by this file or by anything yet built on it: 'approved'
--                                means a person said yes, not that a PO left the building.
--                                That step waits on a decision about suppliers.
--
-- WHY A PARTIAL UNIQUE INDEX ON PENDING PROPOSALS
--
-- The scan runs every weekday and an item stays low until someone receives stock. Without
-- this index each run would pile another identical proposal on top, and the approver would
-- open the app to forty copies of "order OSB". One PENDING proposal per item per company;
-- once it is approved or dismissed the item can be proposed again.
--
-- WHO MAY DO WHAT
--
--   - Any member of the company may READ its proposals and settings (RLS, company scoped).
--   - NOBODY writes either table from the browser. Settings and decisions go through
--     netlify/functions/anvil-reorder.js, which checks Pro, checks inv_edit, and checks
--     the company. No insert/update/delete policy exists, so a crafted client request is
--     refused by RLS rather than by hoping the UI hid the button.

begin;

-- ── Entitlement ────────────────────────────────────────────────────────────

alter table public.companies
  add column if not exists anvil_pro        boolean not null default false,
  add column if not exists anvil_pro_comped boolean not null default false;

comment on column public.companies.anvil_pro is
  'The Anvil Pro add-on is on the live Stripe subscription. Mirrored by stripe-webhook '
  'on every subscription event; never written by the browser or by a toggle endpoint. '
  'See supabase/65.';
comment on column public.companies.anvil_pro_comped is
  'Steadwerk granted Anvil Pro with no charge. Set by a platform admin; the webhook '
  'never touches it. Effective Pro = anvil_pro OR anvil_pro_comped. See supabase/65.';

-- ── Per-item reorder details ───────────────────────────────────────────────

alter table public.inventory
  add column if not exists reorder_qty    numeric,
  add column if not exists supplier_name  text,
  add column if not exists supplier_email text;

alter table public.inventory
  drop constraint if exists inventory_reorder_qty_check;
alter table public.inventory
  add constraint inventory_reorder_qty_check
  check (reorder_qty is null or reorder_qty > 0);

-- ── Settings ───────────────────────────────────────────────────────────────

create table if not exists public.anvil_reorder_settings (
  company_id    uuid primary key references public.companies(id) on delete cascade,
  enabled       boolean not null default false,
  -- Extra people to email beyond the company's inventory editors. Must be members; the
  -- function re-checks that on send, this column is just the preference.
  notify_emails text[]  not null default '{}',
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- ── Proposals ──────────────────────────────────────────────────────────────

create table if not exists public.anvil_reorder_proposals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  -- inventory's primary key is (company_id, id) and id is whatever the app wrote, so this
  -- is text with no foreign key: deleting an item must not be blocked by, or silently
  -- erase, the record of having proposed it.
  inventory_id    text not null,
  item_name       text not null,
  unit            text,
  on_hand         numeric not null,
  alert_level     numeric not null,
  suggested_qty   numeric,
  supplier_name   text,
  supplier_email  text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'dismissed')),
  created_at      timestamptz not null default now(),
  notified_at     timestamptz,
  decided_at      timestamptz,
  decided_by      uuid,
  -- The quantity the approver actually settled on, which may differ from the suggestion.
  approved_qty    numeric
);

create unique index if not exists anvil_reorder_one_pending_per_item
  on public.anvil_reorder_proposals (company_id, inventory_id)
  where status = 'pending';

create index if not exists anvil_reorder_company_status_idx
  on public.anvil_reorder_proposals (company_id, status, created_at desc);

-- ── RLS: read-only from the browser ────────────────────────────────────────

alter table public.anvil_reorder_settings  enable row level security;
alter table public.anvil_reorder_proposals enable row level security;

drop policy if exists anvil_reorder_settings_select on public.anvil_reorder_settings;
create policy anvil_reorder_settings_select on public.anvil_reorder_settings
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

drop policy if exists anvil_reorder_proposals_select on public.anvil_reorder_proposals;
create policy anvil_reorder_proposals_select on public.anvil_reorder_proposals
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. Columns present, nobody Pro yet:
--   select count(*) filter (where anvil_pro) as pro, count(*) filter (where anvil_pro_comped) as comped
--   from public.companies;
--
--   -- B. Grant Pro to a pilot company for free:
--   --   update public.companies set anvil_pro_comped = true where name = '<company>';
--
--   -- C. As a signed-in company member, writes are refused (no policy exists):
--   --   insert into public.anvil_reorder_settings (company_id, enabled)
--   --   values (public.active_company_id(), true);          -- expect an RLS error
-- ─────────────────────────────────────────────────────────────────────────────
