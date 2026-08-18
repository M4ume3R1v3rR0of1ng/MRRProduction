# Database migrations

These files are applied **by hand**, in numeric order, through the Supabase SQL
Editor. There is no migration runner and no Supabase CLI link. Numbering is the
only ordering, and several files depend on the one before it.

## Which ones are applied?

Run [`33_migration_ledger.sql`](33_migration_ledger.sql), then:

```sql
select filename, note from public.schema_migrations
where status = 'missing' order by filename;
```

That is the authoritative answer. The ledger does not trust a log, it probes the
live schema for the object each migration creates. Re-run the file any time to
refresh it, and after a restore or on a fresh environment.

Three files leave no distinguishable trace and are marked `undetectable`:
`11` and `13` are `create or replace` fixes over functions `06` and `12` already
created, and `22` is an optional data backfill. Each carries a `note` with a
query that confirms it by hand.

## Rules

- **Order matters.** Run them low to high. Do not skip.
- **`02` is destructive.** Take a backup first. It rewrites every business table
  to sit behind a company.
- **`15` drops columns.** Also not reversible.
- Everything else is written to be idempotent and safe to re-run, but confirm
  that in the file's own header before relying on it.
- Most files end with a `Verify` block. Run it. Several of them (notably `32`)
  need a manual follow-up when the check comes back wrong.
- **`00_introspect.sql` is read-only** and writes nothing. It is for inspecting an
  unfamiliar database before you touch it.

## Why the service-role key does not save you

Every Netlify function talks to Supabase with the service-role key, which
**bypasses row level security entirely**. Nothing in these files protects a single
line of code in `netlify/functions/`. That job belongs to
[`_shared/tenant.js`](../netlify/functions/_shared/tenant.js), which resolves the
caller once and scopes queries by their company. If you change an isolation rule
in SQL, change it there too.

## The files

| # | File | What it does |
|---|------|--------------|
| 00 | `00_introspect.sql` | Read-only. Inspect the current schema. Writes nothing. |
| 01 | `01_tenancy_core.sql` | The company layer: `companies`, `memberships`, and the helpers every RLS policy calls. |
| 02 | `02_tenancy_tables.sql` | **Destructive.** Puts every business table behind a company. |
| 03 | `03_functions.sql` | The functions the app and the nightly cron call. |
| 04 | `04_security_fixes.sql` | Closes four isolation defects found by `scripts/verify-tenant-isolation.mjs`. |
| 05 | `05_storage.sql` | Tenant-scopes the photo buckets. |
| 06 | `06_platform_admin.sql` | The Owner Console data layer. The only cross-company RPCs. |
| 07 | `07_billing.sql` | Adds the `incomplete` subscription state for self-serve signup. |
| 08 | `08_usage.sql` | Per-company storage usage for the Owner Console. |
| 09 | `09_seats.sql` | Seat limits. $99/mo includes 10 users, +$10/mo per extra 5. |
| 10 | `10_platform_admin_role.sql` | `platform_admin` becomes a managed role. |
| 11 | `11_fix_admin_list.sql` | Fix: `admin_list_companies()` threw "column reference created_at is ambiguous". |
| 12 | `12_permission_enforcement.sql` | Server-side permission enforcement. Job permissions were UI-only before this. |
| 13 | `13_fix_has_perm.sql` | Fix: `has_perm()` threw 42883 on a `text = uuid` comparison. |
| 14 | `14_atomic_material_moves.sql` | Makes pulling and returning materials atomic. |
| 15 | `15_jobs_schema_debt.sql` | **Drops columns.** Retires the duplicate names on `jobs`. |
| 16 | `16_one_time_seat_packs.sql` | Crew packs become a one-time purchase. Superseded by 27. |
| 17 | `17_multi_crew_jobs.sql` | One AccuLynx job can carry more than one inventory job. |
| 18 | `18_enable_rls.sql` | Asserts row level security is actually on. Idempotent. |
| 19 | `19_maintenance_vehicle_swap.sql` | Take a vehicle off the road and lend its driver a spare. |
| 20 | `20_inventory_counts.sql` | Monthly physical stock counts and book-vs-shelf variance. |
| 21 | `21_profiles_readable_after_deactivation.sql` | A deactivated employee keeps their name in your records. |
| 22 | `22_backfill_batch_by_name.sql` | **Optional** data backfill. Freezes resolvable names onto batch rows. |
| 23 | `23_recover_orphaned_person.sql` | Reattaches one person's orphaned batch history. Destructive steps are commented out and gated. |
| 24 | `24_job_contract_value.sql` | Gives a job a real contract value. |
| 25 | `25_vehicle_out_of_service.sql` | Lets a person ground a vehicle. |
| 26 | `26_training_media.sql` | Admin-uploaded training media, plus the `training-media` bucket. |
| 27 | `27_recurring_seat_packs.sql` | Crew packs go back to being a recurring charge. Supersedes 16. |
| 28 | `28_acculynx_sync_state.sql` | Records what actually reached AccuLynx. |
| 29 | `29_mfa_enforcement.sql` | Requires a second factor from accounts that have one. |
| 30 | `30_platform_revenue.sql` | Per-company and platform-wide monthly revenue. |
| 31 | `31_platform_admin_entry.sql` | Lets the platform owner enter a tenant they do not belong to. |
| 32 | `32_platform_company.sql` | Marks one company as the operator's own tenant. **Needs a manual check.** |
| 33 | `33_migration_ledger.sql` | Records which of the above are applied, by probing the schema. |

## Adding a migration

1. Take the next number. Never renumber an existing file.
2. Open with a header saying what it does, what it runs after, and whether it is
   idempotent. Say so loudly if it is destructive.
3. Close with a `Verify` block a person can paste into the SQL Editor.
4. **Add a probe for it** to the do-block in `33_migration_ledger.sql`, then
   re-run that file. A migration with no probe is one nobody can verify later.

## Verification scripts

These run against a live database from Node and are not part of `npm test`:

```
node scripts/verify-tenant-isolation.mjs
node scripts/verify-permission-enforcement.mjs
node scripts/verify-atomic-materials.mjs
```
