-- Phase 7 — make pulling and returning materials atomic.
--
-- Both flows write the job first and the inventory second, as separate statements:
--
--     update jobs      set status = 'active'   ← commits
--     for each item:
--       update inventory set batches = ...     ← can fail on item 3 of 5
--
-- A failure between them leaves the job saying "pulled" with only some materials
-- deducted. Worse, it is unrecoverable from the UI: the Pull button only renders on
-- `approved` jobs, so a job stranded in `active` can never be pulled again. The stock
-- ledger and the job costing silently disagree from then on, and nobody finds out
-- until the numbers are questioned — which is exactly how the ridge vent mispricing
-- survived six days.
--
-- Reordering doesn't fix it (a retry would then double-deduct). The only correct
-- answer is one transaction. A plpgsql function body runs inside the caller's
-- transaction, so a raise anywhere below rolls back everything above it.
--
-- Run after 13. Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- commit_job_materials — one job update + N inventory updates, all-or-nothing.
--
-- p_batches is { "<inventory id>": [ …batches… ], … } — the full replacement array
-- per item, matching what the client already computes with doFifo().
--
-- ⚠️ SECURITY INVOKER (the default) is LOAD-BEARING. As DEFINER this would run as the
--    function owner: RLS would stop applying, and enforce_job_perms (12) would see
--    current_user as the owner rather than 'authenticated' and wave every transition
--    through. That is the same footgun that made the column-level REVOKEs in 04 a
--    no-op. Invoker keeps both the tenant boundary and the permission checks intact —
--    a coordinator without jobs_pull still gets rejected by the trigger, inside the
--    transaction, and nothing is written.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.commit_job_materials(
  p_job_id    text,
  p_status    text,
  p_items     jsonb,
  p_batches   jsonb default '{}'::jsonb,
  p_completed text default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co  uuid := public.active_company_id();
  rec record;
begin
  -- NULL for a suspended/unpaid company, which is the kill switch. Fail loudly here
  -- rather than letting `company_id = null` quietly match zero rows below.
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  -- The job first, so enforce_job_perms rejects an unauthorised transition before any
  -- stock moves. Its exception aborts the whole function — no partial deduction.
  --
  -- completed / completedAt are TEXT columns holding ISO strings, not timestamptz —
  -- the app writes "" to them to clear a date, which a real timestamp column would
  -- reject. So p_completed stays text and is NOT cast; an earlier ::timestamptz here
  -- made coalesce(timestamptz, text) fail and the function never got created.
  -- (The columns arguably should be timestamptz. That's a separate migration.)
  update public.jobs
     set status        = p_status,
         items         = p_items,
         materials     = p_items,
         completed     = coalesce(p_completed, completed),
         "completedAt" = coalesce(p_completed, "completedAt")
   where company_id = co
     and id = p_job_id;

  -- A silent zero-row update is how "saved!" gets shown over nothing written.
  if not found then
    raise exception 'Job % not found in your company (it may have been deleted).', p_job_id
      using errcode = 'P0002';
  end if;

  for rec in select key as item_id, value as batches from jsonb_each(p_batches)
  loop
    update public.inventory
       set batches = rec.batches
     where company_id = co
       and id = rec.item_id;

    if not found then
      -- Rolls back the job update too — the entire point of this function.
      raise exception 'Inventory item % not found in your company.', rec.item_id
        using errcode = 'P0002';
    end if;
  end loop;
end;
$$;

grant execute on function public.commit_job_materials(text, text, jsonb, jsonb, text) to authenticated, service_role;

commit;
