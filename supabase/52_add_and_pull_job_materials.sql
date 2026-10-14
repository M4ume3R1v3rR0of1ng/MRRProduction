-- Phase 52 — let a job that has already been pulled take ON more material:
-- put the line on the job and pull the stock for it in one transaction, from
-- the screen the people who pull material actually stand at.
--
-- Run after 51. Idempotent.
--
-- THE PROBLEM
--
-- A crew gets to the site, opens the truck, and needs twenty more feet of coil
-- than the job was planned for. Today that is a dead end, and the workaround on
-- record is to BUILD A SECOND JOB for the same roof (PO 22357 is one of them),
-- which splits one job's material, labour and margin across two records that
-- nothing ever joins back together.
--
-- The capability is already here. It is only unreachable:
--
--   * commit_job_materials (14) — the initial pull — only runs on an `approved`
--     job, and pulling flips it to `active` in the same write. The button is
--     gone long before anyone is standing on the roof.
--   * pull_added_job_materials (36) does exactly the right thing for a line
--     already sitting at pulled = 0. But the only route to it is the "Pull Added
--     Materials" button inside Edit Job in Build Jobs, and reaching that needs
--     `jobs_build` twice over: /buildjobs is gated on it (src/App.jsx) and so is
--     the Edit Job button (BuildJobsView). Of the roles in
--     src/shared/database/permissions.js, `warehouse` and `field` are the two
--     that hold jobs_pull — the people who pull the material — and NEITHER has
--     jobs_build. The RPC would accept them; nothing in their app can ask it.
--   * worse: the Pull screen's own Edit Job (gated `jobs_edit_pull`, which
--     `field` does have) can append a material line to an active job, and offers
--     no way to pull it. The line saves at pulled = 0 — planned on the job,
--     never deducted from stock, never costed — and looks to the person who did
--     it like it worked.
--
-- So 36's guard and its arithmetic stay exactly as they are. What was missing is
-- a function that also does the half the warehouse cannot do today, which is
-- getting the line onto the job at all.
--
-- WHY ONE FUNCTION AND NOT TWO CALLS
--
-- "Add the line, then pull it" is two writes, and the gap between them is the
-- failure this whole series keeps closing: a line appended and then not pulled
-- is precisely the orphan described above, and a pull written against a line
-- that was not appended is a 'not on this job' error after the stock has already
-- left. One transaction or neither — the same call 14, 35, 36 and 51 all make.
--
-- WHY THE NEW LINE IS BUILT HERE AND NOT ACCEPTED FROM THE CALLER
--
-- Unlike the pull fields, the line's identity is not something the client has to
-- compute — `iname`, `icat` and `unit` are columns on the inventory row this
-- function is already reading to prove the item exists. Taking them from there
-- rather than from the payload means a job line can never disagree with the
-- item it points at, and a caller cannot invent a line for an item that is not
-- in its own company. The FIFO fields (priceAtPull, pullCost, consumed) still
-- come from the caller, on the same trust basis and for the same reason 36 set
-- out: doFifo (src/shared/utils/helpers.js) already computes them, is exercised
-- on every pull, and re-deriving it in plpgsql would be a second implementation
-- to keep in step with the first for no safety gain.
--
-- WHY A NEW LINE GETS planned = pulled
--
-- The alternative is planned = 0, which reads as "material went out that was
-- never planned for" and is how lineAnomaly (src/features/jobs/pullReview.js)
-- classifies `off_plan`. That would be honest on the first day and useless by
-- the second: every legitimate add-on would sit on the pull review list forever,
-- which is exactly the noise that module's own header warns makes the list worth
-- ignoring. Adding material to a job's requirements IS a revision of the plan,
-- so the plan moves with it, and the fact that it happened after the pull is
-- recorded where it cannot be argued with instead — see the stamp below.
--
-- An EXISTING line's `planned` is deliberately left alone. That number was
-- approved; pulling more than it says is a real anomaly and should keep showing
-- up as one.
--
-- WHY THE STAMP IS ON THE LINE
--
-- Same reasoning as 51's `pullCorrection`, and the batch `ref` before it:
-- audit_logs has this too, and audit_logs is purged at 30 days. `addedAfterPull`
-- stays on the job line for as long as the job exists, so six months from now
-- the job still shows which material was not in the original scope and who put
-- it there — which is the question somebody reconciling a margin will actually
-- ask.
--
-- WHY p_batches MAY NOT NAME AN ITEM p_lines DOES NOT
--
-- `p_batches` entries are full replacement arrays, same as 14/36/51 accept, and
-- a replacement array is absolute: whatever is in it becomes that item's stock.
-- A key in p_batches with no matching key in p_lines is therefore a wholesale
-- overwrite of an inventory row this call has no business touching, and there is
-- no legitimate caller that needs one — the client builds both maps from the
-- same list of requests. Refused rather than tolerated, which is a guard 36 and
-- 14 could stand to grow too.
--
-- WHY jobs_pull
--
-- The whole point. This is a pull, done by the people who pull, and gating it on
-- jobs_build or jobs_edit_pull would reproduce the exact escalation the function
-- exists to remove — see 51's header, which makes the same argument for the same
-- reason.
--
-- ⚠️ NOTE FOR THE UI THAT CALLS THIS: it belongs on the job card and the job
--    detail drawer on the Pull Inventory screen, under `jobs_pull`. NOT inside
--    Edit Job, which is where 36 ended up and why 36 is unreachable for the two
--    roles that need it.
--
-- WHY NOT closed
--
-- Same boundary 35, 36 and 51 all draw, and the app's own: a closed job's
-- material buttons are hidden. Reopen it first (jobs_close) if a closed job
-- genuinely needs more material.
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same reason as every other
--    function in this series: as DEFINER, RLS would stop applying and the tenant
--    boundary would be gone. Every statement below is additionally scoped by
--    company_id so the function stays correct even if that ever changes.

begin;

create or replace function public.add_and_pull_job_materials(
  p_job_id  text,
  -- { "<inventory item id>": { "pulled": n, "planned": n (new lines only),
  --     "pulledAt": "YYYY-MM-DD", "priceAtPull": n, "pullCost": n,
  --     "consumed": [...] }, … }
  p_lines   jsonb,
  -- batches for the items in p_lines — full replacement arrays, same shape
  -- 14/36/51 accept. Every key must also appear in p_lines.
  p_batches jsonb default '{}'::jsonb,
  p_by_name text default null,
  p_reason  text default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  co        uuid := public.active_company_id();
  job_rec   public.jobs%rowtype;
  v_items   jsonb;
  v_added   jsonb := '[]'::jsonb;
  v_pulls   jsonb := '[]'::jsonb;
  v_stamp   jsonb;
  v_iid     text;
  v_patch   jsonb;
  v_idx     int;
  v_item    jsonb;
  v_qty     numeric;
  v_planned numeric;
  inv_rec   record;
  rec       record;
begin
  if co is null then
    raise exception 'No active company for this session.' using errcode = '42501';
  end if;

  if not public.has_perm('jobs_pull') then
    raise exception 'You do not have permission to pull inventory for jobs.' using errcode = '42501';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) is distinct from 'object' or p_lines = '{}'::jsonb then
    raise exception 'No materials to add were provided.' using errcode = '22004';
  end if;

  -- See "WHY p_batches MAY NOT NAME AN ITEM p_lines DOES NOT". Checked before
  -- anything is written, so a caller that got this wrong is told rather than
  -- half-applied.
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_batches, '{}'::jsonb)) as b(k)
    where b.k not in (select jsonb_object_keys(p_lines))
  ) then
    raise exception 'Stock was supplied for an item that is not part of this request.'
      using errcode = '22023';
  end if;

  -- Lock the job for the rest of this transaction so two people adding material
  -- to the same job at once can't race each other.
  select * into job_rec
  from public.jobs
  where company_id = co and id = p_job_id
  for update;

  if not found then
    raise exception 'Job % not found in your company (it may have been deleted).', p_job_id
      using errcode = 'P0002';
  end if;

  if job_rec.status not in ('active', 'completed') then
    raise exception 'Material can only be added this way to a job that has already had its materials pulled and is not yet closed (this one is "%").',
      coalesce(job_rec.status, 'null') using errcode = '42501';
  end if;

  v_items := coalesce(job_rec.items, job_rec.materials, '[]'::jsonb);

  -- One stamp for the whole call: everything in this request happened in the
  -- same act, by the same person, for the same reason.
  v_stamp := jsonb_build_object(
    'by',     auth.uid()::text,
    'byName', p_by_name,
    'reason', p_reason,
    'at',     now()::text
  );

  for v_iid, v_patch in
    select key, value from jsonb_each(p_lines)
  loop
    v_qty := coalesce((v_patch->>'pulled')::numeric, 0);
    if v_qty <= 0 then
      raise exception 'Quantity to pull for item % must be greater than zero.', v_iid
        using errcode = '22004';
    end if;

    -- Proves the item is a real inventory row in THIS company, and supplies the
    -- name/category/unit a new line is built from. Read whether the line is new
    -- or not: an item that has since been deleted should not be pulled against
    -- either way.
    select id, name, cat, unit into inv_rec
    from public.inventory
    where company_id = co and id = v_iid;

    if not found then
      raise exception 'Inventory item % not found in your company.', v_iid
        using errcode = 'P0002';
    end if;

    select ord - 1 into v_idx
    from jsonb_array_elements(v_items) with ordinality as t(elem, ord)
    where elem->>'iid' = v_iid;

    if v_idx is null then
      -- Not on the job yet: this is the half 36 cannot do. The line is built
      -- field by field from the inventory row and the known pull fields, so a
      -- payload cannot smuggle in anything else.
      v_planned := coalesce((v_patch->>'planned')::numeric, v_qty);
      if v_planned < v_qty then
        -- Nothing in the app sends this, and letting it through would create a
        -- line that reports itself as over-plan the moment it is written.
        raise exception 'A material being added to this job cannot be planned for less than the quantity being pulled (item %).', v_iid
          using errcode = '22023';
      end if;

      v_item := jsonb_build_object(
        'iid',            v_iid,
        'iname',          inv_rec.name,
        'icat',           inv_rec.cat,
        'unit',           inv_rec.unit,
        'planned',        v_planned,
        'returned',       0,
        'pulled',         v_qty,
        'pulledAt',       coalesce(v_patch->>'pulledAt', to_char(current_date, 'YYYY-MM-DD')),
        'priceAtPull',    coalesce((v_patch->>'priceAtPull')::numeric, 0),
        'pullCost',       coalesce((v_patch->>'pullCost')::numeric, 0),
        'consumed',       coalesce(v_patch->'consumed', '[]'::jsonb),
        'addedAfterPull', v_stamp
      );
      v_items := v_items || jsonb_build_array(v_item);

      v_added := v_added || jsonb_build_array(jsonb_build_object(
        'iid',     v_iid,
        'iname',   inv_rec.name,
        'icat',    inv_rec.cat,
        'unit',    inv_rec.unit,
        'planned', v_planned,
        'pulled',  v_qty
      ));
    else
      -- Already on the job. Same guard 36 enforces, for the same reason: this
      -- can only ever populate a line nothing has gone out for yet, never
      -- quietly overwrite a quantity that has. Correcting one that has is
      -- correct_job_pull's job (51).
      v_item := v_items -> v_idx;

      if coalesce((v_item->>'pulled')::numeric, 0) <> 0 then
        raise exception 'Item % on this job already has materials pulled. To change that quantity use Correct Pulled Materials; this is only for material that has not gone out yet.', v_iid
          using errcode = '22023';
      end if;

      v_item := v_item || jsonb_build_object(
        'pulled',         v_qty,
        'pulledAt',       coalesce(v_patch->>'pulledAt', to_char(current_date, 'YYYY-MM-DD')),
        'priceAtPull',    coalesce((v_patch->>'priceAtPull')::numeric, 0),
        'pullCost',       coalesce((v_patch->>'pullCost')::numeric, 0),
        'consumed',       coalesce(v_patch->'consumed', '[]'::jsonb),
        'addedAfterPull', v_stamp
      );
      v_items := jsonb_set(v_items, array[v_idx::text], v_item);
    end if;

    v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
      'iid', v_iid, 'pulled', v_qty
    ));
  end loop;

  update public.jobs
     set items = v_items,
         materials = v_items
   where company_id = co and id = p_job_id;

  -- Only the touched inventory rows, same as 14, 36 and 51: writing a stale
  -- in-memory copy of every row here would overwrite stock another device
  -- received or pulled since that session loaded.
  for rec in select key as item_id, value as batches from jsonb_each(coalesce(p_batches, '{}'::jsonb))
  loop
    update public.inventory
       set batches = rec.batches
     where company_id = co and id = rec.item_id;

    if not found then
      -- Rolls back the job update and every other item too — the entire point of
      -- this being one function.
      raise exception 'Inventory item % not found in your company.', rec.item_id
        using errcode = 'P0002';
    end if;
  end loop;

  return jsonb_build_object(
    'job_id', p_job_id,
    'added',  v_added,
    'pulls',  v_pulls
  );
end;
$$;

grant execute on function public.add_and_pull_job_materials(text, jsonb, jsonb, text, text) to authenticated, service_role;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Function exists and is SECURITY INVOKER (prosecdef must be false):
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'add_and_pull_job_materials';
--
-- 2. Dry-run an ADD inside a transaction you roll back. Pick an active job and
--    an inventory item that is NOT already on it:
--
--   begin;
--   select public.add_and_pull_job_materials(
--     '<a job id>',
--     '{"<an inventory item id NOT on that job>": {"pulled": 1, "priceAtPull": 0, "pullCost": 0, "consumed": []}}'::jsonb,
--     '{}'::jsonb, 'Test User', 'verify 52'
--   );
--   -- the new line, with planned = pulled and an addedAfterPull stamp:
--   select jsonb_pretty(items) from public.jobs where id = '<that job id>';
--   rollback;
--
--   The returned jsonb has the shape { job_id, added: [...], pulls: [...] }, and
--   each `added` entry carries the iname/icat/unit taken from the inventory row
--   rather than from the request.
--
-- 3. Dry-run the other half — an orphan line already on the job at pulled = 0
--    (the ones the Pull screen's Edit Job can create). Same call, with that
--    item's id; `added` comes back empty and `pulls` names the line.
--
-- 4. Confirm the already-pulled guard. Call it for an item whose line on that
--    job shows pulled > 0:
--
--   select public.add_and_pull_job_materials('<job id>', '{"<a pulled item id>": {"pulled": 1}}'::jsonb);
--
--   Must raise 22023 and name Correct Pulled Materials.
--
-- 5. Confirm the stray-batches guard:
--
--   select public.add_and_pull_job_materials(
--     '<job id>', '{"<item A>": {"pulled": 1}}'::jsonb, '{"<item B>": []}'::jsonb
--   );
--
--   Must raise 22023 before writing anything — and item B's stock must be
--   untouched afterwards.
--
-- 6. Confirm the status boundary. The same call against an `approved` job must
--    raise 42501 (it still has its normal Pull Materials button), and against a
--    `closed` one too.
--
-- 7. Confirm the tenant boundary: the call must raise P0002 for an inventory id
--    that exists only in another company, never append the line.
