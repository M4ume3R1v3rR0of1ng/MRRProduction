# ANVIL Pro settings tab — design

## Intent
ANVIL Pro's settings are scattered: the subscription toggle lives in Billing, and the
automatic-reordering switch and notification list live inside Inventory → Reorders. Put
them in one obvious place: a new **ANVIL Pro** tab in Settings.

## Goals
- New "ANVIL Pro" tab in `SettingsView.jsx`, alongside Permissions / Automations / CRM / ...
- Shows Pro status: Active, Comped, or Off. When Off, explains what Pro adds and links to Billing.
- Holds the automatic-reordering on/off switch and the "also email" list (moved out of
  `ReorderTab.jsx`).
- Inventory → Reorders keeps only the proposal queue (pending / approved / ordered / recent),
  with a one-line pointer to Settings → ANVIL Pro for the switch and emails.

## Non-goals
- No new Pro options, no database migration, no new endpoint.
- The Pro subscribe/cancel toggle stays in Billing (it edits Stripe and is admin-only).

## Anti-goals
- Showing controls someone cannot save. `anvil-reorder.js` requires Pro **and** `inv_edit`;
  Settings opens on `settings_manage`, which is a different permission.

## Constraints
- Reads and writes go through `netlify/functions/anvil-reorder.js` (`action: "list"` for
  `enabled`/`notifyEmails`, `action: "settings"` to save) via `callReorder` in
  `src/features/inventory/reorderApi.js`. The server re-checks Pro and `inv_edit`.
- Pro status for display comes from `useAnvilPro` (or the same `companies` columns
  `anvil_pro`, `anvil_pro_comped`).

## Approaches
1. **Dedicated Settings tab, controls moved there** (picked). One home for Pro settings;
   Reorders becomes purely the work queue.
2. Mirror the controls in both places. Rejected: two places to edit the same setting.
3. Put the controls under the existing Automations tab. Rejected: Automations is the
   notification toggles; Pro is a paid add-on with its own status and upsell.

## Decided
- Tab visible to anyone who can open Settings. Reorder controls render only when the
  viewer has `inv_edit`; otherwise a note says who can change them.
- Pro status block always visible; Billing link shown (Billing itself is admin-gated).

## Left to the builder
- Extracting the switch + email form into a shared component (e.g.
  `src/features/settings/AnvilProSettings.jsx`), translation keys, icon choice.
