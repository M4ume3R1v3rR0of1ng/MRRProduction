# ANVIL Pro Settings Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "ANVIL Pro" tab to Settings that shows Pro status and holds the automatic-reordering switch and notification list, moved out of Inventory → Reorders.

**Architecture:** A new self-contained component `AnvilProSettings.jsx` reads Pro status via `useAnvilPro` and reorder settings via `callReorder({action:"list"})`, and saves via `callReorder({action:"settings", ...})`. `SettingsView` renders it under a new tab id `"AnvilPro"`. `ReorderTab` drops its settings card and points to Settings instead. No server or database changes.

**Tech Stack:** React 18, react-router, Vitest + @testing-library/react (jsdom), existing `UIPrimitives`.

**Spec:** `docs/superpowers/specs/2026-11-18-anvil-pro-settings-tab-design.md`

## Global Constraints

- No new endpoint, no migration; all reorder reads/writes go through `callReorder` in `src/features/inventory/reorderApi.js`.
- Subscribe/cancel Pro stays in Billing (`/billing`); this tab only links there.
- Reorder controls render only when the viewer has `inv_edit`; never show controls the server (`anvil-reorder.js` checks Pro + `inv_edit`) would refuse.
- Every user-facing string gets an `en` and `es` key in `src/shared/utils/translations.js`, prefixed `stPro` (plus the tab label `stTabAnvilPro`).

## Review Focus

- Viewer has `settings_manage` but not `inv_edit` → status block shows, no `callReorder` call is made, a note says inventory editors manage reorders. (Task 1 test)
- Company without Pro → no `callReorder` call (server would 402/403); shows "Off" + what Pro adds + Billing link. (Task 1 test)
- Comped company (`anvil_pro_comped` true, `anvil_pro` false) → shows "Comped", controls work. (Task 1 test; `useAnvilPro` already treats comped as Pro, but status label must distinguish — so the component reads both columns itself, see Task 1.)
- `callReorder` list fails → error toast, the switch is not rendered in a guessed state. (Task 1 test)
- Emails typed with commas, spaces and newlines → saved as a trimmed array; server dedupes/validates. (Task 1 test)

---

### Task 1: `AnvilProSettings` component

**Files:**
- Create: `src/features/settings/AnvilProSettings.jsx`
- Create: `src/features/settings/AnvilProSettings.test.jsx`
- Modify: `src/shared/utils/translations.js` (add `stPro*` keys in `en` near line 1621 and `es` near line 3507)

**Interfaces:**
- Consumes: `callReorder(payload) -> Promise<{enabled:boolean, notifyEmails:string[], ...}>` from `@/features/inventory/reorderApi`; `supabase` from `@/shared/utils/supabase`; `useNotify()`.
- Produces: `export default function AnvilProSettings({ canEditInventory: boolean, t: object })`.

Status: read `companies.anvil_pro, anvil_pro_comped` with `supabase.from("companies").select(...).maybeSingle()` (same query as `useAnvilPro.js:21`) so the label can be `Active` / `Comped` / `Off`. Comped wins over Active when both are true.

- [ ] **Step 1: Write the failing tests** in `AnvilProSettings.test.jsx`, following `src/features/inventory/ReceiveBatchModal.test.jsx` (jsdom, fakeSupabase mock). Mock `@/features/inventory/reorderApi` with `callReorder: vi.fn()`. Tests:
  - `shows Off and a Billing link when the company has no Pro` — seed company `{anvil_pro:false, anvil_pro_comped:false}`; expect text for `t.stProStatusOff`, a link with `href="/billing"`, and `callReorder` not called.
  - `shows Comped for a comped company` — `{anvil_pro:false, anvil_pro_comped:true}`; expect `t.stProStatusComped`.
  - `hides reorder controls without inv_edit` — Pro on, `canEditInventory:false`; expect `t.stProNeedsInvEdit` text, no "Turn on" button, `callReorder` not called.
  - `toggles automatic reordering` — Pro on, `canEditInventory:true`, `callReorder` resolves `{enabled:false, notifyEmails:[]}` for list; click "Turn on"; expect `callReorder` called with `{action:"settings", enabled:true}`, then list reloaded.
  - `saves the email list as a trimmed array` — type `" a@x.com,b@x.com\n c@x.com "`, click Save; expect `{action:"settings", notifyEmails:["a@x.com","b@x.com","c@x.com"]}`.
  - `shows an error and no switch when loading fails` — list rejects `new Error("boom")`; expect error toast containing `boom`, no "Turn on"/"Turn off" button.

- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run src/features/settings/AnvilProSettings.test.jsx`
  Expected: FAIL (module not found).

- [ ] **Step 3: Implement `AnvilProSettings`**. Layout: a `Card` with `SectionTitle`-style heading + status `Bdg` (green Active, gold Comped, gray Off); when Off, `t.stProUpsell` text and a `Link to="/billing"` labeled `t.stProGoBilling`. When Pro and `canEditInventory`, the automatic-reordering card moved verbatim from `ReorderTab.jsx:102-135` (switch, blurb, "Also email" input + Save), with the same split regex `/[,\s]+/`. When Pro and not `canEditInventory`, `t.stProNeedsInvEdit`. Add the translation keys used (`stTabAnvilPro`, `stProTitle`, `stProStatusActive`, `stProStatusComped`, `stProStatusOff`, `stProUpsell`, `stProGoBilling`, `stProNeedsInvEdit`, `stProReorderTitle`, `stProReorderDesc`, `stProAlsoEmail`, `stProReorderOn`, `stProReorderOff`, `stProEmailsSaved`) in `en` and `es`.

- [ ] **Step 4: Run to verify they pass**
  Run: `npx vitest run src/features/settings/AnvilProSettings.test.jsx`
  Expected: 6 passed.

- [ ] **Step 5: Commit**
  ```bash
  git add src/features/settings/AnvilProSettings.jsx src/features/settings/AnvilProSettings.test.jsx src/shared/utils/translations.js
  git commit -m "Add an ANVIL Pro settings panel with status and automatic-reorder controls"
  ```

### Task 2: Wire the tab into Settings and slim the Reorders tab

**Files:**
- Modify: `src/features/settings/SettingsView.jsx:136-160` (new prop), `:299-311` (tab list), after `:1152` block (render)
- Modify: `src/App.jsx:1251-1272` (pass prop)
- Modify: `src/features/inventory/ReorderTab.jsx:88-136` (remove settings card)

**Interfaces:**
- Consumes: `AnvilProSettings({ canEditInventory, t })` from Task 1.
- Produces: `SettingsView` prop `userPerms` (object of permission flags, same shape as `app.userPerms`).

- [ ] **Step 1: Add the tab.** In `SettingsView`, accept `userPerms = {}`; add `{ id: "AnvilPro", label: t.stTabAnvilPro, icon: Sparkles }` (lucide-react) after the Automations entry; render `{currentTab === "AnvilPro" && <AnvilProSettings canEditInventory={!!userPerms.inv_edit} t={t} />}`. In `App.jsx` pass `userPerms={app.userPerms}`.

- [ ] **Step 2: Slim `ReorderTab`.** Remove the "Automatic reordering" card, the `emails` state and `saveEmails`; in its place render one `Muted` line: "Automatic reordering and who gets emailed are in Settings → ANVIL Pro." with a `Link to="/settings"`. Keep `state.enabled` unused-safe (no other reference). The non-Pro upsell card stays.

- [ ] **Step 3: Verify**
  Run: `npx vitest run && npx eslint src/features/settings src/features/inventory/ReorderTab.jsx src/App.jsx`
  Expected: all tests pass, no lint errors. Then run the app (`run` skill), open Settings → ANVIL Pro, flip the switch, confirm the toast and that Inventory → Reorders shows the pointer line instead of the card.

- [ ] **Step 4: Commit**
  ```bash
  git add src/features/settings/SettingsView.jsx src/App.jsx src/features/inventory/ReorderTab.jsx
  git commit -m "Move ANVIL Pro reorder settings into a Settings tab"
  ```
