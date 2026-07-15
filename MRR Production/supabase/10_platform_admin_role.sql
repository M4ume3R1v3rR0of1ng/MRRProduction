-- Phase 2c — platform_admin as a managed role.
--
-- is_platform_admin is already unforgeable by ordinary users: the guard trigger from
-- 04 blocks any client (authenticated/anon) from changing it directly, so a company
-- admin cannot grant it to themselves. What was missing is a sanctioned way for an
-- EXISTING platform admin to grant or revoke it to others from the app.
--
-- These RPCs are that way. Both require the caller to already be a platform admin, so
-- the capability only ever spreads by an existing owner's hand — never self-assigned.
-- They're SECURITY DEFINER (run as the owner role), which is how they legitimately
-- pass the guard trigger that blocks everyone else.
--
-- Run after 09. Idempotent.

begin;

-- Who are the platform admins? (owner console panel)
create or replace function public.admin_list_platform_admins()
returns table (id uuid, email text, full_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;
  return query
    select p.id, p.email, p.full_name
    from public.profiles p
    where p.is_platform_admin
    order by p.email;
end;
$$;

grant execute on function public.admin_list_platform_admins() to authenticated;

-- Grant or revoke the platform_admin role by email.
create or replace function public.admin_set_platform_admin(target_email text, value boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target    uuid;
  remaining integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  select id into target from public.profiles where lower(email) = lower(target_email);
  if target is null then
    raise exception 'No account with email %', target_email;
  end if;

  -- Lockout guard: never let the last platform admin be removed, or nobody could
  -- ever administer the platform again without direct database access.
  if value = false then
    select count(*) into remaining
    from public.profiles
    where is_platform_admin and id <> target;
    if remaining = 0 then
      raise exception 'Cannot remove the last platform admin.';
    end if;
  end if;

  update public.profiles set is_platform_admin = value where id = target;
end;
$$;

grant execute on function public.admin_set_platform_admin(text, boolean) to authenticated;

commit;
