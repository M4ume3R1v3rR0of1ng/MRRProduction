-- Phase 67 — the outside shops a company sends its trucks to.
--
-- Run after 38 (it replaces complete_maintenance_service as 38 left it, keeping
-- 38's newforrequester line) and after 13 (it calls has_perm). Idempotent.
--
-- WHY
--
-- "Where do we manage our fleet shops, like McMahon's Best-One Tire and Jim
-- Schmidt Ford?" had no answer. A shop only ever existed as whatever somebody
-- typed into "Performed By" on a service record, spelled a new way each time,
-- with nowhere to keep its phone number and no way to ask what it has done for
-- you or what it has cost.
--
-- WHAT THIS ADDS
--
--   public.shops                    One row per shop, per company: name, phone,
--                                   email, address, contact, what it handles.
--   maintenance_requests.shop_id    Where a scheduled ticket is going, and once
--                                   completed, who did the work.
--   complete_maintenance_service()  Takes an optional p_shop_id and carries it
--                                   onto the ticket and into the vehicle's service
--                                   log entry (vehicles.sl[].shop_id).
--   link_shop_history(shop)         One-time catch-up: stamps shop_id onto past
--                                   tickets and service-log entries whose free-text
--                                   "performed by" is exactly the shop's name.
--
-- WHAT DOES NOT CHANGE
--
--   * "Performed By" stays free text. Your own mechanic is not a shop, and a
--     one-off roadside repair should not need a directory entry first. When a
--     shop is picked, its name is written there too, so every report and PDF that
--     reads performed_by keeps working without knowing shops exist.
--   * Shops are ARCHIVED (active = false), not deleted, from the app. A delete is
--     still allowed and sets shop_id back to null on the tickets, but the app
--     never offers it: a shop with history is exactly the one you want to keep.
--
-- WHO MAY DO WHAT
--
--   * Read: every member of the company. A driver should be able to see where
--     their truck is going and the shop's phone number.
--   * Write: holders of fleet_edit (has_perm() is true for every permission when
--     the caller is a company admin), and the platform admin.
--
-- SECURITY INVOKER on both functions, deliberately: they must evaluate as the
-- caller so has_perm() and RLS keep applying. Same note as 34 and 37.

begin;

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists public.shops (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null default public.active_company_id()
               references public.companies(id) on delete cascade,

  name         text not null,
  phone        text,
  email        text,
  address      text,
  contact      text,
  -- What the shop handles, as the free words a manager uses ("Tires", "Ford
  -- dealer", "Glass"). Not a fixed list: every company's shops are different.
  specialties  text[] not null default '{}',
  notes        text,

  active       boolean not null default true,

  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- One "McMahon's" per company. Case-insensitive, because two spellings of the
-- same shop is the exact mess this table exists to end.
create unique index if not exists shops_company_name_key
  on public.shops (company_id, lower(btrim(name)));

alter table public.shops enable row level security;

comment on table public.shops is
  'Outside shops a company sends vehicles to (tire shop, dealer, glass). Read by every '
  'member of the company; written by fleet_edit holders. Archived with active = false '
  'rather than deleted. See supabase/67.';

-- ── Policies ────────────────────────────────────────────────────────────────
drop policy if exists shops_select on public.shops;
create policy shops_select on public.shops
  for select to authenticated
  using (company_id = public.active_company_id() or public.is_platform_admin());

drop policy if exists shops_write on public.shops;
create policy shops_write on public.shops
  for all to authenticated
  using (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.has_perm('fleet_edit'))
  )
  with check (
    public.is_platform_admin()
    or (company_id = public.active_company_id() and public.has_perm('fleet_edit'))
  );

-- ── The ticket points at its shop ───────────────────────────────────────────
alter table public.maintenance_requests
  add column if not exists shop_id uuid references public.shops(id) on delete set null;

create index if not exists maintenance_requests_shop_idx
  on public.maintenance_requests (company_id, shop_id)
  where shop_id is not null;

-- ── complete_maintenance_service, now with a shop ───────────────────────────
-- The 8-argument version from 37 is DROPPED, not left beside the new one. With a
-- defaulted 9th argument, a call naming only the first eight would match both
-- overloads and Postgres would refuse it as ambiguous.
drop function if exists public.complete_maintenance_service(
  text, text, date, text, text, numeric, numeric, text
);

create or replace function public.complete_maintenance_service(
  p_request_id          text,
  p_service_type        text,
  p_service_date        date,
  p_performed_by        text,
  p_notes               text default '',
  p_cost                numeric default 0,
  p_mileage             numeric default null,
  p_reassign_driver_id  text default null,
  p_shop_id             uuid default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co        uuid := public.active_company_id();
  req       public.maintenance_requests%rowtype;
  veh       public.vehicles%rowtype;
  shop_name text;
  by_text   text;
  svc       jsonb;
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

  -- A shop from another company must not be attachable by guessing its id.
  if p_shop_id is not null then
    select s.name into shop_name
    from public.shops s
    where s.company_id = co and s.id = p_shop_id;
    if not found then
      raise exception 'Shop % not found in your company.', p_shop_id using errcode = 'P0002';
    end if;
  end if;

  -- The typed name wins; the shop's name fills it when nothing was typed.
  by_text := coalesce(nullif(btrim(coalesce(p_performed_by, '')), ''), shop_name);

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
    'by', by_text,
    'notes', coalesce(p_notes, ''),
    'cost', coalesce(p_cost, 0)
  );
  if p_shop_id is not null then
    svc := svc || jsonb_build_object('shop_id', p_shop_id::text);
  end if;

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

  -- newforrequester is carried forward from 38 (the driver's "your vehicle is
  -- ready" alert). shop_id: the shop picked now, else the one the ticket was
  -- scheduled with.
  update public.maintenance_requests
     set status          = 'completed',
         wh_notes        = coalesce(nullif(p_notes, ''), wh_notes),
         completed_at    = now()::text,
         service_type    = p_service_type,
         service_date    = p_service_date,
         performed_by    = by_text,
         cost            = coalesce(p_cost, 0),
         mileage         = p_mileage,
         newforrequester = (req.uid is distinct from auth.uid()::text),
         shop_id         = coalesce(p_shop_id, req.shop_id)
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
  text, text, date, text, text, numeric, numeric, text, uuid
) to authenticated, service_role;

-- ── link_shop_history: the one-time catch-up ────────────────────────────────
-- Exact name match only (case and surrounding spaces ignored). "McMahons" and
-- "McMahon's Best One" are NOT matched to "McMahon's Best-One Tire": a wrong
-- link puts a repair on the wrong shop's bill, and a missed one only leaves an
-- old record unlinked, which is how it already was. Entries that already carry a
-- shop are never re-pointed.
create or replace function public.link_shop_history(p_shop_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co        uuid := public.active_company_id();
  shop_key  text;
  n_reqs    integer := 0;
  n_svcs    integer := 0;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;
  if not public.has_perm('fleet_edit') then
    raise exception 'You do not have permission to manage shops.' using errcode = '42501';
  end if;

  select lower(btrim(s.name)) into shop_key
  from public.shops s
  where s.company_id = co and s.id = p_shop_id;
  if not found then
    raise exception 'Shop % not found in your company.', p_shop_id using errcode = 'P0002';
  end if;

  update public.maintenance_requests
     set shop_id = p_shop_id
   where company_id = co
     and shop_id is null
     and lower(btrim(coalesce(performed_by, ''))) = shop_key;
  get diagnostics n_reqs = row_count;

  -- Count the service-log entries this will stamp, then rewrite each affected
  -- vehicle's sl array in one statement.
  -- The CASE, not a WHERE on jsonb_typeof: Postgres does not promise to apply a
  -- filter before calling the set-returning function, and one vehicle with a
  -- non-array sl would otherwise fail the whole link.
  select count(*) into n_svcs
  from public.vehicles v,
       jsonb_array_elements(
         case when jsonb_typeof(v.sl) = 'array' then v.sl else '[]'::jsonb end
       ) e
  where v.company_id = co
    and lower(btrim(coalesce(e ->> 'by', ''))) = shop_key
    and coalesce(e ->> 'shop_id', '') = '';

  update public.vehicles v
     set sl = (
       select coalesce(jsonb_agg(
                case
                  when lower(btrim(coalesce(e ->> 'by', ''))) = shop_key
                       and coalesce(e ->> 'shop_id', '') = ''
                    then e || jsonb_build_object('shop_id', p_shop_id::text)
                  else e
                end
                order by ord), '[]'::jsonb)
       from jsonb_array_elements(v.sl) with ordinality as x(e, ord)
     )
   where v.company_id = co
     and jsonb_typeof(v.sl) = 'array'
     and exists (
       select 1
       from jsonb_array_elements(
              case when jsonb_typeof(v.sl) = 'array' then v.sl else '[]'::jsonb end
            ) e
       where lower(btrim(coalesce(e ->> 'by', ''))) = shop_key
         and coalesce(e ->> 'shop_id', '') = ''
     );

  return jsonb_build_object('requests', n_reqs, 'services', n_svcs);
end;
$$;

grant execute on function public.link_shop_history(uuid) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
--
--   -- A. The table, the column and both functions exist:
--   select to_regclass('public.shops');
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'maintenance_requests'
--      and column_name = 'shop_id';
--   select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('complete_maintenance_service', 'link_shop_history');
--   -- expect ONE complete_maintenance_service (nine arguments, ending in uuid),
--   -- one link_shop_history, and prosecdef = false on both.
--
--   -- B. Dry-run a shop end to end inside a transaction you roll back:
--   begin;
--   insert into public.shops (name, specialties) values ('Test Tire Co', '{Tires}')
--     returning id;
--   select public.link_shop_history('<that id>');
--   rollback;
-- ─────────────────────────────────────────────────────────────────────────────
