-- Make a platform-admin account in the Steadwerk tenant, from nothing.
--
-- Unnumbered operator script, like platform_ownership_check.sql. Idempotent: run
-- it twice and the second run reports "already in place" instead of erroring.
--
-- THE CASE IT IS FOR
--
-- There is no platform admin left (the account that held it was deleted), or the
-- one there is cannot sign in. Nobody can open the Owner Console, list companies,
-- or enter a tenant to support it. This puts one account back:
--
--   profiles.is_platform_admin = true
--   an active 'admin' membership in the PLATFORM tenant (Steadwerk), not in a
--   customer tenant like Maumee River Roofing
--   profiles.active_company_id pointed at that tenant
--
-- All three matter. The flag alone is not enough: an account with no active
-- membership anywhere is signed straight back out at the login form
-- (src/features/auth/LoginScreen.jsx:378) however many privileges it holds. And
-- the membership belongs in Steadwerk because that tenant carries
-- is_platform_company = true, which is what makes the app land on the Owner
-- Console and hide Jobs/Inventory/Fleet (supabase/32). A membership in MRR would
-- instead make you an operator of a roofing business.
--
-- WHY NOT admin_add_company_admin()
--
-- Because it cannot work here. Its first line is `if not is_platform_admin()`,
-- which resolves through auth.uid() — and auth.uid() is NULL in the SQL editor, so
-- it raises 'Platform admin access required' no matter who you are. That function
-- is for an authenticated platform admin working through the app. Bootstrapping
-- from zero means direct writes, which the SQL editor can do because it runs as
-- the table owner and RLS does not apply to it.
--
-- THE LOGIN ITSELF COMES FIRST
--
-- STEP 1 needs a row in auth.users. Two ways to get one, in order of preference:
--
--   A. Supabase Dashboard → Authentication → Users → Add user. Tick "Auto Confirm
--      User" so it is usable immediately. This is the supported path and the one
--      to use unless something stops you. Creating the user fires
--      handle_new_user(), which inserts the profiles row for you; STEP 2 then
--      fills in the parts that trigger does not know about.
--
--   B. STEP 1b below, in SQL. Only if the dashboard is not an option — it writes
--      auth.users and auth.identities by hand, and GoTrue owns that schema, so it
--      is the version-fragile path, not the blessed one.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 — WHERE THINGS STAND. Read-only. Run this first.
--
-- Edit the quoted email only; leave every `as <name>` alone (the query reads
-- those names).
-- ─────────────────────────────────────────────────────────────────────────────
with params as (
  select 'kindja@steadwerk.com'::text as want_email
)
select 'platform admins now' as section,
       coalesce(p.email, '— NONE. Nobody can open the Owner Console.') as detail,
       coalesce('enabled ' || p.active::text, '') as value
from params
left join public.profiles p on p.is_platform_admin

union all
select 'platform tenant',
       coalesce((select slug from public.companies where is_platform_company),
                '— NONE MARKED. Set one: update public.companies set is_platform_company = true where slug = ''steadwerk'';'),
       coalesce((select name || ' · seats in use '
                      || (select count(*)::text from public.memberships m
                          where m.company_id = c.id and m.active)
                 from public.companies c where c.is_platform_company), '—')

union all
select 'auth login for that email',
       coalesce((select u.email from auth.users u, params q
                 where lower(u.email) = lower(q.want_email)),
                (select 'does not exist yet — do STEP 1a or 1b' from params))::text,
       coalesce((select 'id ' || u.id::text
                      || ' · confirmed ' || (u.email_confirmed_at is not null)::text
                      || ' · last sign-in ' || coalesce(u.last_sign_in_at::text, 'never')
                 from auth.users u, params q where lower(u.email) = lower(q.want_email)), '—')

union all
select 'profile for that email',
       coalesce((select p.email from public.profiles p, params q
                 where lower(p.email) = lower(q.want_email)), 'none')::text,
       coalesce((select 'enabled ' || p.active::text
                      || ' · platform admin ' || p.is_platform_admin::text
                 from public.profiles p, params q
                 where lower(p.email) = lower(q.want_email)), '—')

union all
select 'memberships for that email',
       c.name,
       'role ' || m.role || ' · active ' || m.active::text
from public.memberships m
join public.companies c on c.id = m.company_id
join public.profiles p on p.id = m.user_id, params q
where lower(p.email) = lower(q.want_email)

order by 1, 2;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1b — CREATE THE LOGIN IN SQL. Writes. SKIP THIS if you used the dashboard
-- (STEP 1a) — it is the fallback, not the normal route.
--
-- Two cautions. The password sits in plain text in this editor and in its query
-- history, so use a throwaway and change it in the app afterwards (Profile →
-- password). And auth.users / auth.identities belong to GoTrue: these columns are
-- right for current Supabase, but they are not a stable public API. If this errors
-- on an unexpected column, use the dashboard instead of fighting it.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  -- ── EDIT THESE ────────────────────────────────────────────────────────────
  want_email    text := 'kindja@steadwerk.com';
  want_name     text := 'Kindja Kabangu';
  temp_password text := 'CHANGE_THIS_THEN_CHANGE_IT_AGAIN_IN_THE_APP';
  -- Guard against running this by accident: nothing happens until it is true.
  do_create     boolean := false;
  -- ──────────────────────────────────────────────────────────────────────────
  uid uuid;
begin
  if not do_create then
    raise notice 'STEP 1b skipped (do_create is false). Use the dashboard, or set it true.';
    return;
  end if;
  if temp_password = 'CHANGE_THIS_THEN_CHANGE_IT_AGAIN_IN_THE_APP' then
    raise exception 'Set a real temporary password first.';
  end if;

  select id into uid from auth.users where lower(email) = lower(want_email);
  if uid is not null then
    raise notice 'Login % already exists (id %). Nothing created; go to STEP 2.', want_email, uid;
    return;
  end if;

  uid := gen_random_uuid();

  -- confirmed_at is a GENERATED column in current Supabase — set email_confirmed_at
  -- and let it follow. instance_id is the fixed all-zero uuid single-tenant GoTrue
  -- uses. crypt()/gen_salt() live in the extensions schema on Supabase.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    lower(want_email),
    extensions.crypt(temp_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', want_name),
    now(), now()
  );

  -- Without an identity row the email provider has nothing to match on and the
  -- password login fails even though the user exists.
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid::text, uid,
    jsonb_build_object(
      'sub', uid::text, 'email', lower(want_email),
      'email_verified', true, 'phone_verified', false
    ),
    'email', now(), now(), now()
  );

  raise notice 'Created login % (id %). handle_new_user() should have added the profile; STEP 2 completes it.', want_email, uid;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — THE GRANT. Writes, in one transaction. Run this after the login
-- exists, whichever way it was made.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  -- ── EDIT THESE ────────────────────────────────────────────────────────────
  want_email text := 'kindja@steadwerk.com';
  want_name  text := 'Kindja Kabangu';
  -- ──────────────────────────────────────────────────────────────────────────
  uid        uuid;
  plat_id    uuid;
  plat_name  text;
  plat_count int;
  had_profile boolean := false;
  mem_before  text;
begin
  select id into uid from auth.users where lower(email) = lower(want_email);
  if uid is null then
    raise exception 'No login % in auth.users. Do STEP 1a (dashboard) or STEP 1b first.', want_email;
  end if;

  select count(*) into plat_count from public.companies where is_platform_company;
  if plat_count = 0 then
    raise exception 'No company is marked as the platform tenant, so there is nowhere to put this membership.'
      using hint = 'Mark it, then re-run: update public.companies set is_platform_company = true where slug = ''steadwerk'';';
  elsif plat_count > 1 then
    raise exception 'More than one company is marked as the platform tenant (%). Fix that first.', plat_count
      using hint = 'select slug, name from public.companies where is_platform_company; then set is_platform_company = false on every one that is not Steadwerk.';
  end if;
  select id, name into plat_id, plat_name from public.companies where is_platform_company;

  select exists (select 1 from public.profiles where id = uid) into had_profile;

  -- The profile. handle_new_user() will have made the row if the login was created
  -- normally; this fills in what that trigger has no opinion about. ON CONFLICT so
  -- it works whether or not the row is there — and so a second run is harmless.
  insert into public.profiles (id, email, full_name, active, is_platform_admin, active_company_id)
  values (uid, lower(want_email), want_name, true, true, plat_id)
  on conflict (id) do update
    set email             = coalesce(profiles.email, excluded.email),
        full_name         = coalesce(nullif(profiles.full_name, ''), excluded.full_name),
        active            = true,
        is_platform_admin = true,
        -- Only point them at the platform tenant if they are not already looking
        -- somewhere valid. Never yank an active session out of a tenant.
        active_company_id = coalesce(profiles.active_company_id, excluded.active_company_id);

  -- profiles.role is DEPRECATED (memberships.role is authoritative) but the React
  -- app still reads it at sign-in, so keep it in step the way create-user.js does.
  begin
    update public.profiles set role = 'admin' where id = uid;
  exception when undefined_column then
    raise notice 'profiles.role is gone — good, the deprecated mirror has been dropped.';
  end;

  -- The membership IS the access. Without it active_company_id() returns NULL,
  -- every policy denies, and the login is bounced at the form.
  select 'role ' || m.role || ' · active ' || m.active::text into mem_before
  from public.memberships m where m.user_id = uid and m.company_id = plat_id;

  insert into public.memberships (user_id, company_id, role, active)
  values (uid, plat_id, 'admin', true)
  on conflict (user_id, company_id) do update
    set role = 'admin', active = true;

  if mem_before is null then
    raise notice 'Added % to % as an active admin.', want_email, plat_name;
  else
    raise notice 'Membership in % already existed (%) — set to active admin.', plat_name, mem_before;
  end if;

  if had_profile then
    raise notice 'Profile already existed; is_platform_admin and active are now true.';
  else
    raise notice 'Profile row created for % (handle_new_user had not made one).', want_email;
  end if;

  raise notice 'Done. Sign in as %; you should land on the Owner Console, since % carries is_platform_company.', want_email, plat_name;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY. Read-only. All four should read 'yes'.
-- ─────────────────────────────────────────────────────────────────────────────
with params as (
  select 'kindja@steadwerk.com'::text as want_email
),
me as (select p.* from public.profiles p, params q where lower(p.email) = lower(q.want_email))
select 'login exists and is confirmed' as item,
       case when exists (
         select 1 from auth.users u, params q
         where lower(u.email) = lower(q.want_email) and u.email_confirmed_at is not null
       ) then 'yes' else 'NO' end as result

union all
select 'profile is enabled and platform admin',
       case when exists (select 1 from me where active and is_platform_admin)
            then 'yes' else 'NO' end

union all
select 'active admin membership in the platform tenant',
       case when exists (
         select 1 from public.memberships m, public.companies c, me
         where m.user_id = me.id and m.company_id = c.id
           and c.is_platform_company and m.active and m.role = 'admin'
       ) then 'yes' else 'NO' end

union all
select 'lands in the platform tenant on next load',
       case when (select active_company_id from me)
               = (select id from public.companies where is_platform_company)
            then 'yes' else 'points elsewhere (fine if deliberate)' end

union all
select 'platform admins in total',
       (select count(*)::text from public.profiles where is_platform_admin and active);

-- ─────────────────────────────────────────────────────────────────────────────
-- Afterwards
--
--   * Change the password in the app if you used STEP 1b.
--   * platform_ownership_check.sql, if you still have it, should now report an
--     empty `problems`.
--   * To put this account into a CUSTOMER tenant as well, do it from the app
--     (Owner Console → Enter → Users), not here — the app enforces the seat cap
--     and sends the invite. And remember that a membership in a tenant OVERRIDES
--     platform admin for role purposes there: active_role() returns the membership
--     role, so an 'employee' row would make you an employee in that tenant
--     (supabase/31). Without any membership you enter as a visiting admin instead,
--     which is usually what you want.
-- ─────────────────────────────────────────────────────────────────────────────
