-- Fix: admin_list_companies() threw "column reference created_at is ambiguous".
--
-- The RETURNS TABLE declares an OUT column `created_at`, which is in scope as a
-- variable inside the body. The audit-log subquery's unqualified `max(created_at)`
-- then collided with it. Fix = qualify every column in the subqueries with a table
-- alias so no bare name can resolve to the OUT variable.
--
-- Standalone on purpose: re-running all of 06 would revert the seat-cap check that
-- 09 added to admin_add_company_admin. This only touches admin_list_companies.
--
-- Run after 10. Idempotent.

begin;

create or replace function public.admin_list_companies()
returns table (
  id                  uuid,
  name                text,
  slug                text,
  subscription_status text,
  trial_ends_at       timestamptz,
  created_at          timestamptz,
  user_count          bigint,
  active_user_count   bigint,
  last_activity       timestamptz
)
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
    select c.id, c.name, c.slug, c.subscription_status, c.trial_ends_at, c.created_at,
           coalesce(m.total, 0),
           coalesce(m.active, 0),
           a.last_activity
    from public.companies c
    left join (
      select mm.company_id,
             count(*)                          as total,
             count(*) filter (where mm.active) as active
      from public.memberships mm
      group by mm.company_id
    ) m on m.company_id = c.id
    left join (
      select al.company_id, max(al.created_at) as last_activity
      from public.audit_logs al
      group by al.company_id
    ) a on a.company_id = c.id
    order by c.created_at;
end;
$$;

grant execute on function public.admin_list_companies() to authenticated;

commit;
