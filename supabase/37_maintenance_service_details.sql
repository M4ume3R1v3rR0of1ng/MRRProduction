-- Phase 37 — persist what "Complete Service" collects onto the ticket itself.
--
-- Run after 36. Idempotent.
--
-- THE PROBLEM
--
-- CompleteServiceModal collects service type, service date, who performed it,
-- cost, and odometer reading, then 34_complete_maintenance_service.sql writes
-- all of it into ONE place: the vehicle's service log (vehicles.sl, a jsonb
-- array). The maintenance_requests row that started the ticket only ever got
-- status/wh_notes/completed_at back. That log entry has no foreign key to the
-- request that produced it — nothing links them — so there was no way to build
-- a "here's what happened on this ticket" report (a PDF, an export, anything)
-- from the ticket alone. The data was never lost; it just only existed on the
-- vehicle side, one hop away from the ticket that asked for it.
--
-- WHAT THIS DOES
--
-- Adds five columns to maintenance_requests (service_type, service_date,
-- performed_by, cost, mileage) and extends complete_maintenance_service() to
-- write them in the SAME update statement that already sets status/wh_notes/
-- completed_at — still one atomic transaction, nothing new to race. Existing
-- completed tickets are untouched (columns come back null for them; a report
-- built from one just omits those rows, same as it would for a hand-typed gap).
--
-- ⚠️ SECURITY INVOKER (the default) is unchanged and still load-bearing, same
--    note as 34: this function must run as the caller so RLS keeps applying.

begin;

alter table public.maintenance_requests add column if not exists service_type text;
alter table public.maintenance_requests add column if not exists service_date date;
alter table public.maintenance_requests add column if not exists performed_by text;
alter table public.maintenance_requests add column if not exists cost numeric;
alter table public.maintenance_requests add column if not exists mileage numeric;

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

  -- Same statement as 34, now also carrying the entered details onto the
  -- ticket itself so a report can be built from this row alone later.
  update public.maintenance_requests
     set status       = 'completed',
         wh_notes     = coalesce(nullif(p_notes, ''), wh_notes),
         completed_at = now()::text,
         service_type = p_service_type,
         service_date = p_service_date,
         performed_by = nullif(btrim(coalesce(p_performed_by, '')), ''),
         cost         = coalesce(p_cost, 0),
         mileage      = p_mileage
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
-- 1. Columns exist:
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'maintenance_requests'
--     and column_name in ('service_type','service_date','performed_by','cost','mileage');
--
--   Expect all five rows back.
--
-- 2. Function is still SECURITY INVOKER (blank security_type, not DEFINER):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'complete_maintenance_service';
--
--   prosecdef must be false.
--
-- 3. Pick a real scheduled request in your own company and dry-run it inside a
--    transaction you roll back, so nothing is actually written:
--
--   begin;
--   select public.complete_maintenance_service(
--     '<a scheduled request id>', 'Oil Change', current_date, 'Quick Lube'
--   );
--   select service_type, performed_by, cost from public.maintenance_requests
--   where id = '<same request id>';
--   rollback;
--
--   The select should show 'Oil Change', 'Quick Lube', 0.
