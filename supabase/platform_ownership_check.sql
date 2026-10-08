-- Who owns this platform, according to the database?
--
-- Read-only. Nothing here writes to your database. Not part of the numbered run —
-- like 00_introspect.sql, it is something you run when you need an answer.
--
-- WHY THIS EXISTS
--
-- The app is already built so that Steadwerk owns the platform and every roofing
-- business, Maumee River Roofing included, is a tenant inside it. But that is a
-- property of DATA, not of code: one boolean column, companies.is_platform_company
-- (supabase/32), plus one boolean per person, profiles.is_platform_admin.
--
-- Which means the code can be completely right while the database disagrees, and
-- 32 is unusually easy to get half-applied. Its setter is:
--
--     update public.companies set is_platform_company = true where slug = 'steadwerk';
--
-- If the real slug is 'steadwerk-llc', or 'Steadwerk', or the company row had not
-- been created yet when 32 was run, that update matched nothing, reported
-- "UPDATE 0", and committed successfully. No error anywhere. The symptom is that
-- signing in as the platform owner lands on the operational dashboard — crews,
-- trucks, a row of zeroes — instead of the Owner Console, because
-- is_platform_company came back false and the router sent you to /dashboard.
--
-- The reverse is worse, and is checked for below: if a CUSTOMER's row is true,
-- that company's staff lose Jobs, Inventory, Fleet and Pull Inventory on their
-- next page load — the entire product they pay for.
--
-- ONE statement on purpose. The Supabase SQL Editor only shows the result of the
-- LAST statement in a script, so a version of this with four separate selects
-- would silently show you only the fourth. Everything is packed into one JSON
-- cell: run it, click the cell, read it. Same reasoning as 00_introspect.sql.
--
-- READ `problems` FIRST. It is empty when ownership is set up correctly, and every
-- entry carries the statement that fixes it.

with co as (
  select
    c.id,
    c.name,
    c.slug,
    c.subscription_status,
    -- Read through to_jsonb rather than naming the column, so this file still runs
    -- and still reports something useful on a database where 32 was never applied
    -- at all. Naming it directly would fail the whole query with "column
    -- is_platform_company does not exist" — which does answer the question, but
    -- only for a reader who already knows what that error means.
    coalesce((to_jsonb(c) ->> 'is_platform_company')::boolean, false) as is_platform,
    (to_jsonb(c) ? 'is_platform_company')                             as flag_column_exists
  from public.companies c
),
mem as (
  select company_id, count(*) filter (where active) as active_members
  from public.memberships
  group by company_id
),
admins as (
  select p.id, p.email, p.full_name, p.active, p.active_company_id
  from public.profiles p
  where p.is_platform_admin
),
owner_co as (
  select * from co where is_platform
)
select jsonb_pretty(jsonb_build_object(

  -- ── The one-line answer ────────────────────────────────────────────────────
  'owns_the_platform', coalesce(
    (select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by name)
     from owner_co),
    '[]'::jsonb),

  -- ── Everything that needs doing, each with the statement that does it ──────
  'problems', coalesce((
    select jsonb_agg(p order by p->>'problem')
    from (
      -- 32 never ran at all.
      select jsonb_build_object(
        'problem', 'companies.is_platform_company does not exist',
        'meaning', 'Migration 32 has not been applied, so no company can be the platform operator yet.',
        'fix',     'Run supabase/32_platform_company.sql, then re-run this file.'
      ) as p
      where not (select bool_or(flag_column_exists) from co)

      union all

      -- 32 ran, but its slug-keyed update matched nothing. The common case.
      select jsonb_build_object(
        'problem', 'No company is marked as the platform operator',
        'meaning', 'Signing in as the platform owner lands on the operational dashboard instead of the Owner Console. '
                || 'Migration 32 keys off slug = ''steadwerk''; if the real slug differs its update matched zero rows and still committed.',
        'slugs_available', (select jsonb_agg(slug order by slug) from co),
        'fix',     'update public.companies set is_platform_company = true where slug = ''<the Steadwerk slug listed above>'';'
      )
      where (select bool_or(flag_column_exists) from co)
        and not exists (select 1 from owner_co)

      union all

      -- More than one. Ambiguous, and at least one of them is somebody's business.
      select jsonb_build_object(
        'problem', 'More than one company is marked as the platform operator',
        'meaning', 'Every one of these hides Jobs, Inventory, Fleet and Pull Inventory from its own staff. Only Steadwerk should be true.',
        'marked',  (select jsonb_agg(jsonb_build_object('name', name, 'slug', slug) order by name) from owner_co),
        'fix',     'update public.companies set is_platform_company = false where slug = ''<each one that is not Steadwerk>'';'
      )
      where (select count(*) from owner_co) > 1

      union all

      -- The dangerous direction: an operating business flagged as the platform.
      select jsonb_build_object(
        'problem', 'An operating company is marked as the platform operator: ' || o.name,
        'meaning', 'Its staff lose Jobs, Inventory, Fleet and Pull Inventory on their next page load — the whole product. '
                || 'A roofing business is a CLIENT of the platform and must never carry this flag.',
        'fix',     format('update public.companies set is_platform_company = false where slug = %L;', o.slug)
      )
      from owner_co o
      -- Heuristic, and deliberately a loose one: a company carrying jobs, trucks or
      -- inventory is an operating business whatever it is called. The platform
      -- operator's own tenant has none of those and never will (see 32's header).
      where exists (select 1 from public.jobs      j where j.company_id = o.id)
         or exists (select 1 from public.vehicles  v where v.company_id = o.id)
         or exists (select 1 from public.inventory i where i.company_id = o.id)

      union all

      -- Nobody can reach the Owner Console.
      select jsonb_build_object(
        'problem', 'There are no platform admins',
        'meaning', 'Nobody can open the Owner Console, list companies, or Enter one to support a customer.',
        'fix',     'update public.profiles set is_platform_admin = true where lower(email) = lower(''<the owner''''s email>'');'
      )
      where not exists (select 1 from admins)

      union all

      -- A platform admin with no seat in the platform tenant. They can still get
      -- in — active_company_id()'s second branch carries them (supabase/31) — but
      -- is_visiting_company() is then true in their OWN company, so they would work
      -- under a permanent "you are inside someone else's tenant" banner.
      select jsonb_build_object(
        'problem', 'Platform admin holds no membership in the platform company: ' || a.email,
        'meaning', 'They can still enter it, but is_visiting_company() returns true there, so the visiting banner shows in their own tenant.',
        'fix',     format(
                     'insert into public.memberships (user_id, company_id, role, active) '
                  || 'values (%L, (select id from public.companies where slug = %L), ''admin'', true) '
                  || 'on conflict (user_id, company_id) do update set active = true, role = ''admin'';',
                     a.id, (select slug from owner_co limit 1))
      )
      from admins a
      where (select count(*) from owner_co) = 1
        and not exists (
          select 1 from public.memberships m
          where m.user_id = a.id
            and m.company_id = (select id from owner_co limit 1)
            and m.active
        )

      union all

      -- The platform tenant's own subscription state. Not fatal: 31's platform-admin
      -- branch skips the subscription gate precisely so the owner cannot be locked
      -- out of their own product. But it is wrong, and it makes the operator's row
      -- read as a lapsed customer in its own console.
      select jsonb_build_object(
        'problem', 'The platform company''s subscription_status is ' || o.subscription_status,
        'meaning', 'Harmless for access (supabase/31 exempts platform admins from the subscription gate) but it lists the operator as a lapsed customer.',
        'fix',     format('update public.companies set subscription_status = ''active'' where slug = %L;', o.slug)
      )
      from owner_co o
      where o.subscription_status not in ('trialing', 'active', 'past_due')
    ) problems
  ), '[]'::jsonb),

  -- ── Every company, and which side of the line it sits on ───────────────────
  'companies', coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'name',      co.name,
               'slug',      co.slug,
               'role',      case when co.is_platform then 'PLATFORM OPERATOR' else 'client' end,
               'status',    co.subscription_status,
               'members',   coalesce(mem.active_members, 0),
               'jobs',      (select count(*) from public.jobs      j where j.company_id = co.id),
               'vehicles',  (select count(*) from public.vehicles  v where v.company_id = co.id),
               'inventory', (select count(*) from public.inventory i where i.company_id = co.id)
             )
             -- Operator first, then clients by name: the shape of the answer should
             -- be visible before a word of it is read.
             order by co.is_platform desc, co.name
           )
    from co left join mem on mem.company_id = co.id
  ), '[]'::jsonb),

  -- ── Who can support a customer, and where they are sitting right now ───────
  'platform_admins', coalesce((
    select jsonb_agg(
             jsonb_build_object(
               'email',            a.email,
               'name',             a.full_name,
               'account_active',   a.active,
               'currently_inside', (select c.name from public.companies c where c.id = a.active_company_id),
               'member_of_platform_company', exists (
                 select 1 from public.memberships m
                 where m.user_id = a.id
                   and m.company_id = (select id from owner_co limit 1)
                   and m.active
               )
             ) order by a.email)
    from admins a
  ), '[]'::jsonb)
));
