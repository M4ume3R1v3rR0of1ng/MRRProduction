-- Phase 57 — let a line that has ALREADY been pulled take on more: pull the
-- extra stock onto the same line, instead of sending the warehouse round a loop
-- between two screens that each point at the other.
--
-- Run after 52. Idempotent. Replaces add_and_pull_job_materials in place; no
-- new function, no signature change, no data migration.
--
-- THE REPORT
--
--   "I can not add in more material once I pulled them. Job 22598 I pulled 6
--    osb but now I need 9 more and can not add them on. Why not?"
--
-- Because of two guards that are each defensible on their own and together form
-- a closed circle. For a line sitting at pulled = 6:
--
--   * add_and_pull_job_materials (52:271) refuses it — "already has materials
--     pulled. To change that quantity use Correct Pulled Materials" — and the UI
--     agrees before the call is even made: orphanLines() keeps only lines at
--     pulled = 0 and addableForPull() drops anything already on the job, so OSB
--     appears in NEITHER half of the Need More Materials dialog. The item the
--     crew needs is simply not on the screen.
--   * correct_job_pull (51:228) refuses it the other way — "This can only reduce
--     a pull ... To pull MORE, correct this line to 0 first and then use Pull
--     Added Materials" — and CorrectPullModal marks the row `increase` and
--     blocks the save.
--
-- So the documented route is: un-pull all 6 (crediting them back to the exact
-- batches they came from), then pull 15 fresh. Three things wrong with it:
--
--   1. Nobody finds it. Two dialogs, in the right order, with a quantity of 0
--      typed into the first — and the only thing telling you so is a hint inside
--      the screen that just refused you. The boss did not find it, and he
--      already knew the feature existed.
--   2. It is lossy. The job's history ends up reading as "6 un-pulled, 15
--      pulled" when what happened is "9 more went out". The first pull's date and
--      its batch split are destroyed and rebuilt, and `pullCorrection` claims a
--      correction that never happened.
--   3. For an older pull it is not available at ALL. 51 refuses any line whose
--      `consumed` split is missing (51:251, hasBatchHistory) because it cannot
--      credit stock back exactly — which closes the only door out of the circle
--      and leaves "adjust the stock by hand" as the answer to "this roof needs
--      nine more sheets".
--
-- THE FIX, AND WHY IT IS THIS ONE
--
-- A top-up is not a correction and it is not a new line. It is a SECOND PULL
-- against a line that already has one, and that is a thing the data model can
-- already hold: `consumed` is an array of per-batch draws, so a second draw
-- appends to it. Nothing has to be undone, so nothing is lost, and a line with
-- no batch history can still be topped up — the new units get their own exact
-- split even though the old ones never had one.
--
-- So 52's `else` branch stops refusing and starts accumulating:
--
--   pulled       += the quantity pulled now
--   pullCost     += the cost of the units pulled now
--   priceAtPull   = pullCost / pulled — the blended rate, which is exactly what
--                   recostLine (helpers.js:385) already defines it to be and what
--                   every cost readout in the Pull screen multiplies by
--   consumed      = old draws || new draws, in order
--   pulledAt      UNTOUCHED. The line's first pull is when its material started
--                 leaving the building; the top-up's own date is in its stamp.
--
-- WHY `planned` MOVES THIS TIME
--
-- 52 said an existing line's `planned` is deliberately left alone, because
-- "that number was approved; pulling more than it says is a real anomaly and
-- should keep showing up as one." That was written about an ORPHAN line — plan
-- 10, someone pulls 14, nobody said otherwise: a real anomaly.
--
-- A top-up is the other thing. Somebody has deliberately opened a dialog called
-- Need More Materials, typed nine, and been asked why. That is a revision of
-- what the job needs, which is word for word the case 52 made for a new line:
-- "Adding material to a job's requirements IS a revision of the plan, so the
-- plan moves with it, and the fact that it happened after the pull is recorded
-- where it cannot be argued with instead."
--
-- Leaving `planned` at 6 against a `pulled` of 15 would park this job on the
-- pull review list forever, flagged `over` — the label for a mistake — for a
-- decision that was made on purpose and explained in writing. That is the exact
-- noise pullReview.js's own header warns makes the list worth ignoring.
--
-- So planned becomes greatest(planned, the new total), never lower:
--
--   planned 6,  pulled 6 + 9  -> planned 15. The requirement really did grow.
--   planned 20, pulled 6 + 9  -> planned 20. Still inside what was approved;
--                                there was nothing to revise.
--
-- and the number that WAS approved survives on the stamp as `prevPlanned`, so
-- "we approved 6 and the roof ate 15" stays answerable six months from now.
--
-- WHY THE STAMP IS AN ARRAY
--
-- `addedAfterPull` (52) and `pullCorrection` (51) are single objects: last one
-- wins. That is fine for them — a line is added to a job once.
--
-- A roof can come up short twice. Overwriting would mean the second top-up
-- erases the first one's reason, quantity and author, which is the half of the
-- record a margin reconciliation actually reads. `toppedUp` is therefore an
-- array, appended to, one entry per top-up:
--
--   { by, byName, reason, at, qty, prevPulled, newPulled, prevPlanned }
--
-- On the line rather than only in audit_logs for the same reason as every other
-- stamp in this series: audit_logs is purged at 30 days and the job outlives it.
--
-- WHAT THE REPLY NOW CARRIES
--
-- `pulls` entries grow from { iid, pulled } to the resulting line's real
-- numbers, so the client can show the new total without recomputing it:
--
--   { iid, qty, pulled, prevPulled, planned, prevPlanned, pullCost,
--     priceAtPull, pulledAt, consumed, topUp }
--
-- `qty` is what went out in THIS call; `pulled` is the line's total afterwards.
-- In 52 the one field named `pulled` meant the former, and the client ignored it
-- (AddPullMaterialsModal only read `.iid` off these entries), so widening it
-- breaks no caller that is already deployed.
--
-- The orphan path (pulled = 0) is now the accumulate path with nothing to add
-- to, and comes out where 52 left it: 0 + qty, [] || draws, 0 + cost, its own
-- `pulledAt` and its `addedAfterPull` stamp.
--
-- `planned` is the one thing that does NOT follow the top-up rule there, and the
-- distinction is the whole reason the two sub-branches exist. An orphan line
-- pulled past its plan is 52's anomaly — nobody declared anything, the number
-- just came out high — and the dialog stops to confirm it (overPullRows). So its
-- plan is left exactly as approved, and `toppedUp` is written only when
-- something had already gone out.
--
-- NOT CHANGED HERE: 51's refusal message still names the old two-step route.
-- Rewriting a 400-line function to edit one string is not worth the diff — the
-- text a human actually reads is CorrectPullModal's, which now points straight
-- at Need More Materials.
--
-- ⚠️ SECURITY INVOKER (the default) is load-bearing, same as every function in
--    this series: as DEFINER, RLS stops applying and the tenant boundary is
--    gone. Every statement below is additionally scoped by company_id.

begin;

create or replace function public.add_and_pull_job_materials(
  p_job_id  text,
  -- { "<inventory item id>": { "pulled": n (the quantity to pull NOW, which for
  --     a line that already has a pull is the amount to ADD to it),
  --     "planned": n (new lines only), "pulledAt": "YYYY-MM-DD",
  --     "priceAtPull": n, "pullCost": n, "consumed": [...] }, ... }
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
  co          uuid := public.active_company_id();
  job_rec     public.jobs%rowtype;
  v_items     jsonb;
  v_added     jsonb := '[]'::jsonb;
  v_pulls     jsonb := '[]'::jsonb;
  v_stamp     jsonb;
  v_iid       text;
  v_patch     jsonb;
  v_idx       int;
  v_item      jsonb;
  v_qty       numeric;
  v_planned   numeric;
  v_prev      numeric;
  v_prev_plan numeric;
  v_total     numeric;
  v_cost      numeric;
  inv_rec     record;
  rec         record;
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

  -- See 52's "WHY p_batches MAY NOT NAME AN ITEM p_lines DOES NOT". Checked
  -- before anything is written, so a caller that got this wrong is told rather
  -- than half-applied.
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_batches, '{}'::jsonb)) as b(k)
    where b.k not in (select jsonb_object_keys(p_lines))
  ) then
    raise exception 'Stock was supplied for an item that is not part of this request.'
      using errcode = '22023';
  end if;

  -- Lock the job for the rest of this transaction so two people adding material
  -- to the same job at once can't race each other. Load-bearing for a top-up in
  -- a way it was not for 52: this one reads the line's current `pulled` and
  -- writes back a sum, so an unlocked read could lose a concurrent top-up.
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
      -- Not on the job yet. Unchanged from 52: the line is built field by field
      -- from the inventory row and the known pull fields, so a payload cannot
      -- smuggle in anything else.
      v_prev      := 0;
      v_prev_plan := 0;
      v_planned   := coalesce((v_patch->>'planned')::numeric, v_qty);
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
      -- Already on the job. 52 refused this outright when anything had gone out
      -- for it, which is the dead end this migration exists to open; it now adds
      -- to what is there.
      --
      -- The quantity arithmetic below is deliberately shared with the orphan
      -- case — an orphan line is a top-up of zero, so 0 + qty, [] || draws and
      -- 0 + cost all come out where 52 left them, and the untouched path cannot
      -- drift away from the one being added. What the two cases do NOT share is
      -- `planned` and the stamps, which is what the if/else after it is for.
      v_item      := v_items -> v_idx;
      v_prev      := coalesce((v_item->>'pulled')::numeric, 0);
      -- `qty` is the Build Jobs field and `planned` is what the Pull screen
      -- writes; older lines carry only the former. The same fallback plannedOf()
      -- applies client-side (pullReview.js), and reading it as 0 here would
      -- raise `planned` on a line that had one all along.
      v_prev_plan := coalesce((v_item->>'planned')::numeric, (v_item->>'qty')::numeric, 0);
      v_total     := v_prev + v_qty;
      v_cost      := coalesce((v_item->>'pullCost')::numeric, 0)
                     + coalesce((v_patch->>'pullCost')::numeric, 0);

      v_item := v_item || jsonb_build_object(
        'pulled',      v_total,
        'pullCost',    v_cost,
        -- The blended rate, which is what recostLine already defines
        -- priceAtPull to be and what the Pull screen's cost readouts multiply
        -- by. Guarded against 0 only for completeness: v_qty > 0 is enforced
        -- above, so v_total cannot be 0 here.
        'priceAtPull', case when v_total > 0 then v_cost / v_total else 0 end,
        -- Appended, not replaced. This array is the only record of which batch
        -- supplied which units at which price; overwriting it would leave the
        -- earlier units unattributable and silently break recostLine for them.
        'consumed',    coalesce(v_item->'consumed', '[]'::jsonb)
                       || coalesce(v_patch->'consumed', '[]'::jsonb)
      );

      if v_prev = 0 then
        -- 52's case exactly: only now does this line have a first pull to be
        -- dated by, its `priceAtPull` is the straight rate rather than a blend
        -- of one draw, and the stamp says the line was populated after the job
        -- had already been pulled.
        --
        -- `planned` is deliberately NOT among these. 52 left an orphan line's
        -- plan exactly as approved so that pulling past it still reports as the
        -- anomaly it is, and raising it here — which is what the top-up branch
        -- does below, on purpose — would quietly delete that signal for every
        -- over-pull of a line nobody had ever pulled.
        v_item := v_item || jsonb_build_object(
          'pulledAt',       coalesce(v_patch->>'pulledAt', to_char(current_date, 'YYYY-MM-DD')),
          'priceAtPull',    coalesce((v_patch->>'priceAtPull')::numeric, 0),
          'addedAfterPull', v_stamp
        );
      else
        -- A genuine top-up leaves `addedAfterPull` alone — set or absent, as it
        -- found it. That stamp dates the moment the line joined the job, which
        -- this is not, and writing a null over it would put a key on a line that
        -- was in the original plan all along.
        v_item := v_item || jsonb_build_object(
          -- Never lowered. A top-up that stays inside the approved plan leaves
          -- it exactly as approved; one that exceeds it revises it, and
          -- prevPlanned below keeps the original number. See the header.
          'planned', greatest(v_prev_plan, v_total),
          'toppedUp', coalesce(v_item->'toppedUp', '[]'::jsonb) || jsonb_build_array(
            v_stamp || jsonb_build_object(
              'qty',         v_qty,
              'prevPulled',  v_prev,
              'newPulled',   v_total,
              'prevPlanned', v_prev_plan
            )
          )
        );
      end if;

      v_items := jsonb_set(v_items, array[v_idx::text], v_item);
    end if;

    -- The resulting line's real numbers, read back off the line rather than
    -- recomputed, so the client can render the new total instead of guessing at
    -- it. `qty` is this call; `pulled` is the line afterwards.
    v_pulls := v_pulls || jsonb_build_array(jsonb_build_object(
      'iid',         v_iid,
      'qty',         v_qty,
      'pulled',      (v_item->>'pulled')::numeric,
      'prevPulled',  v_prev,
      'planned',     (v_item->>'planned')::numeric,
      'prevPlanned', v_prev_plan,
      'pullCost',    (v_item->>'pullCost')::numeric,
      'priceAtPull', (v_item->>'priceAtPull')::numeric,
      'pulledAt',    v_item->>'pulledAt',
      'consumed',    coalesce(v_item->'consumed', '[]'::jsonb),
      'topUp',       v_prev > 0
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
-- 1. The function is replaced and still SECURITY INVOKER (prosecdef false), and
--    the ledger's probe for 57 can see the new branch:
--
--   select p.prosecdef, pg_get_functiondef(p.oid) like '%toppedUp%' as has_top_up
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'add_and_pull_job_materials';
--
--   Expect prosecdef = false, has_top_up = true.
--
-- 2. THE REPORTED CASE. Find the job and the line that could not be added to:
--
--   select j.id, jsonb_pretty(l) from public.jobs j, jsonb_array_elements(j.items) l
--   where j.po = '22598' and l->>'iname' ilike '%osb%';
--
--    then top it up by 9 inside a transaction you roll back:
--
--   begin;
--   select public.add_and_pull_job_materials(
--     '<that job id>',
--     '{"<the osb item id>": {"pulled": 9, "pullCost": 0, "consumed": []}}'::jsonb,
--     '{}'::jsonb, 'Test User', 'verify 57'
--   );
--   select jsonb_pretty(items) from public.jobs where po = '22598';
--   rollback;
--
--   On that line expect: pulled 15, planned raised to 15 (if it was 6), the
--   ORIGINAL pulledAt, `consumed` with its old entries still first, and a
--   `toppedUp` array of one entry reading qty 9, prevPulled 6, newPulled 15,
--   prevPlanned 6. `added` comes back empty and `pulls` has topUp = true.
--
-- 3. Top up the same line twice in a row (two calls inside one transaction).
--    `toppedUp` must have TWO entries, oldest first, and `pulled` must be the
--    sum of both — not the second one.
--
-- 4. Confirm `planned` is never lowered. Take a line with planned well above
--    pulled (say planned 20, pulled 6) and top it up by 9: `pulled` becomes 15
--    and `planned` must still read 20, with prevPlanned 20 on the stamp.
--
-- 5. Confirm 52's paths are untouched:
--      a. an item NOT on the job -> still appended with planned = pulled and an
--         `addedAfterPull` stamp, and NO `toppedUp` key;
--      b. an orphan line at pulled = 0 -> still populated, `addedAfterPull`
--         stamped, `pulledAt` set to today, no `toppedUp` key.
--      c. and the one that is easy to get wrong: an orphan line pulled PAST its
--         plan (planned 10, pull 14) must come out with `planned` still 10, not
--         raised to 14. That over-pull is 52's anomaly and the pull review list
--         is supposed to keep showing it; only a top-up revises a plan.
--
-- 6. Confirm the guards that did NOT change, all of which must still raise:
--      a. quantity 0 or negative -> 22004;
--      b. p_batches naming an item p_lines does not -> 22023, nothing written;
--      c. an `approved` or `closed` job -> 42501;
--      d. an inventory id from another company -> P0002, line never appended.
--
-- 7. Confirm the cost arithmetic on a top-up that draws from a different batch
--    than the first pull did. priceAtPull must come out as pullCost / pulled —
--    a blend of the two batch prices, not either one of them.
