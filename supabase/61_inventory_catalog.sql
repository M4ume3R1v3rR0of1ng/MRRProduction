-- Phase 61 — a shared library of generic inventory positions, so a new company
-- can stand its catalog up in one click instead of typing thirty items in.
--
-- Run after 18 (it needs RLS enabled as a habit) and after 06 (is_platform_admin).
-- Idempotent.
--
-- WHY
--
-- A company coming aboard Steadwerk starts with an empty Inventory and has to
-- add every position by hand through ItemFormModal, one dialog at a time, before
-- the feature does anything for them. Nearly all of those positions are the same
-- for every roofer: underlayment, cap nails, drip edge, OSB. Only the stock
-- levels and the prices are theirs.
--
-- So the generic half is kept once, centrally, and each company copies the rows
-- it wants into its own catalog as zero-stock positions. From then on the copy is
-- entirely theirs.
--
-- COPIES, NOT REFERENCES — THE ONE DESIGN DECISION THAT MATTERS HERE
--
-- Importing INSERTS a new public.inventory row. It does not point at this table.
-- Nothing links the two afterwards, on purpose:
--
--   - A company renames "OSB Sheathing 7/16"" to "OSB 7/16" and it stays renamed.
--     Their catalog is theirs to run.
--   - Steadwerk fixing a typo here does not rewrite thirty tenants' catalogs, and
--     removing a line here does not delete stock, batches or job history anywhere.
--     That is exactly the blast radius the training library has (see 60), and an
--     inventory position has receipts and job costs hanging off it, so it is a
--     much worse place to have it.
--   - The price never travels. Price lives on a batch in public.inventory.batches
--     and is what THAT company paid THAT week. A suggested price would be wrong
--     for everyone and would look authoritative while being wrong.
--
-- The cost of copies is that this table and a tenant's catalog drift apart, which
-- is the intended behaviour rather than a defect to fix later.
--
-- NO company_id ON THIS TABLE, DELIBERATELY
--
-- 60 had to spend a whole migration undoing a per-company tier on the training
-- library, because a company_id column plus a visibility flag is an invitation to
-- make rows that only one tenant can see — which is how that library ended up
-- shared with exactly one company. There is no such column here and no is_global
-- flag, so there is no hidden state to get wrong: a row in this table is visible
-- to every company by construction, and the only way to take one out of
-- circulation is `active = false`, which hides it from EVERY picker equally.
--
-- WHO MAY DO WHAT
--
--   - Every signed-in user may READ it. Narrower than the training library, which
--     admits anon for the logged-out /training page; nothing here is public, and
--     the picker is behind a login anyway.
--   - Only a platform admin may INSERT, UPDATE or DELETE. Decided up front this
--     time rather than deferred: a company Admin editing this library would be
--     editing what every other company is offered at signup, and no tenant has
--     any reason to reach it. They get their own copy the moment they import.
--   - A company Admin needs inv_edit to import, which is the same permission
--     ItemFormModal already requires to add an item by hand. Importing is adding
--     items; it is not a new right, so it does not get a new permission.
--
-- cat AND unit ARE FREE TEXT, NOT CHECK-CONSTRAINED
--
-- They should match CATEGORIES and UNITS in src/features/inventory/ItemFormModal.jsx,
-- and the Owner Console editor offers exactly those two lists so they cannot drift
-- by accident. No CHECK, because adding a category would then need a migration AND
-- a deploy in lockstep. The cost of being wrong is small and visible: the grid's
-- category filter is built from the rows themselves (InventoryView's `cats`), so a
-- novel category appears there on its own, but ItemFormModal's dropdown would show
-- it blank when editing that item. Keep the two lists in step.
--
-- LEDGER
--
-- Probed in 33 by the table, which is new in this file and cannot be confused with
-- an earlier state — unlike 60, there is nothing here that an older migration also
-- creates. The row count is NOT probed: the seed below is a starting point Steadwerk
-- is expected to edit, so 'how many rows' says nothing about whether 61 ran.

begin;

create table if not exists public.inventory_catalog (
  id          uuid primary key default gen_random_uuid(),

  name        text    not null,
  cat         text    not null,
  unit        text    not null,

  -- The low-stock threshold a company STARTS with for this position. Copied into
  -- public.inventory.alrt at import and theirs to change from then on.
  alrt        integer not null default 10,

  -- Position within its category in the picker. Categories themselves sort
  -- alphabetically, same as the inventory grid's filter.
  sort_order  integer not null default 0,

  -- Retire a line without destroying it: false hides it from every picker while
  -- leaving it here to be put back. Deleting is also fine — nothing references
  -- these rows (see COPIES, NOT REFERENCES) — but a delete loses the wording.
  active      boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- One line per position. Prevents the same item being seeded twice by a re-run of
-- this file and stops a second "Drip Edge" being added by hand next year without
-- anyone noticing. Case-insensitive, because "drip edge" and "Drip Edge" are the
-- same line to the person reading the picker.
create unique index if not exists inventory_catalog_name_key
  on public.inventory_catalog (lower(name));

create index if not exists inventory_catalog_browse_idx
  on public.inventory_catalog (cat, sort_order)
  where active;

alter table public.inventory_catalog enable row level security;

comment on table public.inventory_catalog is
  'Steadwerk''s library of generic inventory positions, offered to every company so a '
  'new tenant can stand its catalog up without typing it in. Every signed-in user reads '
  'it; only a platform admin writes it. Importing COPIES a row into that company''s own '
  'public.inventory as a zero-stock position and leaves no link behind, so a tenant '
  'renaming their copy, or Steadwerk editing this line, never touches the other. There '
  'is no company_id and no visibility flag here on purpose — see supabase/61 and the '
  'tier that supabase/60 had to remove from the training library.';

comment on column public.inventory_catalog.alrt is
  'The low-stock threshold a company starts with for this position, copied into '
  'inventory.alrt at import. Not a rule — theirs to change afterwards.';

comment on column public.inventory_catalog.active is
  'False retires the line from every picker without deleting its wording. There is no '
  'per-company variant of this: a retired line is retired for everybody.';

-- ── Policies ────────────────────────────────────────────────────────────────
-- Read: every signed-in user, unfiltered. Not anon — unlike the training library
-- there is no logged-out page that needs this, so it stays behind a login.
drop policy if exists inventory_catalog_select on public.inventory_catalog;
create policy inventory_catalog_select on public.inventory_catalog
  for select to authenticated
  using (true);

-- Write: platform admins only, all three verbs, with no company test of any kind.
-- A platform admin's active company is not necessarily Steadwerk's own row (32:
-- is_platform_admin is a property of the person, not of the tenant they happen to
-- be inside), which is exactly why there is nothing about company here.
drop policy if exists inventory_catalog_insert on public.inventory_catalog;
create policy inventory_catalog_insert on public.inventory_catalog
  for insert to authenticated
  with check (public.is_platform_admin());

drop policy if exists inventory_catalog_update on public.inventory_catalog;
create policy inventory_catalog_update on public.inventory_catalog
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists inventory_catalog_delete on public.inventory_catalog;
create policy inventory_catalog_delete on public.inventory_catalog
  for delete to authenticated
  using (public.is_platform_admin());

-- ── Seed ────────────────────────────────────────────────────────────────────
-- A generic roofing starting point, not a finished product: edit it in the Owner
-- Console. Categories and units are drawn from ItemFormModal's two lists, and the
-- alert thresholds are plausible rather than researched — every company retunes
-- them against their own burn rate anyway.
--
-- ON CONFLICT DO NOTHING against the name index, so re-running this file never
-- disturbs wording Steadwerk has since edited, and never resurrects a line that
-- was deliberately deleted... which it would, if the name were still free. That is
-- the accepted cost of a seed that can be re-run; retire lines with
-- active = false rather than deleting them and this cannot bite.
insert into public.inventory_catalog (name, cat, unit, alrt, sort_order) values
  -- Roofing Materials
  ('Architectural Shingles',        'Roofing Materials', 'bundles', 30, 10),
  ('3-Tab Shingles',                'Roofing Materials', 'bundles', 20, 20),
  ('Starter Strip Shingles',        'Roofing Materials', 'bundles', 10, 30),
  ('Hip & Ridge Cap Shingles',      'Roofing Materials', 'bundles', 10, 40),
  ('Synthetic Underlayment',        'Roofing Materials', 'rolls',   10, 50),
  ('Felt Underlayment 15 lb',       'Roofing Materials', 'rolls',   10, 60),
  ('Ice & Water Shield',            'Roofing Materials', 'rolls',    8, 70),
  ('Roll Roofing',                  'Roofing Materials', 'rolls',    5, 80),

  -- Fasteners
  ('Roofing Nails 1-1/4" Coil',     'Fasteners',         'boxes',   10, 10),
  ('Roofing Nails 1-1/2" Coil',     'Fasteners',         'boxes',   10, 20),
  ('Plastic Cap Nails',             'Fasteners',         'boxes',   10, 30),
  ('Plastic Cap Staples',           'Fasteners',         'boxes',    8, 40),
  ('Wood Screws 2"',                'Fasteners',         'boxes',    6, 50),

  -- Sealants
  ('Roofing Cement',                'Sealants',          'tubes',   12, 10),
  ('Polyurethane Sealant',          'Sealants',          'tubes',   12, 20),
  ('SEBS Sealant - White',          'Sealants',          'tubes',   12, 30),
  ('Butyl Tape',                    'Sealants',          'rolls',    8, 40),

  -- Ventilation
  ('Ridge Vent',                    'Ventilation',       'each',    20, 10),
  ('Ridge Vent End Caps',           'Ventilation',       'each',     6, 20),
  ('Box Vent',                      'Ventilation',       'each',    10, 30),
  ('Turtle Vent',                   'Ventilation',       'each',    10, 40),
  ('Soffit Vent',                   'Ventilation',       'each',    10, 50),
  ('Pipe Boot',                     'Ventilation',       'each',    12, 60),

  -- Decking
  ('OSB Sheathing 7/16"',           'Decking',           'sheets',  20, 10),
  ('Plywood 1/2"',                  'Decking',           'sheets',  15, 20),
  ('Lumber 2x4',                    'Decking',           'each',    20, 30),

  -- Sheet Metal
  ('Drip Edge',                     'Sheet Metal',       'each',    20, 10),
  ('Valley Flashing',               'Sheet Metal',       'each',    10, 20),
  ('Step Flashing',                 'Sheet Metal',       'boxes',    8, 30),
  ('Counter Flashing',              'Sheet Metal',       'each',     8, 40),
  ('Coil Stock',                    'Sheet Metal',       'rolls',    4, 50),

  -- Accessories
  ('Tarps',                         'Accessories',       'each',     6, 10),
  ('Chalk Line Refill',             'Accessories',       'each',     6, 20),
  ('Marking Paint',                 'Accessories',       'each',     6, 30),

  -- Tools
  ('Utility Knife Blades',          'Tools',             'packs',   10, 10),
  ('Caulk Gun',                     'Tools',             'each',     4, 20),
  ('Shingle Remover',               'Tools',             'each',     2, 30),
  ('Roofing Hatchet',               'Tools',             'each',     2, 40)
on conflict do nothing;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. The table, with RLS actually ON (relrowsecurity = true):
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relname = 'inventory_catalog';
--
--   -- B. Four policies. Select admits authenticated and NOT anon; the three write
--   --    ones name is_platform_admin() and carry no company test:
--   select policyname, cmd, roles, qual, with_check
--   from pg_policies
--   where schemaname = 'public' and tablename = 'inventory_catalog'
--   order by policyname;
--
--   -- C. What the picker will offer, as it will group it:
--   select cat, count(*) as positions
--   from public.inventory_catalog
--   where active
--   group by cat
--   order by cat;
--
--   -- D. There is no company_id on this table and no is_global — the two columns
--   --    whose combination hid the training library. Expect zero rows:
--   select column_name
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'inventory_catalog'
--     and column_name in ('company_id', 'is_global');
--
--   -- E. Nothing in anyone's catalog points at this table, which is the design
--   --    (copies, not references). Expect zero rows, forever:
--   select count(*) as referencing_constraints
--   from pg_constraint
--   where confrelid = 'public.inventory_catalog'::regclass;
--
--   -- F. The name index is case-insensitive, so this is refused as a duplicate:
--   --   begin;
--   --     insert into public.inventory_catalog (name, cat, unit) values ('drip edge', 'Sheet Metal', 'each');
--   --     -- expect: 23505 duplicate key value violates "inventory_catalog_name_key"
--   --   rollback;
--
--   -- G. As a COMPANY ADMIN (not a platform admin), with a session for one:
--   --      select count(*) from public.inventory_catalog;        -- the whole library
--   --      update public.inventory_catalog set name = name;      -- 0 rows, refused
--   --      delete from public.inventory_catalog where true;       -- 0 rows, refused
--   --    A refused write under RLS is a silent no-op, not an error: count the rows
--   --    affected rather than waiting for an exception.
-- ─────────────────────────────────────────────────────────────────────────────
