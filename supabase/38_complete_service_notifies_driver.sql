-- Phase 38 — "Complete Service" flags the driver's dashboard alert.
--
-- Run after 37. Idempotent.
--
-- THE PROBLEM
--
-- maintenance_requests.newforrequester is what pops the driver's "your vehicle
-- is ready" banner on the Dashboard (see DashboardView's statusAlert) and, as of
-- the realtime-maint-requests channel in useAppData.js, what fires their instant
-- toast too. MaintenanceRequestsView's own updateStatus() sets it correctly for
-- a plain status edit ("scheduled", mostly) — but the actual completion path the
-- UI uses, CompleteServiceModal -> completeService() -> this RPC, never has.
-- 34_complete_maintenance_service.sql's update statement (carried forward
-- unchanged by 37) only ever set status/wh_notes/completed_at. Every ticket
-- closed through "Complete Service" — which is the only place the UI closes one
-- — has silently never notified the driver who filed it.
--
-- WHAT THIS DOES
--
-- Re-defines complete_maintenance_service() with one more assignment in the
-- same update statement that already sets status = 'completed': set
-- newforrequester to true, unless the person completing the ticket is the
-- driver who filed it (matching the "don't alert someone to their own action"
-- rule updateStatus and notifyMaintStatus already follow). Nothing else in the
-- function changes.

begin;

create or replace function public.complete_maintenance_service(
  p_request_id          text,
  p_service_type        text,
  p_service_date        date,
  p_performed_by        text,
  p_notes                text default '',
  p_cost                 numeric default 0,
  p_mileage               numeric default null,
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

  -- Same statement as 34/37, now also flipping newforrequester so the driver's
  -- dashboard banner and realtime toast fire — unless the driver is the one who
  -- completed their own ticket, matching the rule everywhere else this column
  -- is set.
  update public.maintenance_requests
     set status          = 'completed',
         wh_notes        = coalesce(nullif(p_notes, ''), wh_notes),
         completed_at    = now()::text,
         service_type    = p_service_type,
         service_date    = p_service_date,
         performed_by    = nullif(btrim(coalesce(p_performed_by, '')), ''),
         cost            = coalesce(p_cost, 0),
         mileage         = p_mileage,
         newforrequester = (req.uid is distinct from auth.uid()::text)
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
-- 1. Function is still SECURITY INVOKER (blank security_type, not DEFINER):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'complete_maintenance_service';
--
--   prosecdef must be false.
--
-- 2. Pick a real scheduled request filed by someone OTHER than the account
--    running this, dry-run inside a transaction you roll back:
--
--   begin;
--   select public.complete_maintenance_service(
--     '<a scheduled request id filed by someone else>', 'Oil Change', current_date, 'Quick Lube'
--   );
--   select newforrequester from public.maintenance_requests where id = '<same request id>';
--   rollback;
--
--   Expect newforrequester = true.
