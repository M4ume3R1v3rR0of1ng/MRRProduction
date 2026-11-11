# A.N.V.I.L. capabilities: free or Pro

This is the list to decide from. The code reads the same list from
`netlify/functions/_shared/anvilCapabilities.js`; to move something between plans, change its
`tier` there (one word) and update this table. A unit test fails if a chat tool exists that is
not in that file, so nothing can ship without a decision.

**Current state:** everything that existed before Anvil Pro is **Free** (nothing changes for
any company today). Only the four new reorder capabilities are **Pro**.
Moving an existing capability to Pro takes it away from companies that have it now.

## Ask A.N.V.I.L. (answers questions, changes nothing)

| Capability                 | What it does                                                    | Plan now      |
| -------------------------- | --------------------------------------------------------------- | ------------- |
| Search jobs                | Find jobs by PO, name, address, status                          | Free          |
| Check inventory            | Stock on hand, what is low or out                               | Free          |
| Fleet status               | Vehicle state, mileage, oil and detail status                   | Free          |
| Maintenance requests       | Look up open and past tickets                                   | Free          |
| Maintenance insights       | Repeat-repair patterns, each vehicle's learned service cadence  | Free          |
| Maintenance to-do list     | Ranked, evidence-backed list of what the fleet needs            | Free          |
| Schedule and clash check   | Calendar, and any trailer double-booked                         | Free          |
| Job costing                | Material cost and margin (only for people allowed to see money) | Free          |
| Training status            | Who has outstanding or overdue training                         | Free          |
| On-demand briefing         | The morning briefing, whenever asked                            | Free          |
| Photo in chat              | Send a photo with a question                                    | Free          |
| Ask about pending reorders | "What are we about to order?"                                   | **Pro** (new) |

## Do it for me (each one waits for a Confirm button)

| Capability                     | What it does                                                        | Plan now      |
| ------------------------------ | ------------------------------------------------------------------- | ------------- |
| File a maintenance request     | Open a ticket from chat                                             | Free          |
| Schedule a maintenance request | Put a shop date on a pending ticket                                 | Free          |
| Correct a stock count          | Set an item's on-hand to a counted number                           | Free          |
| Log mileage                    | Record an odometer reading                                          | Free          |
| Log a service record           | Record a service that was performed                                 | Free          |
| Reorder approval queue         | Review, edit the quantity, approve or dismiss drafted reorders      | **Pro** (new) |
| Send purchase order            | Email the PO for an approved reorder to the supplier, mark received | **Pro** (new) |

## Runs on its own

| Capability                    | What it does                                                                      | Plan now      |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------- |
| Morning briefing              | One message per person each weekday at 7am Eastern, silent when nothing matters   | Free          |
| End-of-day recap              | 5pm Eastern each weekday: what got done, what did not, what is on next day        | Free          |
| Spanish / English translation | Reading aid for typed notes; original never changed                               | Free          |
| Low-stock watch               | Weekday check of every item against its line; drafts a reorder for anything under | **Pro** (new) |
| Low-stock email               | Mondays: emails stock managers which items are under their line; silent if none   | Free          |
| Reorder-waiting email         | Emails the people who approve orders when a drafted reorder is waiting            | **Pro** (new) |

## Plan decisions

Decided 2026-11-10.

1. **Low-stock notice is Free; drafted reorders are Pro.** Any company is told when something is
   low. Pro adds the work: the weekday watch that drafts reorders, the approval queue, learned
   usage rates and the PO email. This follows the guiding rule: a notice saves a crew member
   looking (Free); drafting and approving saves the owner office hours (Pro).
   **Built** as `anvil-lowstock-notice.js`: a plain Monday digest of items at or below their
   line, sent to members who can edit inventory, silent when nothing is low. It is weekly and
   stateless on purpose: unlike the Pro scan it keeps no record of what it already said, so it
   stays quiet by being infrequent rather than by adding a table. A company that has Pro
   **and** auto-reorder switched on is skipped, because the Pro "reorder waiting" email
   already covers the same items. The old Pro email is now called "Reorder-waiting email".
2. **No existing tool moves to Pro.** Everything that existed before Anvil Pro stays Free, as in
   the no-downgrade rule. New Pro value comes from new capabilities only.
3. **Price: $50/month, with an annual price of $500/year (two months free).** The amount
   charged is whatever the Stripe Price says, so create a monthly ($50) and an annual ($500)
   Price on the same product and set `STRIPE_ANVIL_PRO_PRICE_ID` and
   `STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID`. The code already supports both: a company on the
   annual base plan is given the annual Pro price automatically (`anvil-pro.js`), because every
   item on one subscription must share an interval. The billing screen shows
   `$500/year` (and the annual confirm wording) to a company on the annual base plan, and
   `$50/month` to everyone else. Those two figures are `ANVIL_PRO_ANNUAL_PRICE` and
   `ANVIL_PRO_PRICE` in `BillingView.jsx`; they are display text only, so keep them in step
   with the Stripe Prices.

## How a reorder moves through the queue

`waiting on approval` -> `approved` -> `ordered` -> `received` (or `dismissed`).

- **Approve** records who approved what quantity. It sends nothing.
- **Send purchase order** is a separate step on an approved reorder. It shows who it will be
  emailed to and says it cannot be undone, then emails a fixed-format PO (item, quantity, PO
  number, who to reply to) to the supplier email saved on the item. If the item has no
  supplier email, the person types one in. Replies go to the person who sent it. It can only be
  sent once per reorder; a failed send puts the reorder back to approved so it can be retried.
  No CC yet (on hold), and no PDF attachment: the PO is the email itself.
- **Mark received** closes the loop when the delivery arrives. It is also available straight
  from approved, for an order that was phoned in.

Needs `supabase/66_anvil_reorder_purchase_orders.sql` run before it works.

---

# Roadmap: what we want from A.N.V.I.L. next

Source: "A.N.V.I.L. Capability Recommendations" (Steadwerk product team). **None of this is built
yet.** The tables above describe what exists today; this section is the plan. When an item ships it
moves into the tables above and into `anvilCapabilities.js` with its `tier`.

**Rules that carry over**

- Keep the three-tier structure: Ask (changes nothing), Do it for me (waits for Confirm), Runs on
  its own.
- **No downgrades.** Everything that existed before Anvil Pro stays Free. Improvements below stay
  on their current plan.
- **Guiding rule for new capabilities:** if it saves a crew member typing, it is Free. If it saves
  the owner money or office hours, it is Pro.

## Improvements to existing capabilities (stay on their current plan)

| Capability                    | Improvement                                                                                                                                               | Plan |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Photo in chat                 | An odometer photo pre-fills Log mileage; a damage photo drafts a maintenance ticket. Output is always a draft behind Confirm, editable before confirming. | Free |
| Confirm button                | Before/after preview ("Shingles: 40 to 32 bundles") and an undo window (see decision 2).                                                                  | Free |
| Morning briefing              | Role-based content (crew lead: their jobs and truck; office manager: stock and tickets). Fixed 7am delivery (decision 6).                                 | Free |
| Spanish / English translation | Voice notes: speech-to-text, then translation. Always keep the original and show the transcript.                                                          | Free |
| Low-stock watch               | Learn each item's usage rate instead of relying only on the fixed reorder line (decision 5).                                                              | Pro  |

## New Free capabilities

| Capability                 | What it does                                                                                            | Category        |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | --------------- |
| "How do I..." help         | Answers questions about using Steadwerk itself. Read-only; needs current help content.                  | Ask             |
| Fleet compliance reminders | Upcoming registration, DOT inspection and insurance expiry. Needs expiry dates on each vehicle/trailer. | Runs on its own |
| Training nudges            | Reminder to the person whose training is overdue. Limit how often the same person is nudged.            | Runs on its own |

## New Pro capabilities

| Capability                | What it does                                                                                                                    | Category        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Customer update drafts    | Drafts homeowner messages ("crew on the way", "job complete, photos attached"). Confirm before sending; audit-logged.           | Do it for me    |
| Job margin alerts         | Flags a job trending over its material budget. Only people allowed to see costs get alerts. Needs a material budget on the job. | Runs on its own |
| Auto-schedule maintenance | Proposes shop dates for due maintenance around the job calendar. Uses learned service cadence and the clash check.              | Do it for me    |
| Crew and trailer planner  | Suggests clash-free crew and trailer assignments. Suggestions only; applying needs Confirm.                                     | Do it for me    |
| Weekly owner report       | Weekly margins, fleet costs, stock spend and overdue items. Owner/permissioned recipients only.                                 | Runs on its own |

## Decisions

Decided 2026-11-10. These answer the six open questions from the product team's document.

1. **Supplier orders.** The PO goes out as a pre-formatted email or PDF to any supplier, so no
   supplier integration is needed to start. Delivery tracking is a **"Received"** button in the
   reorder queue. (Pairs with "What approve does today" above: sending the PO is the next step.)
2. **Undo.** After Confirm, undo is offered in the toast for **10 minutes**. The same action can
   still be undone from the action log for up to **24 hours**. **Messages to suppliers and
   customers can never be undone**; their Confirm shows the full text and recipient first.
3. **Languages.** Spanish and English only.
4. **Homeowner messages.** Anyone who can see the job can confirm and send a message about it.
   The Confirm step shows the full text and the recipient. The audit log records who confirmed,
   when, the final text, the recipient and channel, the job, and the original draft next to the
   edited text. The log is read-only for everyone, including admins.
5. **Learned usage rate.** Needs at least **60 days** of history per item before it is trusted
   over the fixed reorder line. Guard rail: the learned line is never allowed below the fixed
   line without being flagged, so a quiet stretch cannot cause a stockout.
6. **Delivery times.** Fixed for everyone, in Eastern time (there is no per-company time zone yet, so a company elsewhere gets Eastern times): morning briefing at
   **7:00 am**, end-of-day recap at **5:00 pm**. Each stays one message per person per weekday and
   silent when nothing matters. **Built:** both run at the stated Eastern hour all year, DST included.
   Each cron is scheduled at the two candidate UTC hours and the handler runs only on the right
   local one (`_shared/localTime.js`). The recap's content is: finished today, scheduled for
   today and not finished, and what is on for the next working day (Monday on a Friday), built
   from each person's own permissions; a crew member sees only their own jobs. A companies.timezone
   column would let a tenant have its own hours.

**Risk accepted in decision 4:** crew members can message homeowners, so the full-text preview and
the draft-versus-final audit trail are what protect against a wrong or off-tone message.
