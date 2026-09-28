-- Phase 2b — per-company storage usage for the owner console.
--
-- Answers "how much storage is each company using?" Because every file is now stored
-- under <company_id>/… (see 05_storage.sql), we can sum each company's bytes straight
-- from Supabase's own object metadata — no counter to maintain, no drift.
--
-- NOTE ON SPEED: this is a COST/capacity metric, not a performance one. Stored bytes
-- don't slow the app — reads come off the CDN, query speed is about DB indexes and
-- compute tier. Watch this to know your storage bill and when to size up your plan,
-- not to diagnose slowness.
--
-- Platform-admin only, like the other admin_* RPCs. Run after 06. Idempotent.

begin;

create or replace function public.admin_storage_usage()
returns table (
  company_id   uuid,
  total_bytes  bigint,
  object_count bigint
)
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required';
  end if;

  return query
    select
      ((storage.foldername(o.name))[1])::uuid            as company_id,
      coalesce(sum((o.metadata->>'size')::bigint), 0)    as total_bytes,
      count(*)                                           as object_count
    from storage.objects o
    where o.bucket_id in (
        'vehicle-photos','inventory-photos','job-attachments',
        'vehicle-attachments','inventory-attachments'
      )
      -- Only company-scoped paths. Legacy flat files (uploaded before 05) have no
      -- company folder, so foldername()[1] is null/non-uuid and they're skipped —
      -- they aren't attributable to a tenant anyway.
      and (storage.foldername(o.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by 1;
end;
$$;

grant execute on function public.admin_storage_usage() to authenticated;

commit;
