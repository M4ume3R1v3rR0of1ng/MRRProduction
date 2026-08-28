-- Phase 36 — let materials added to a job AFTER its initial pull still be
-- pulled from stock, without re-running the whole pull.
--
-- Run after 35. Idempotent.
--
-- THE PROBLEM
--
-- "Pull Materials" (confirmPull in PullInventoryView.jsx) only renders on an
-- `approved` job, and it pulls the WHOLE material list in one pass. Once that
-- has happened the job moves to `active`, and if a line gets added to the job
-- afterwards — someone remembers a missed item, or a crew calls in for more —
-- there is no way back into a pull for just that line. It sits forever at
-- pulled: 0, used: 0, cost: —, whether the job is still active or has since
-- been completed. The material physically went out, but nothing in the
-- system ever deducted it or costed it to the job.
--
-- It also meant "Correct Returned Materials" (35) could never help here
-- either: that modal only lists lines with pulled > 0 on purpose (see its
-- header comment) — there is genuinely nothing to correct a RETURN on when
-- nothing was ever PULLED. The gap is upstream of that modal, not in it.
--
-- WHAT THIS DOES
--
-- A dedicated RPC that FIFO-pulls stock for specific lines on a job that has
-- already been through its initial pull (status active or completed — not
-- closed; see "WHY NOT closed" below), writing the job and the inventory
-- batches atomically — same one-transaction guarantee as commit_job_materials
-- (14), for the same reason: a failure between the two would leave stock
-- deducted with no job record of it, or a job record with no stock actually
-- moved.
--
-- WHY NOT JUST CALL commit_job_materials
--
-- commit_job_materials's only gate is enforce_job_perms (12), and that trigger
-- only checks a permission when jobs.status CHANGES. This deliberately leaves
-- status alone — completing or closing a job is not what's happening here —
-- so the trigger would see old.status = new.status and enforce nothing at
-- all. Calling commit_job_materials directly with an unchanged status would
-- let any authenticated company member rewrite a job's material record with
-- no permission check whatsoever. So, same as 35, this is its own function
-- with its own explicit has_perm check inside the transaction.
--
-- WHY jobs_pull AND NOT jobs_close
--
-- This is a pull, just a late one — the same action `jobs_pull` already
-- gates on an approved job, done by the same people (warehouse/field crews
-- normally hold jobs_pull but not jobs_close). Gating it on jobs_close like
-- 35 does would lock warehouse staff out of an action that is, in substance,
-- their job.
--
-- WHY NOT closed
--
-- Same boundary correct_job_return (35) already draws, and the UI's own: the
-- Edit Job dialog it's reached from hides its own button once a job is
-- closed, so allowing `closed` here would leave a status the RPC accepts but
-- nothing in the app can ever reach. Reopen the job first (jobs_close) if a
-- closed job genuinely needs a line pulled.
--
-- WHY THE FIFO MATH STAYS IN THE CLIENT
--
-- doFifo (src/utils/helpers.js) already does this exact batch-by-batch
-- deduction for the normal pull, is exercised every day, and its output
-- (pulled/pulledAt/priceAtPull/pullCost/consumed + the resulting batches) is
-- exactly what this function needs to write. Re-deriving the same algorithm
-- in plpgsql here would be a second implementation to keep in sync with the
-- first for no safety benefit — commit_job_materials already accepts
-- client-computed batches on the same trust basis for the normal pull flow.
-- What this function adds on top is the guard commit_job_materials doesn't
-- need: each line must currently show pulled = 0 here, so this can only ever
-- populate a line nothing has gone out for yet — never quietly overwrite an
-- already-pulled quantity. Only the five known pull fields are merged onto
-- the item (an explicit jsonb_build_object, not `||` on the whole client
-- payload), so a line can't be used to smuggle in a change to some other
-- field.
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same reason as every
--    other function in this series: as DEFINER, RLS would stop applying and
--    the tenant boundary would be gone. Every statement below is additionally
--    scoped by company_id so the function stays correct even if that ever
--    changes.

begin;

create or replace function public.pull_added_job_materials(
  p_job_id  text,
  p_items   jsonb,               -- { "<inventory item id>": { "pulled": n, "pulledAt": "YYYY-MM-DD", "priceAtPull": n, "pullCost": n, "consumed": [...] } }
  p_batches jsonb default '{}'::jsonb  -- { "<inventory item id>": [ …batches… ], … } — full replacement array, same shape commit_job_materials (14) accepts
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co        uuid := public.active_company_id();
  job_rec   public.jobs%rowtype;
  v_items   jsonb;
  v_summary jsonb := '[]'::jsonb;
  v_iid     text;
  v_patch   jsonb;
  v_idx     int;
  v_item    jsonb;
  v_pulled  numeric;
  v_new_qty numeric;
  rec       record;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  if not public.has_perm('jobs_pull') then
    raise exception 'You do not have permission to pull inventory for jobs.' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'object' or p_items = '{}'::jsonb then
    raise exception 'No materials to pull were provided.' using errcode = '22004';
  end if;

  -- Lock the job for the rest of this transaction so two people pulling added
  -- materials on the same job at once can't race each other.
  select * into job_rec
  from public.jobs
  where company_id = co and id = p_job_id
  for update;

  if not found then
    raise exception 'Job % not found in your company (it may have been deleted).', p_job_id
      using errcode = 'P0002';
  end if;

  if job_rec.status not in ('active', 'completed') then
    raise exception 'Materials can only be pulled this way for a job that has already had its initial pull and is not yet closed (this one is "%").',
      coalesce(job_rec.status, 'null') using errcode = '42501';
  end if;

  v_items := coalesce(job_rec.items, job_rec.materials, '[]'::jsonb);

  for v_iid, v_patch in
    select key, value from jsonb_each(p_items)
  loop
    select ord - 1 into v_idx
    from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
    where elem->>'iid' = v_iid;

    if v_idx is null then
      raise exception 'Item % is not on this job.', v_iid using errcode = '22004';
    end if;

    v_item   := v_items -> v_idx;
    v_pulled := coalesce((v_item->>'pulled')::numeric, 0);

    if v_pulled <> 0 then
      raise exception 'Item % on this job already has materials pulled — this action is only for a line nothing has been pulled for yet.', v_iid
        using errcode = '22023';
    end if;

    v_new_qty := coalesce((v_patch->>'pulled')::numeric, 0);
    if v_new_qty <= 0 then
      raise exception 'Quantity to pull for item % must be greater than zero.', v_iid using errcode = '22004';
    end if;

    v_item := v_item || jsonb_build_object(
      'pulled',      v_new_qty,
      'pulledAt',    coalesce(v_patch->>'pulledAt', to_char(current_date, 'YYYY-MM-DD')),
      'priceAtPull', coalesce((v_patch->>'priceAtPull')::numeric, 0),
      'pullCost',    coalesce((v_patch->>'pullCost')::numeric, 0),
      'consumed',    coalesce(v_patch->'consumed', '[]'::jsonb)
    );
    v_items := jsonb_set(v_items, array[v_idx::text], v_item);

    v_summary := v_summary || jsonb_build_array(jsonb_build_object(
      'iid', v_iid, 'pulled', v_new_qty
    ));
  end loop;

  update public.jobs
     set items = v_items,
         materials = v_items
   where company_id = co and id = p_job_id;

  -- Only the touched inventory rows get written — see commit_job_materials
  -- (14) for why: writing a stale in-memory copy of every row here would
  -- overwrite stock another device received or pulled since this session
  -- loaded.
  for rec in select key as item_id, value as batches from jsonb_each(p_batches)
  loop
    update public.inventory
       set batches = rec.batches
     where company_id = co and id = rec.item_id;

    if not found then
      -- Rolls back the job update too — the entire point of this function.
      raise exception 'Inventory item % not found in your company.', rec.item_id
        using errcode = 'P0002';
    end if;
  end loop;

  return jsonb_build_object('job_id', p_job_id, 'pulls', v_summary);
end;
$$;

grant execute on function public.pull_added_job_materials(text, jsonb, jsonb) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Function exists and is SECURITY INVOKER (blank security_type, not DEFINER):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'pull_added_job_materials';
--
--   prosecdef must be false.
--
-- 2. Pick a real active or completed (not closed) job in your own company
--    that has a line with pulled = 0, and dry-run inside a transaction you
--    roll back:
--
--   begin;
--   select public.pull_added_job_materials(
--     '<a job id>',
--     '{"<an inventory item id on that job, pulled = 0>": {"pulled": 1, "priceAtPull": 0, "pullCost": 0, "consumed": []}}'::jsonb
--   );
--   rollback;
--
--   Confirm the returned jsonb has the shape { job_id, pulls: [...] }.
--
-- 3. Confirm the guard: call it a second time (for real, not rolled back) on
--    a line that already has pulled > 0 — the SAME line just populated, or
--    any line that went through the job's normal initial pull. It should
--    raise 22023, not silently overwrite.
