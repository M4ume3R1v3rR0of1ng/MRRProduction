-- Phase 34 — "Complete Service" as one atomic step.
--
-- Run after 33. Idempotent.
--
-- THE PROBLEM
--
-- Closing out a scheduled maintenance ticket touches three things that all have
-- to land together: the service gets written to the vehicle's history, the
-- ticket moves to 'completed', and — sometimes — a driver goes back on (or onto
-- a different) truck. Doing that as three client calls from the browser is the
-- same failure 14_atomic_material_moves.sql and 19_maintenance_vehicle_swap.sql
-- already exist to prevent: a failure on call two leaves the ticket open with the
-- service already logged, or logs the service twice on retry, or leaves the
-- truck with no driver at all. This is that same fix applied to this flow.
--
-- WHY ONE FUNCTION AND NOT A NETLIFY FUNCTION
--
-- Nothing here needs a secret or a third party — it is only ever this
-- session's own company's rows. A plpgsql function running in the caller's
-- transaction gets the same all-or-nothing guarantee with far less to deploy:
-- one SQL statement instead of a serverless endpoint, and it inherits RLS for
-- free (see the SECURITY INVOKER note below).
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same reason as 14 and 19:
--    as DEFINER, RLS would stop applying and the tenant boundary would be gone.
--    Every statement below is additionally scoped by company_id so the function
--    stays correct even if that ever changes. has_perm() is the one piece that
--    IS SECURITY DEFINER (from 12_permission_enforcement.sql), which is how it
--    can read role_permissions/overrides without recursing.
--
-- WHY assignedTo IS SET THROUGH DYNAMIC SQL
--
-- Same footgun 19 documents: vehicles."assignedTo" is a quoted camelCase column
-- created through the dashboard, and whether it is text or uuid is not recorded
-- anywhere in this repo. Rather than introspect its type up front, the one
-- statement that writes it is built with format(%L, ...) and executed
-- dynamically — the value goes in as a SQL literal, which Postgres parses
-- against the column's real type however it turns out to be. p_request_id and
-- the vehicle id are known app-generated text (see 19's note), so those are
-- ordinary typed parameters.

begin;

create or replace function public.complete_maintenance_service(
  p_request_id          text,
  p_service_type        text,
  p_service_date        date,
  p_performed_by        text,
  p_notes                text default '',
  p_cost                 numeric default 0,
  p_mileage               numeric default null,
  -- Driver on the serviced vehicle once the visit is closed. NULL = leave
  -- whatever the swap-revert trigger (19) already put there alone. '' =
  -- explicitly clear the driver. Anything else = put that person on it.
  p_reassign_driver_id     text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co   uuid := public.active_company_id();
  req  public.maintenance_requests%rowtype;
  veh  public.vehicles%rowtype;
  svc  jsonb;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  if not public.has_perm('maint_manage') then
    raise exception 'You do not have permission to complete maintenance requests.'
      using errcode = '42501';
  end if;

  if p_service_type is null or btrim(p_service_type) = '' then
    raise exception 'A service type is required.' using errcode = '22004';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode = '22004';
  end if;

  -- Lock both rows for the rest of this transaction so a second "Complete
  -- Service" click (this one or another manager's) can't race this one.
  select * into req
  from public.maintenance_requests
  where company_id = co and id = p_request_id
  for update;

  if not found then
    raise exception 'Maintenance request % not found in your company.', p_request_id
      using errcode = 'P0002';
  end if;

  if req.status is distinct from 'scheduled' then
    raise exception
      'Only a scheduled request can be completed this way (this one is "%").',
      coalesce(req.status, 'null') using errcode = '42501';
  end if;

  select * into veh
  from public.vehicles
  where company_id = co and id = req.vid
  for update;

  if not found then
    raise exception 'Vehicle % not found in your company.', req.vid
      using errcode = 'P0002';
  end if;

  if p_mileage is not null and p_mileage < coalesce(veh.mi, 0) then
    raise exception 'Odometer reading (%) is behind the vehicle''s last logged mileage (%).',
      p_mileage, veh.mi using errcode = '22004';
  end if;

  svc := jsonb_build_object(
    'id', substr(md5(clock_timestamp()::text || random()::text), 1, 8),
    'type', p_service_type,
    'dt', p_service_date::text,
    'mi', coalesce(p_mileage, veh.mi, 0),
    'by', nullif(btrim(coalesce(p_performed_by, '')), ''),
    'notes', coalesce(p_notes, ''),
    'cost', coalesce(p_cost, 0)
  );

  update public.vehicles
     set sl   = coalesce(veh.sl, '[]'::jsonb) || jsonb_build_array(svc),
         mi   = coalesce(p_mileage, veh.mi),
         mil  = case
                   when p_mileage is not null and p_mileage is distinct from veh.mi
                     then coalesce(veh.mil, '[]'::jsonb)
                          || jsonb_build_array(jsonb_build_object(
                               'dt', p_service_date::text, 'mi', p_mileage, 'by', auth.uid()::text))
                   else veh.mil
                 end,
         lomi = case when p_service_type = 'Oil Change'
                     then coalesce(p_mileage, veh.mi, veh.lomi) else veh.lomi end,
         ldd  = case when p_service_type = 'Detail'
                     then p_service_date::text else veh.ldd end
   where company_id = co and id = veh.id;

  -- Firing this update also fires revert_maintenance_swap_trg (19): if this
  -- request lent a spare, the original driver goes back on this vehicle and the
  -- spare is released, PROVIDED both are still exactly as the loan left them.
  -- p_reassign_driver_id, applied below, is a deliberate human choice made after
  -- that trigger runs, so it is allowed to override what the trigger decided.
  update public.maintenance_requests
     set status       = 'completed',
         wh_notes     = coalesce(nullif(p_notes, ''), wh_notes),
         completed_at = now()::text
   where company_id = co and id = req.id;

  if p_reassign_driver_id is not null then
    execute format(
      'update public.vehicles set %I = %L where company_id = %L and id = %L',
      'assignedTo', nullif(p_reassign_driver_id, ''), co, veh.id
    );
  end if;

  return jsonb_build_object(
    'request_id', req.id,
    'vehicle_id', veh.id,
    'service', svc
  );
end;
$$;

grant execute on function public.complete_maintenance_service(
  text, text, date, text, text, numeric, numeric, text
) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Function exists and is SECURITY INVOKER (blank security_type, not DEFINER):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'complete_maintenance_service';
--
--   prosecdef must be false.
--
-- 2. Pick a real scheduled request in your own company and dry-run it inside a
--    transaction you roll back, so nothing is actually written:
--
--   begin;
--   select public.complete_maintenance_service(
--     '<a scheduled request id>', 'Oil Change', current_date, 'Quick Lube'
--   );
--   rollback;
--
--   Confirm the returned jsonb has the shape { request_id, vehicle_id, service }.
