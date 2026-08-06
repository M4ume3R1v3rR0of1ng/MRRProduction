-- Phase 10b — OPTIONAL data backfill. Freeze today's resolvable names onto the
-- batch rows that carry them.
--
-- Run after 21. Idempotent (it only fills rows where byName is absent).
--
-- ⚠️ THIS REWRITES inventory.batches. Read the whole file before running it. The
-- PREVIEW block at the bottom shows exactly what would change and touches nothing.
--
-- WHY
--
-- From this version on, every new batch records `byName` alongside `by`, because
-- an id stops resolving the moment that person is removed from the company:
-- delete-user.js deletes the membership, and if it was their last one it deletes
-- the profile and the auth account outright. After that no query can name them.
--
-- Existing rows have only the id. They are resolvable RIGHT NOW for anyone still
-- on the roster, and permanently anonymous the day that person is removed. This
-- captures the answer while it is still available.
--
-- WHAT IT DOES NOT DO
--
-- It cannot invent what was already lost. A batch whose `by` matches no profile
-- (a deleted account, or a pre-Supabase-Auth id like 'u1') is left exactly as it
-- is. The 'u1' family is handled in the app instead, by mapping the old roster's
-- email onto the current one — see src/utils/people.js.
--
-- Names are a snapshot, not a link. If someone changes their name later, the app
-- still prefers the live lookup and only falls back to this stamp, so the stamp
-- going stale is harmless.

begin;

update public.inventory i
set batches = coalesce(
  (
    select jsonb_agg(
             case
               when b ? 'byName'                       then b
               when b->>'by' is null                   then b
               when b->>'by' = 'system'                then b
               when p.id is null                       then b
               when coalesce(p.full_name, p.name, p.email) is null then b
               else b || jsonb_build_object('byName', coalesce(p.full_name, p.name, p.email))
             end
             -- Preserve array order. FIFO sorts by rcvd at read time, but the
             -- stored order is still the receipt order and there is no reason to
             -- shuffle it.
             order by ord
           )
    from jsonb_array_elements(i.batches) with ordinality as t(b, ord)
    left join public.profiles p on p.id::text = b->>'by'
  ),
  i.batches
)
where jsonb_typeof(batches) = 'array'
  and jsonb_array_length(batches) > 0
  -- Only rows that would actually change, so a re-run is a no-op rather than a
  -- full table rewrite.
  and exists (
    select 1
    from jsonb_array_elements(i.batches) b
    join public.profiles p on p.id::text = b->>'by'
    where not (b ? 'byName')
      and b->>'by' <> 'system'
      and coalesce(p.full_name, p.name, p.email) is not null
  );

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- PREVIEW / VERIFY
--
-- Safe to run on its own BEFORE the update above. Shows every distinct person id
-- on a batch, how many batches carry it, and whether it can still be named.
-- "UNRESOLVABLE" rows are the ones already beyond recovery.
-- ─────────────────────────────────────────────────────────────────────────────
select b->>'by'                                   as person_id,
       count(*)                                   as batches,
       coalesce(p.full_name, p.name, p.email)     as resolves_to,
       case
         when b->>'by' = 'system' then 'system row'
         when p.id is null        then 'UNRESOLVABLE — no profile with this id'
         else 'ok'
       end                                        as status
from public.inventory i
cross join lateral jsonb_array_elements(i.batches) b
left join public.profiles p on p.id::text = b->>'by'
group by b->>'by', p.id, p.full_name, p.name, p.email
order by status, batches desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSE ONE ID
--
-- Paste an id the app shows as "Unrecognized (…)". The SQL editor runs with
-- elevated rights, so this sees rows RLS hides from the browser and tells you
-- which of the three cases you are in.
-- ─────────────────────────────────────────────────────────────────────────────
-- select p.id,
--        p.full_name,
--        p.email,
--        m.company_id,
--        m.active as membership_active,
--        case
--          when p.id is null   then 'account deleted — name is gone for good'
--          when m.user_id is null then 'profile exists, but no membership in this company'
--          when not m.active   then 'deactivated — migration 21 makes this readable again'
--          else 'active member — should be resolving; check the app'
--        end as diagnosis
-- from (select '<PASTE-THE-UUID-HERE>'::uuid as id) q
-- left join public.profiles p    on p.id = q.id
-- left join public.memberships m on m.user_id = q.id;
