-- Phase 35 — let managers correct a wrong material return on a completed job.
--
-- Run after 34. Idempotent.
--
-- THE PROBLEM
--
-- "Return Unused & Complete Job" (confirmReturn in PullInventoryView.jsx) is a
-- one-shot action: it records how much came back AND marks the job completed in
-- the same atomic write. Once a job is completed, Pull Inventory drops it from
-- the queue entirely (isOpenJob), and there has never been a way back in to fix
-- a returned quantity someone got wrong — too much, too little, or a line typed
-- in error. The only "fix" available today is a warehouse manager quietly
-- adjusting on-hand stock elsewhere, which corrects the count but leaves this
-- job's own material record wrong forever.
--
-- WHY NOT JUST RE-RUN THE EXISTING RETURN FLOW
--
-- applyReturnBatch (src/utils/helpers.js) stamps each return with a
-- deterministic id — ret_<jobId>_<iid> — so a retried request after a dropped
-- connection can't double-post it: if a batch with that id already exists, it
-- is left untouched. That guard is exactly right for its job (retries) and
-- exactly wrong for this one (corrections): calling it again with a different
-- quantity would silently no-op the inventory side while the job's own record
-- showed the corrected number — stock and job would disagree from then on, with
-- no error to notice it by.
--
-- So this is a dedicated function: it finds the SAME deterministic batch entry
-- and adjusts it by the delta, instead of trying (and failing) to re-add it.
--
-- WHY THIS CAN'T ALWAYS SUCCEED
--
-- The wrongly-returned stock does not sit untouched waiting to be corrected —
-- it re-enters the warehouse and can be pulled straight back out for a
-- different job before anyone notices the mistake. If that happened, this
-- function has nothing left to take back: reducing the correction below what
-- is still sitting in that batch (batch.rem) would either go negative or
-- silently claw back units another job has already used. Either is worse than
-- refusing, so it refuses, with a message that says how much is unrecoverable
-- automatically and points at the batch it came from.
--
-- WHY THIS IS ITS OWN PERMISSION CHECK
--
-- enforce_job_perms (12) only checks permissions on a STATUS change. This write
-- deliberately leaves status alone (it stays 'completed') so it does not re-run
-- the PDF/AccuLynx/notification side effects that belong to actually completing
-- a job — which means that trigger has nothing to gate here at all. Without an
-- explicit check inside this function, any authenticated company member could
-- rewrite a completed job's material record through this RPC regardless of
-- role. jobs_close is the existing permission for "post-completion job
-- actions" (closing, reopening a closed job), so it is reused here rather than
-- inventing a parallel one.
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same reason as every other
--    function in this series: as DEFINER, RLS would stop applying and the
--    tenant boundary would be gone. Every statement below is additionally
--    scoped by company_id so the function stays correct even if that ever
--    changes.

begin;

create or replace function public.correct_job_return(
  p_job_id      text,
  p_corrections jsonb,   -- { "<inventory item id>": <corrected total returned qty>, … }
  p_by_name     text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co          uuid := public.active_company_id();
  job_rec     public.jobs%rowtype;
  v_items     jsonb;
  v_summary   jsonb := '[]'::jsonb;
  v_iid       text;
  v_new_qty   numeric;
  v_idx       int;
  v_item      jsonb;
  v_old_ret   numeric;
  v_pulled    numeric;
  v_price     numeric;
  v_delta     numeric;
  inv_rec     record;
  v_batches   jsonb;
  v_bidx      int;
  v_batch_id  text;
  v_batch     jsonb;
  v_old_bqty  numeric;
  v_old_brem  numeric;
  v_consumed  numeric;
  v_new_brem  numeric;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  if not public.has_perm('jobs_close') then
    raise exception 'You do not have permission to correct a completed job''s materials.'
      using errcode = '42501';
  end if;

  if p_corrections is null or jsonb_typeof(p_corrections) is distinct from 'object' or p_corrections = '{}'::jsonb then
    raise exception 'No corrections were provided.' using errcode = '22004';
  end if;

  -- Lock the job for the rest of this transaction so two managers correcting
  -- the same job at once can't race each other.
  select * into job_rec
  from public.jobs
  where company_id = co and id = p_job_id
  for update;

  if not found then
    raise exception 'Job % not found in your company (it may have been deleted).', p_job_id
      using errcode = 'P0002';
  end if;

  if job_rec.status is distinct from 'completed' then
    raise exception 'Only a completed job''s return can be corrected this way (this one is "%").',
      coalesce(job_rec.status, 'null') using errcode = '42501';
  end if;

  v_items := coalesce(job_rec.items, job_rec.materials, '[]'::jsonb);

  for v_iid, v_new_qty in
    select key, value::numeric from jsonb_each_text(p_corrections)
  loop
    if v_new_qty is null or v_new_qty < 0 then
      raise exception 'Corrected returned quantity for item % must be zero or more.', v_iid
        using errcode = '22004';
    end if;

    select ord - 1 into v_idx
    from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
    where elem->>'iid' = v_iid;

    if v_idx is null then
      raise exception 'Item % is not on this job.', v_iid using errcode = '22004';
    end if;

    v_item := v_items -> v_idx;
    v_old_ret := coalesce((v_item->>'returned')::numeric, 0);
    v_pulled  := coalesce((v_item->>'pulled')::numeric, 0);
    v_price   := coalesce((v_item->>'priceAtPull')::numeric, 0);

    if v_new_qty > v_pulled then
      raise exception 'Cannot return more than was pulled for item % (% pulled, % requested).',
        v_iid, v_pulled, v_new_qty using errcode = '22004';
    end if;

    v_delta := v_new_qty - v_old_ret;

    if v_delta <> 0 then
      -- Lock the inventory row for this item for the rest of this transaction.
      select id, batches into inv_rec
      from public.inventory
      where company_id = co and id = v_iid
      for update;

      if not found then
        raise exception 'Inventory item % not found in your company.', v_iid
          using errcode = 'P0002';
      end if;

      v_batches  := coalesce(inv_rec.batches, '[]'::jsonb);
      v_batch_id := 'ret_' || p_job_id || '_' || v_iid;

      select ord - 1 into v_bidx
      from jsonb_array_elements(v_batches) with ordinality as t(elem, ord)
      where elem->>'id' = v_batch_id;

      if v_bidx is not null then
        v_batch    := v_batches -> v_bidx;
        v_old_bqty := coalesce((v_batch->>'qty')::numeric, 0);
        v_old_brem := coalesce((v_batch->>'rem')::numeric, 0);
        v_consumed := v_old_bqty - v_old_brem;
        v_new_brem := v_new_qty - v_consumed;

        if v_new_brem < 0 then
          raise exception
            '% of the % previously returned for this job (item %) has already been pulled back out for another job. This correction cannot automatically claw that back — adjust stock manually if it truly needs correcting.',
            v_consumed, v_old_bqty, v_iid using errcode = '22023';
        end if;

        v_batch := v_batch || jsonb_build_object(
          'qty', v_new_qty,
          'rem', v_new_brem,
          'correction', jsonb_build_object(
            'prevQty', v_old_bqty,
            'by', auth.uid()::text,
            'byName', p_by_name,
            'at', now()::text
          )
        );
        v_batches := jsonb_set(v_batches, array[v_bidx::text], v_batch);
      elsif v_new_qty > 0 then
        -- Nothing was ever returned for this item on this job — create the
        -- batch entry fresh, same shape applyReturnBatch would have written.
        v_batches := v_batches || jsonb_build_array(jsonb_build_object(
          'id', v_batch_id,
          'rcvd', to_char(current_date, 'YYYY-MM-DD'),
          'qty', v_new_qty,
          'price', v_price,
          'by', auth.uid()::text,
          'byName', p_by_name,
          'rem', v_new_qty
        ));
      end if;
      -- v_new_qty = 0 with no existing batch entry: nothing was returned
      -- before and nothing is returned now — no inventory write needed.

      update public.inventory
         set batches = v_batches
       where company_id = co and id = v_iid;
    end if;

    v_item := v_item || jsonb_build_object('returned', v_new_qty);
    v_items := jsonb_set(v_items, array[v_idx::text], v_item);

    v_summary := v_summary || jsonb_build_array(jsonb_build_object(
      'iid', v_iid,
      'old_returned', v_old_ret,
      'new_returned', v_new_qty
    ));
  end loop;

  update public.jobs
     set items = v_items,
         materials = v_items
   where company_id = co and id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'corrections', v_summary
  );
end;
$$;

grant execute on function public.correct_job_return(text, jsonb, text) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Function exists and is SECURITY INVOKER (blank security_type, not DEFINER):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'correct_job_return';
--
--   prosecdef must be false.
--
-- 2. Pick a real completed job in your own company and dry-run a correction
--    inside a transaction you roll back, so nothing is actually written:
--
--   begin;
--   select public.correct_job_return(
--     '<a completed job id>', '{"<an inventory item id on that job>": 3}'::jsonb, 'Test User'
--   );
--   rollback;
--
--   Confirm the returned jsonb has the shape { job_id, corrections: [...] }.
--
-- 3. Confirm the guard: correct the same item a second time to a LOWER value
--    after pulling some of the returned stock back out for another job (or
--    simulate it by hand-editing that batch's `rem` down first). The second
--    correction should raise, not silently succeed.
