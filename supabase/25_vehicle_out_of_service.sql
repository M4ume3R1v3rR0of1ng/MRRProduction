-- Phase 12 - let a person ground a vehicle.
--
-- Run after 24. Idempotent.
--
-- WHY
--
-- The fleet board has always had a red "Out of Service" badge, driven by:
--
--   vehicle.status === 'out_of_service' || oilStatus === 'overdue'
--
-- Only the right-hand side ever fired. `status` was written exactly once, as the
-- literal 'active' in AddVehicleModal, and nothing anywhere could set it to
-- 'out_of_service'. So every red truck on the board was an overdue oil change
-- wearing the wrong label, and the switch to turn it back on did not exist.
--
-- This adds the storage for the half that was missing: a real grounding a manager
-- can set and clear, separate from the mileage math.
--
-- WHY `add column if not exists` ON status
--
-- `status` is expected to exist already, since AddVehicleModal has been inserting
-- it. It is added defensively so this migration is correct either way rather than
-- depending on a column nobody can point at a CREATE TABLE for. Existing rows
-- backfill to 'active', which is what the app already assumed for anything that
-- was not literally 'out_of_service'.
--
-- WHY NO oos_by / oos_at COLUMNS
--
-- Who grounded a truck and when is already recorded: FleetManagementView writes a
-- FLEET_STATUS_CHANGE entry through logAction on every toggle, with the vehicle id
-- and the reason in its metadata. Duplicating that onto the row would give two
-- sources of truth for the same fact and no way to reconcile them once someone
-- edits one.

begin;

alter table public.vehicles
  add column if not exists status text not null default 'active';

-- Free text, deliberately. The reasons a truck comes off the road do not enumerate
-- cleanly: blown transmission, expired plate, failed DOT inspection, lent to a sub,
-- waiting on a part. A dropdown here would just grow an "Other" option.
alter table public.vehicles
  add column if not exists oos_reason text;

-- Keep the column to the values the app actually branches on. 'service_due' is
-- included because getFleetStatus reads it, even though nothing writes it yet.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_status_known') then
    alter table public.vehicles
      add constraint vehicles_status_known
      check (status in ('active', 'out_of_service', 'service_due'));
  end if;
end $$;

-- A reason without a grounding is orphaned text that would render on a truck in
-- normal rotation. src/utils/fleetStatus.js groundingPatch() clears the reason on
-- the way back to active; this makes that a rule rather than a convention.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_oos_reason_needs_grounding') then
    alter table public.vehicles
      add constraint vehicles_oos_reason_needs_grounding
      check (oos_reason is null or status = 'out_of_service');
  end if;
end $$;

comment on column public.vehicles.status is
  'active | out_of_service | service_due. out_of_service is a deliberate human grounding, '
  'never derived. Overdue oil is computed from mileage in utils/helpers.oilSt and is a '
  'separate, advisory state - do not conflate the two again.';

comment on column public.vehicles.oos_reason is
  'Why the vehicle was grounded, free text, max 280 chars enforced in the app. '
  'NULL whenever status is not out_of_service.';

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
-- Expect every row active and unreasoned on first run. If any truck reads
-- out_of_service here before anyone has used the new control, that is real data
-- from before this migration and worth a look.
-- ─────────────────────────────────────────────────────────────────────────────
select status,
       count(*)                          as vehicles,
       count(oos_reason)                 as with_reason
from public.vehicles
group by status
order by status;
