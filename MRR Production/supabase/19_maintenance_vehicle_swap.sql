-- Phase 8 — take a vehicle off the road while it is in for service, and lend its
-- driver a spare until it comes back.
--
-- Run after 18. Idempotent.
--
-- THE RULE
--
-- A vehicle is blocked while it has a maintenance_request in 'scheduled'. Not
-- 'pending'. That distinction is the whole safety argument: submitting a request
-- needs only maint_submit, so blocking on 'pending' would let any driver pull a
-- truck off the road by asking. Moving a request to 'scheduled' needs
-- maint_manage, so a second person has agreed the truck is actually going in.
-- 'completed' releases it.
--
-- WHY THE SWAP LIVES ON THE REQUEST
--
-- The loan is not a property of either vehicle, it is a property of the service
-- visit — it starts when the visit is scheduled and ends when the visit is done.
-- Hanging it off maintenance_requests means the lifecycle is already modelled and
-- there is no second place to keep in sync. It also means completing the request
-- is the natural trigger to unwind it, which is what the trigger below does.
--
-- WHY BOTH SIDES ARE FUNCTIONS AND NOT CLIENT WRITES
--
-- Each direction touches three rows across two tables. Done from the browser that
-- is three statements that can fail on the second, leaving a driver assigned to
-- two vehicles or to none. That is the same failure that
-- 14_atomic_material_moves.sql exists to prevent, and the same answer applies: a
-- plpgsql body runs in the caller's transaction, so a raise anywhere rolls back
-- everything above it.
--
-- ⚠️ SECURITY INVOKER (the default) on both, and it is load-bearing for the same
--    reason it is in 14: as DEFINER, RLS would stop applying and the tenant
--    boundary would be gone. Every statement below is additionally scoped by
--    company_id so the function is correct even if someone later changes that.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columns to remember the loan.
--
--    Typed by INTROSPECTION rather than hardcoded. vehicles."assignedTo" is a
--    quoted camelCase column created through the dashboard long before these
--    migrations, and whether it is uuid or text is not recorded anywhere in this
--    repo. Copying its exact type guarantees the assignments below compile, and
--    guarantees this file stays correct if that column is ever migrated to uuid.
--
--    Same for the vehicle id, which is app-generated text ('v1'), not a uuid.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  driver_type text;
  veh_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into driver_type
  from pg_attribute a
  where a.attrelid = 'public.vehicles'::regclass
    and a.attname = 'assignedTo' and not a.attisdropped;

  if driver_type is null then
    raise exception
      'public.vehicles has no "assignedTo" column. The app writes that exact '
      'camelCase name (see updateRowStrict in src/views/FleetManagementView.jsx). '
      'If it was renamed, update this migration to match before running it.';
  end if;

  select format_type(a.atttypid, a.atttypmod) into veh_id_type
  from pg_attribute a
  where a.attrelid = 'public.vehicles'::regclass
    and a.attname = 'id' and not a.attisdropped;

  execute format(
    'alter table public.maintenance_requests
       add column if not exists replacement_vehicle_id %s,
       add column if not exists original_driver_id     %s',
    veh_id_type, driver_type);
end $$;

comment on column public.maintenance_requests.replacement_vehicle_id is
  'Vehicle lent to this request''s driver while their own is in for service. '
  'Cleared automatically when the request is completed.';
comment on column public.maintenance_requests.original_driver_id is
  'Who was driving the serviced vehicle when the loan started, so they can be put '
  'back on it. Null means the vehicle had no driver and nothing needs restoring.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Start the loan.
--
--    Refuses rather than guesses. Every rejection here is a case where doing the
--    obvious thing would quietly corrupt the fleet's assignment state:
--
--      not scheduled      — blocking is defined by 'scheduled'. Lending a spare
--                           against a pending request would strand the driver on
--                           the spare if the request is later declined.
--      already has driver — would silently displace whoever is on it.
--      itself scheduled   — lending a truck that is also going in for service.
--      same vehicle       — a no-op that would clear the driver and lose them.
--      loan exists        — re-running would overwrite original_driver_id with
--                           the now-empty value and permanently lose the driver.
--
--    That last one is the important one: it makes the function safe to retry,
--    which matters because the client can double-submit.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assign_replacement_vehicle(
  p_request_id             text,
  p_replacement_vehicle_id text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co  uuid := public.active_company_id();
  req record;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  select * into req
  from public.maintenance_requests
  where company_id = co and id = p_request_id;

  if not found then
    raise exception 'Maintenance request % not found in your company.', p_request_id
      using errcode = 'P0002';
  end if;

  if req.status is distinct from 'scheduled' then
    raise exception
      'A replacement can only be lent while the request is scheduled (this one is "%").',
      coalesce(req.status, 'null') using errcode = '42501';
  end if;

  if req.replacement_vehicle_id is not null then
    raise exception 'This request already has a replacement vehicle assigned.'
      using errcode = '42501';
  end if;

  if p_replacement_vehicle_id = req.vid then
    raise exception 'The replacement cannot be the vehicle going in for service.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.vehicles
    where company_id = co and id = p_replacement_vehicle_id
  ) then
    raise exception 'Vehicle % not found in your company.', p_replacement_vehicle_id
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.vehicles
    where company_id = co and id = p_replacement_vehicle_id
      and coalesce("assignedTo"::text, '') <> ''
  ) then
    raise exception 'That vehicle already has a driver assigned. Pick one with no driver.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.maintenance_requests
    where company_id = co and vid = p_replacement_vehicle_id and status = 'scheduled'
  ) then
    raise exception 'That vehicle is itself scheduled for maintenance.'
      using errcode = '42501';
  end if;

  -- Remember who is being moved. Reading "assignedTo" straight across in SQL
  -- avoids declaring a variable of a type this file deliberately does not hardcode.
  update public.maintenance_requests m
     set replacement_vehicle_id = p_replacement_vehicle_id,
         original_driver_id     = v."assignedTo"
    from public.vehicles v
   where m.company_id = co and m.id = p_request_id
     and v.company_id = co and v.id = m.vid;

  -- Move the driver onto the spare.
  update public.vehicles rv
     set "assignedTo" = m.original_driver_id
    from public.maintenance_requests m
   where rv.company_id = co and rv.id = p_replacement_vehicle_id
     and m.company_id = co and m.id = p_request_id;

  -- And off the one going in, so the fleet never shows one driver on two trucks.
  update public.vehicles ov
     set "assignedTo" = null
    from public.maintenance_requests m
   where ov.company_id = co and ov.id = m.vid
     and m.company_id = co and m.id = p_request_id;
end;
$$;

grant execute on function public.assign_replacement_vehicle(text, text)
  to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. End the loan, automatically, whenever the request is completed.
--
--    A trigger rather than a second RPC because completion already happens from
--    more than one place (MaintenanceRequestsView and MaintenanceCalendar both
--    write status). A function would have to be called from each of them and
--    would be forgotten by the third one somebody adds later. The trigger cannot be.
--
--    Both updates are deliberately conditional. Between scheduling and completion
--    a human may well have reassigned things by hand, and the completion of a work
--    order is not a mandate to overwrite that. So: only put the driver back if the
--    serviced vehicle is still free, and only release the spare if it is still
--    carrying the same driver we put on it. If either has moved on, leave it —
--    a slightly stale assignment is recoverable, a silently clobbered one is not.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.revert_maintenance_swap()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed'
     and old.status is distinct from 'completed'
     and new.replacement_vehicle_id is not null
  then
    update public.vehicles
       set "assignedTo" = new.original_driver_id
     where company_id = new.company_id
       and id = new.vid
       and coalesce("assignedTo"::text, '') = '';

    update public.vehicles
       set "assignedTo" = null
     where company_id = new.company_id
       and id = new.replacement_vehicle_id
       and "assignedTo" is not distinct from new.original_driver_id;
  end if;

  return new;
end;
$$;

drop trigger if exists revert_maintenance_swap_trg on public.maintenance_requests;
create trigger revert_maintenance_swap_trg
  after update on public.maintenance_requests
  for each row execute function public.revert_maintenance_swap();

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sanity check. Blocked vehicles and any loans currently outstanding.
-- Last statement on purpose (the Supabase editor only renders the final result).
-- ─────────────────────────────────────────────────────────────────────────────
select v.id            as vehicle,
       v.name,
       m.status        as request_status,
       m.scheduled_date,
       m.replacement_vehicle_id as lent_replacement,
       m.original_driver_id     as driver_held
from public.vehicles v
join public.maintenance_requests m
  on m.company_id = v.company_id and m.vid = v.id
where m.status = 'scheduled'
order by v.name;
