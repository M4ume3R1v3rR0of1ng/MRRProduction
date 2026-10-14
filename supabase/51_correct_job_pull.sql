-- Phase 51 — let a wrong material PULL be corrected: back the stock out to the
-- batches it actually came from, and (optionally) pull the right item instead,
-- in one transaction.
--
-- Run after 50. Idempotent.
--
-- THE PROBLEM
--
-- Three functions already correct a job's materials after the fact, and none of
-- them can touch `pulled`:
--
--   * commit_job_materials (14) is the initial pull. The button that reaches it
--     only renders on an `approved` job (PullInventoryView.jsx), and pulling
--     flips the job to `active` in the same write — so the button is gone the
--     instant the mistake exists.
--   * pull_added_job_materials (36) refuses any line where pulled <> 0. It is
--     for a line nothing has gone out for yet.
--   * correct_job_return (35) only ever writes `returned`, and says so in its
--     own header: "this is not a general job-materials editor".
--
-- And no editor can reach it either: mergePullTracking (src/shared/utils/
-- helpers.js) re-reads the live row and stamps `pulled`, `priceAtPull`,
-- `pullCost`, `returned` and `consumed` back over whatever was edited, by
-- design, so a stale editor cannot erase a pull. The upshot is that `pulled` is
-- structurally unwritable from anywhere in the app once the pull has happened.
--
-- So when a crew pulls the WRONG ITEM — 20 of A when the job needed 20 of B —
-- the only recourse today is three manual steps across two screens and two
-- permissions: Adjust Stock to put A back, Edit Job to swap the line, then Pull
-- Added Materials for B. That works (and is the documented interim procedure)
-- but it gets three things wrong, all of which this function fixes:
--
--   1. Adjust Stock values the restored units at newestPrice (AdjustStockModal
--      line 20) — right for genuinely found stock, wrong here, where the exact
--      original per-batch prices are sitting in the line's `consumed` split.
--   2. The reversal lands as an `adjustment` in the CURRENT period rather than
--      as a reversal of the pull's own period (see movementByItem in
--      features/inventory/inventoryCounts.js). A January pull corrected in
--      February moves the swing into February.
--   3. Removing the line erases every trace the job ever had of it. audit_logs
--      has it, but that is purged at 30 days — which is the whole reason
--      confirmPull stamps the job reference onto the batch row in the first
--      place.
--
-- WHY THE UN-PULL MATH IS SERVER-SIDE, UNLIKE 36
--
-- 36 left the FIFO math in the client because doFifo already existed, is
-- exercised every day, and its output is exactly what that function needed to
-- write. There is no reverse-FIFO helper in the client, so that argument does
-- not carry over — and the authoritative input is already here: `consumed`
-- (`[{bid, rcvd, qty, price, short?}]`) is on the job row, recorded by doFifo
-- for precisely this purpose ("makes a batch price correction exact rather than
-- a guess"). The server needs nothing from the caller but the corrected
-- quantity, so a caller cannot fabricate a credit and resurrect stock that was
-- never pulled. That is the same call 35 made, for the same reason.
--
-- Credits unwind in REVERSE FIFO order — the last batch the pull touched is the
-- first one credited back. Un-pulling 5 of a pull that took 10 from batch1 then
-- 5 from batch2 puts 5 back into batch2, not batch1.
--
-- A shortfall row (doFifo's synthetic `short: true` batch, qty and rem both
-- negative) is credited the same way, and deleted outright once it reaches
-- zero: it recorded stock that was never there, so un-pulling it means the
-- deficit never happened, and leaving a 0/0 row behind would show up in the
-- `shortfall` bucket of every later count.
--
-- WHY IT REFUSES TO INCREASE A PULL
--
-- Raising `pulled` is a fresh FIFO deduction, which is doFifo's job, not a
-- re-derivation of it in plpgsql — the second implementation 36 explicitly
-- declined to write. Un-pull the line to zero and use Pull Added Materials,
-- which accepts exactly that state. The error message says so.
--
-- WHY AN ITEM MAY NOT APPEAR ON BOTH SIDES
--
-- The un-pull side computes batches HERE, from `consumed`. The pull side
-- accepts client-computed batch arrays as full replacements, same as 36 and 14.
-- Those two cannot both write one inventory row: the client's array was
-- computed against batches read BEFORE this function credited anything back, so
-- it would silently clobber the credit. An item on both sides is refused rather
-- than ordered, because any ordering here is a trap for the next reader. For
-- the wrong-item case the two sides are different items anyway, which is the
-- whole point.
--
-- WHY jobs_pull
--
-- Same reasoning 36 set out, and it matters more here. This is a pull being put
-- right, in substance the same action by the same people. The alternatives both
-- reproduce the exact escalation this function exists to remove: of the roles in
-- src/shared/database/permissions.js, `warehouse` — the role that pulls, and so
-- the role that mis-pulls — holds jobs_pull and NOT inv_adjust, jobs_edit_pull
-- or jobs_close. Gating on any of those three means the person who made the
-- mistake still cannot fix it.
--
-- ⚠️ NOTE FOR THE UI THAT CALLS THIS: Correct Return and Pull Added Materials
--    are both reached from inside Edit Job, which is gated on `jobs_edit_pull`
--    (PullInventoryView.jsx:1544). Putting this one there too would leave the
--    RPC callable by warehouse staff and the only route to it closed to them.
--    It belongs on the job card under `jobs_pull`.
--
-- WHY NOT closed
--
-- Same boundary 35 and 36 already draw, and the app's own: Edit Job hides its
-- material buttons on a closed job. Reopen it first (jobs_close) if a closed
-- job genuinely needs a pull corrected.
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same reason as every other
--    function in this series: as DEFINER, RLS would stop applying and the tenant
--    boundary would be gone. Every statement below is additionally scoped by
--    company_id so the function stays correct even if that ever changes.

begin;

create or replace function public.correct_job_pull(
  p_job_id  text,
  p_unpull  jsonb,                     -- { "<inventory item id>": <corrected TOTAL pulled qty, 0 to back it out entirely>, … }
  p_pull    jsonb default '{}'::jsonb, -- optional replacement lines, same shape as pull_added_job_materials (36) p_items
  p_batches jsonb default '{}'::jsonb, -- batches for the p_pull side only — full replacement arrays, same shape 14/36 accept
  p_by_name text default null,
  p_reason  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co             uuid := public.active_company_id();
  job_rec        public.jobs%rowtype;
  v_items        jsonb;
  v_credits      jsonb := '[]'::jsonb;
  v_pulls        jsonb := '[]'::jsonb;
  v_iid          text;
  v_new_qty      numeric;
  v_idx          int;
  v_item         jsonb;
  v_old_pulled   numeric;
  v_returned     numeric;
  v_consumed     jsonb;
  v_new_consumed jsonb;
  v_credit       numeric;
  v_credited     numeric;
  v_new_cost     numeric;
  inv_rec        record;
  v_batches      jsonb;
  v_ci           int;
  v_centry       jsonb;
  v_cqty         numeric;
  v_cbid         text;
  v_take         numeric;
  v_bidx         int;
  v_batch        jsonb;
  v_bqty         numeric;
  v_brem         numeric;
  v_patch        jsonb;
  v_pull_qty     numeric;
  rec            record;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  if not public.has_perm('jobs_pull') then
    raise exception 'You do not have permission to correct a job''s pulled materials.'
      using errcode = '42501';
  end if;

  if p_unpull is null or jsonb_typeof(p_unpull) is distinct from 'object' or p_unpull = '{}'::jsonb then
    raise exception 'No pull corrections were provided.' using errcode = '22004';
  end if;

  -- See "WHY AN ITEM MAY NOT APPEAR ON BOTH SIDES". Checked before anything is
  -- written, so a caller that got this wrong is told rather than half-applied.
  if exists (
    select 1 from jsonb_object_keys(p_unpull) as u(k)
    where u.k in (select jsonb_object_keys(coalesce(p_pull, '{}'::jsonb)))
       or u.k in (select jsonb_object_keys(coalesce(p_batches, '{}'::jsonb)))
  ) then
    raise exception 'An item cannot be un-pulled and pulled in the same correction. Correct its quantity instead, or do the two as separate corrections.'
      using errcode = '22023';
  end if;

  -- Lock the job for the rest of this transaction so two people correcting the
  -- same job at once can't race each other.
  select * into job_rec
  from public.jobs
  where company_id = co and id = p_job_id
  for update;

  if not found then
    raise exception 'Job % not found in your company (it may have been deleted).', p_job_id
      using errcode = 'P0002';
  end if;

  if job_rec.status not in ('active', 'completed') then
    raise exception 'Only a job that has had its materials pulled and is not yet closed can have a pull corrected (this one is "%").',
      coalesce(job_rec.status, 'null') using errcode = '42501';
  end if;

  v_items := coalesce(job_rec.items, job_rec.materials, '[]'::jsonb);

  -- ── The un-pull side ──────────────────────────────────────────────────────
  for v_iid, v_new_qty in
    select key, value::numeric from jsonb_each_text(p_unpull)
  loop
    if v_new_qty is null or v_new_qty < 0 then
      raise exception 'Corrected pulled quantity for item % must be zero or more.', v_iid
        using errcode = '22004';
    end if;

    select ord - 1 into v_idx
    from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
    where elem->>'iid' = v_iid;

    if v_idx is null then
      raise exception 'Item % is not on this job.', v_iid using errcode = '22004';
    end if;

    v_item       := v_items -> v_idx;
    v_old_pulled := coalesce((v_item->>'pulled')::numeric, 0);
    v_returned   := coalesce((v_item->>'returned')::numeric, 0);

    if v_old_pulled <= 0 then
      raise exception 'Nothing was pulled for item % on this job, so there is no pull to correct. Use Pull Added Materials to pull it.', v_iid
        using errcode = '22023';
    end if;

    if v_new_qty > v_old_pulled then
      raise exception 'This can only reduce a pull (item % is at %, % requested). To pull MORE, correct this line to 0 first and then use Pull Added Materials.',
        v_iid, v_old_pulled, v_new_qty using errcode = '22023';
    end if;

    -- The returned units are already sitting back in stock under the
    -- ret_<job>_<item> batch, which this function deliberately does not touch.
    -- Reducing `pulled` below `returned` would leave the job claiming more came
    -- back than ever went out, and 35 would then refuse to clean it up.
    if v_new_qty < v_returned then
      raise exception 'Item % already shows % returned, so its pull cannot be corrected below that. Correct the return first (Correct Returned Materials), then come back.',
        v_iid, v_returned using errcode = '22023';
    end if;

    -- A no-op line is skipped rather than refused, so a caller can send the
    -- whole list and let the ones that did not change fall through.
    continue when v_new_qty = v_old_pulled;

    v_consumed := coalesce(v_item->'consumed', '[]'::jsonb);

    -- Rows written before doFifo recorded the per-batch split have no breakdown
    -- to credit against, and guessing is exactly what `consumed` exists to stop.
    -- recostLine draws the same line for the same reason.
    if jsonb_typeof(v_consumed) is distinct from 'array' or jsonb_array_length(v_consumed) = 0 then
      raise exception 'Item % on this job has no record of which batches its material came from (an older pull), so it cannot be credited back exactly. Adjust that item''s stock by hand instead.', v_iid
        using errcode = '22023';
    end if;

    -- Lock the inventory row for the rest of this transaction.
    select id, batches into inv_rec
    from public.inventory
    where company_id = co and id = v_iid
    for update;

    if not found then
      raise exception 'Inventory item % not found in your company.', v_iid
        using errcode = 'P0002';
    end if;

    v_batches      := coalesce(inv_rec.batches, '[]'::jsonb);
    v_credit       := v_old_pulled - v_new_qty;
    v_credited     := 0;
    v_new_consumed := '[]'::jsonb;

    -- Newest-consumed first. Prepending the survivors as we go down rebuilds the
    -- list in its original FIFO order.
    for v_ci in reverse jsonb_array_length(v_consumed) - 1 .. 0
    loop
      v_centry := v_consumed -> v_ci;
      v_cqty   := coalesce((v_centry->>'qty')::numeric, 0);
      v_cbid   := v_centry->>'bid';
      v_take   := least(v_credit, v_cqty);

      if v_take > 0 then
        if v_cbid is null then
          raise exception 'Item %''s pull history has an entry with no batch id, so it cannot be credited back exactly. Adjust that item''s stock by hand instead.', v_iid
            using errcode = '22023';
        end if;

        select ord - 1 into v_bidx
        from jsonb_array_elements(v_batches) with ordinality as t(elem, ord)
        where elem->>'id' = v_cbid;

        if v_bidx is null then
          raise exception 'The batch % that item % was pulled from no longer exists, so % cannot be credited back to it. Adjust that item''s stock by hand instead.',
            v_cbid, v_iid, v_take using errcode = '22023';
        end if;

        v_batch := v_batches -> v_bidx;
        v_bqty  := coalesce((v_batch->>'qty')::numeric, 0);
        v_brem  := coalesce((v_batch->>'rem')::numeric, 0);

        if coalesce((v_batch->>'short')::boolean, false) then
          -- Shortfall row: qty and rem are both negative and move together back
          -- toward zero. Crossing zero would mean crediting more than the pull
          -- ever took short, which is a corrupt `consumed` split, not a
          -- correction.
          if v_bqty + v_take > 0 or v_brem + v_take > 0 then
            raise exception 'The shortfall record for item % does not match its pull history, so it cannot be credited back safely. Adjust that item''s stock by hand instead.', v_iid
              using errcode = '22023';
          end if;
          v_batch := v_batch || jsonb_build_object('qty', v_bqty + v_take, 'rem', v_brem + v_take);
        else
          -- rem can legitimately sit below qty (a later pull or a stock
          -- adjustment took units). It can never legitimately exceed it, so
          -- that means this credit has already been applied once.
          if v_brem + v_take > v_bqty then
            raise exception 'Batch % of item % cannot take % back — it only ever held %, and % is already on the shelf. This correction looks to have been applied already.',
              v_cbid, v_iid, v_take, v_bqty, v_brem using errcode = '22023';
          end if;
          v_batch := v_batch || jsonb_build_object('rem', v_brem + v_take);
        end if;

        v_batch := v_batch || jsonb_build_object(
          'pullCorrection', jsonb_build_object(
            'jobId',    p_job_id,
            'credited', v_take,
            'prevRem',  v_brem,
            'by',       auth.uid()::text,
            'byName',   p_by_name,
            'reason',   p_reason,
            'at',       now()::text
          )
        );
        v_batches  := jsonb_set(v_batches, array[v_bidx::text], v_batch);
        v_credit   := v_credit - v_take;
        v_credited := v_credited + v_take;
      end if;

      if v_cqty - v_take > 0 then
        v_new_consumed :=
          jsonb_build_array(v_centry || jsonb_build_object('qty', v_cqty - v_take)) || v_new_consumed;
      end if;
    end loop;

    -- The split is the only record of where the material came from, so if it
    -- does not add up to `pulled` there is nothing to fall back on.
    if v_credit > 0 then
      raise exception 'Item %''s pull history only accounts for % of the % that needs crediting back, so the remaining % cannot be returned to stock exactly. Adjust that item''s stock by hand instead.',
        v_iid, v_credited, v_old_pulled - v_new_qty, v_credit
        using errcode = '22023';
    end if;

    -- A shortfall row credited back to zero recorded stock that was never there.
    -- Un-pulling it means the deficit never happened, and a 0/0 row left behind
    -- would keep showing up in movementByItem's `shortfall` bucket forever.
    select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb) into v_batches
    from jsonb_array_elements(v_batches) with ordinality as t(elem, ord)
    where not (
      coalesce((elem->>'short')::boolean, false)
      and coalesce((elem->>'qty')::numeric, 0) = 0
      and coalesce((elem->>'rem')::numeric, 0) = 0
    );

    update public.inventory
       set batches = v_batches
     where company_id = co and id = v_iid;

    -- Same arithmetic recostLine does, for the same reason: the surviving units
    -- keep the price they were actually bought at, so the line's cost stays
    -- exact instead of collapsing to a blended average.
    select coalesce(sum(
             coalesce((e->>'qty')::numeric, 0) * coalesce((e->>'price')::numeric, 0)
           ), 0)
      into v_new_cost
    from jsonb_array_elements(v_new_consumed) as t(e);

    v_item := v_item || jsonb_build_object(
      'pulled',      v_new_qty,
      'consumed',    v_new_consumed,
      'pullCost',    v_new_cost,
      'priceAtPull', case when v_new_qty > 0 then v_new_cost / v_new_qty else 0 end,
      -- Kept on the line rather than only in audit_logs, which is purged at 30
      -- days. A line corrected to 0 stays on the job carrying this stamp, so the
      -- job still shows that the material went out and came back.
      'pullCorrection', jsonb_build_object(
        'prevPulled', v_old_pulled,
        'by',         auth.uid()::text,
        'byName',     p_by_name,
        'reason',     p_reason,
        'at',         now()::text
      )
    );
    -- `pulledAt` is deliberately left alone: the material did leave on that day,
    -- and inventoryCounts files the (now smaller) usage in the period it
    -- actually happened rather than this one. A line corrected to 0 contributes
    -- nothing either way, and Pull Added Materials restamps it if the line is
    -- later pulled for real.
    v_items := jsonb_set(v_items, array[v_idx::text], v_item);

    v_credits := v_credits || jsonb_build_array(jsonb_build_object(
      'iid',         v_iid,
      'old_pulled',  v_old_pulled,
      'new_pulled',  v_new_qty,
      'credited',    v_credited,
      'pullCost',    v_new_cost,
      'priceAtPull', case when v_new_qty > 0 then v_new_cost / v_new_qty else 0 end,
      'consumed',    v_new_consumed
    ));
  end loop;

  -- ── The replacement pull side (optional) ──────────────────────────────────
  -- Deliberately identical in shape and guards to pull_added_job_materials (36):
  -- a line must currently show pulled = 0, and only the five known pull fields
  -- are merged on by an explicit jsonb_build_object, so a payload cannot smuggle
  -- in a change to some other field.
  if p_pull is not null and jsonb_typeof(p_pull) = 'object' and p_pull <> '{}'::jsonb then
    for v_iid, v_patch in
      select key, value from jsonb_each(p_pull)
    loop
      select ord - 1 into v_idx
      from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
      where elem->>'iid' = v_iid;

      if v_idx is null then
        raise exception 'Item % is not on this job.', v_iid using errcode = '22004';
      end if;

      v_item := v_items -> v_idx;

      if coalesce((v_item->>'pulled')::numeric, 0) <> 0 then
        raise exception 'Item % on this job already has materials pulled — the replacement side of a correction is only for a line nothing has gone out for yet.', v_iid
          using errcode = '22023';
      end if;

      v_pull_qty := coalesce((v_patch->>'pulled')::numeric, 0);
      if v_pull_qty <= 0 then
        raise exception 'Quantity to pull for item % must be greater than zero.', v_iid
          using errcode = '22004';
      end if;

      v_item := v_item || jsonb_build_object(
        'pulled',      v_pull_qty,
        'pulledAt',    coalesce(v_patch->>'pulledAt', to_char(current_date, 'YYYY-MM-DD')),
        'priceAtPull', coalesce((v_patch->>'priceAtPull')::numeric, 0),
        'pullCost',    coalesce((v_patch->>'pullCost')::numeric, 0),
        'consumed',    coalesce(v_patch->'consumed', '[]'::jsonb)
      );
      v_items := jsonb_set(v_items, array[v_idx::text], v_item);

      v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
        'iid', v_iid, 'pulled', v_pull_qty
      ));
    end loop;
  end if;

  update public.jobs
     set items = v_items,
         materials = v_items
   where company_id = co and id = p_job_id;

  -- Only the touched inventory rows, same as 14 and 36: writing a stale
  -- in-memory copy of every row here would overwrite stock another device
  -- received or pulled since that session loaded. The overlap guard at the top
  -- is what keeps these writes off the rows the un-pull side just credited.
  for rec in select key as item_id, value as batches from jsonb_each(coalesce(p_batches, '{}'::jsonb))
  loop
    update public.inventory
       set batches = rec.batches
     where company_id = co and id = rec.item_id;

    if not found then
      -- Rolls back the job update and every credit above too — the entire point
      -- of this being one function.
      raise exception 'Inventory item % not found in your company.', rec.item_id
        using errcode = 'P0002';
    end if;
  end loop;

  return jsonb_build_object(
    'job_id',      p_job_id,
    'corrections', v_credits,
    'pulls',       v_pulls
  );
end;
$$;

grant execute on function public.correct_job_pull(text, jsonb, jsonb, jsonb, text, text) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Function exists and is SECURITY INVOKER (prosecdef must be false):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'correct_job_pull';
--
-- 2. Dry-run a reduction inside a transaction you roll back. Pick an active or
--    completed (not closed) job with a line that has pulled > 0 AND a non-empty
--    `consumed` array — an older pull without one is refused on purpose:
--
--   begin;
--   select public.correct_job_pull(
--     '<a job id>', '{"<an inventory item id on that job>": 0}'::jsonb,
--     '{}'::jsonb, '{}'::jsonb, 'Test User', 'verify 51'
--   );
--   -- the credited batches, back on the shelf at their ORIGINAL prices:
--   select id, jsonb_pretty(batches) from public.inventory where id = '<that item id>';
--   rollback;
--
--   The returned jsonb has the shape { job_id, corrections: [...], pulls: [...] },
--   and each corrections entry carries old_pulled, new_pulled and credited.
--
-- 3. Confirm the double-apply guard. Run the SAME correction twice for real (not
--    rolled back). The second call must raise 22023 — on the first pass the line
--    is at pulled = 0, so it is "Nothing was pulled for item %"; correct a line
--    only PART of the way down and repeat to see the batch-level guard
--    ("cannot take % back") instead.
--
-- 4. Confirm the increase is refused, not silently applied:
--
--   select public.correct_job_pull('<job id>', '{"<item id>": 999999}'::jsonb);
--
--   Must raise 22023 and name Pull Added Materials.
--
-- 5. Confirm the overlap guard:
--
--   select public.correct_job_pull(
--     '<job id>', '{"<item id>": 0}'::jsonb, '{"<THE SAME item id>": {"pulled": 1}}'::jsonb
--   );
--
--   Must raise 22023 before writing anything.
--
-- 6. Confirm the return guard. On a completed job whose line shows returned > 0,
--    correcting that line's pull below `returned` must raise 22023 and point at
--    Correct Returned Materials.
