// netlify/functions/_shared/anvilActions.js
//
// The four things A.N.V.I.L. can CHANGE, as opposed to the dozen it can read.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A WRITE IS TWO ROUND TRIPS AND NOT ONE
// ─────────────────────────────────────────────────────────────────────────────
// A read tool that misunderstands the question wastes a sentence. A write tool
// that misunderstands it corrects a stock count to the wrong number, and the
// batch arithmetic that follows (see applyStockCorrection) silently re-costs
// every later pull of that item. So no tool here ever writes on the turn the
// model asks for it.
//
// Instead the model's call is answered with a PREVIEW: the exact before/after,
// in plain words, plus a signed token. The model relays that preview, the
// widget renders Confirm / Cancel under it, and only a second request carrying
// that token back actually writes.
//
// WHY THE TOKEN IS SIGNED
//
// The permission check is the real security gate, and it runs again on
// execute — a user confirming a write they hold the permission for is just
// them doing in chat what they could already do in the UI, so a hand-crafted
// confirm request is not an escalation.
//
// What signing buys is narrower and still worth it: it guarantees the write
// that lands is byte-for-byte the one the person was shown. Without it a
// tampered (or just stale) client could send back "adjust Shingles to 40"
// under a preview that said 400, and the audit trail would record a
// confirmation the user never actually gave for that number. The token binds
// the input to the user, the company, and a five-minute window.
//
// The key is derived from SUPABASE_SERVICE_ROLE_KEY, which adminClient()
// already requires — deliberately NOT a new env var, because a signing secret
// that has to be provisioned separately is one that is missing in production
// on the day it matters. It is domain-separated by the info string below so
// this signature can never be mistaken for any other use of that key.

import crypto from "node:crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000;
const SIGNING_INFO = "steadwerk:anvil:pending-action:v1";

// ── Tool definitions, as the model sees them ───────────────────────────────
//
// Each description says, in the model's own idiom, that calling this does not
// commit anything — otherwise a model that gets back a preview reads it as a
// failure and retries in a loop.
export const ACTION_TOOLS = [
  {
    name: "file_maintenance_request",
    description:
      "File a maintenance request against a vehicle, exactly as the crew would from the Requests page. Calling this does NOT file anything yet: it returns a preview of the ticket for the user to confirm, which the app shows them as a Confirm button. Relay the preview's summary to the user and stop — do not call this twice, and do not claim the request was filed.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_name: {
          type: "string",
          description: "Vehicle unit number or plate, e.g. '011'. Must match one real vehicle.",
        },
        issue_type: {
          type: "string",
          description: "What needs doing, e.g. 'Oil Change', 'Brakes', 'Tires'.",
        },
        urgency: {
          type: "string",
          enum: ["low", "normal", "high", "critical"],
          description: "How urgent. Defaults to normal.",
        },
        notes: { type: "string", description: "What the driver reported, in their words." },
      },
      required: ["vehicle_name", "issue_type"],
    },
  },
  {
    name: "schedule_maintenance_request",
    description:
      "Put a date on a pending maintenance request and move it to scheduled. Calling this does NOT schedule anything yet — it returns a preview for the user to confirm. Relay the summary and stop.",
    input_schema: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          description:
            "The request's id, as returned by get_maintenance_requests. Ask the user which ticket if more than one could match.",
        },
        scheduled_date: {
          type: "string",
          description: "The day it goes into the shop, as YYYY-MM-DD.",
        },
      },
      required: ["request_id", "scheduled_date"],
    },
  },
  {
    name: "adjust_stock",
    description:
      "Correct an inventory item's on-hand quantity to a counted number (a physical count, damage, a miscount). Calling this does NOT adjust anything yet — it returns a preview showing the current quantity, the new one, and the difference, for the user to confirm. Relay the summary and stop.",
    input_schema: {
      type: "object",
      properties: {
        item_name: {
          type: "string",
          description: "The item to correct. Must match exactly one inventory item.",
        },
        new_quantity: {
          type: "number",
          description: "The corrected on-hand quantity, in the item's own unit.",
        },
        reason: {
          type: "string",
          description: "Why it is being corrected. Recorded on the batch.",
        },
      },
      required: ["item_name", "new_quantity"],
    },
  },
  {
    name: "log_mileage",
    description:
      "Record a new odometer reading for a vehicle. Calling this does NOT record anything yet — it returns a preview for the user to confirm. Relay the summary and stop.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_name: { type: "string", description: "Vehicle unit number or plate." },
        mileage: { type: "number", description: "The odometer reading, in miles." },
      },
      required: ["vehicle_name", "mileage"],
    },
  },
];

export const ACTION_NAMES = new Set(ACTION_TOOLS.map((t) => t.name));

// The permission each action demands. One place, consulted by both the preview
// and the execute path, so the two can never disagree about who may do what.
const ACTION_PERM = {
  file_maintenance_request: "maint_submit",
  schedule_maintenance_request: "maint_manage",
  adjust_stock: "inv_adjust",
  log_mileage: "fleet_log_mi",
};

const PERM_DENIED = {
  maint_submit: "This user does not have permission to file maintenance requests.",
  maint_manage: "This user does not have permission to schedule maintenance requests.",
  inv_adjust: "This user does not have permission to adjust stock.",
  fleet_log_mi: "This user does not have permission to log mileage.",
};

// ── Signing ────────────────────────────────────────────────────────────────

function signingKey() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return crypto.createHmac("sha256", secret).update(SIGNING_INFO).digest();
}

// Key order matters to a signature over JSON, and the model's argument order is
// not stable between turns — so the payload is canonicalized before it is
// signed and again before it is verified.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, k) => {
        out[k] = canonical(value[k]);
        return out;
      }, {});
  }
  return value;
}

export function signAction({ tool, input, userId, companyId, expiresAt }) {
  const body = JSON.stringify(canonical({ tool, input, userId, companyId, expiresAt }));
  return crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
}

/**
 * Re-establishes that a confirm request describes the same write the user was
 * shown, by the same user, inside the token's lifetime.
 *
 * Returns { ok: true } or { ok: false, error } — never throws on bad input,
 * because every field here came off the wire.
 */
export function verifyAction(action, { userId, companyId, now = Date.now() } = {}) {
  if (!action || typeof action !== "object") return { ok: false, error: "Malformed action." };
  const { tool, input, expiresAt, signature } = action;
  if (!ACTION_NAMES.has(tool)) return { ok: false, error: `Unknown action: ${tool}` };
  if (!signature || typeof signature !== "string") {
    return { ok: false, error: "Action is missing its confirmation signature." };
  }
  if (!Number.isFinite(expiresAt) || expiresAt < now) {
    return { ok: false, error: "That confirmation expired. Ask again and confirm the fresh one." };
  }

  const expected = signAction({ tool, input, userId, companyId, expiresAt });
  // Buffers of unequal length make timingSafeEqual throw rather than return
  // false, so the length is checked first.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "That confirmation did not match what was shown. Nothing changed." };
  }
  return { ok: true };
}

// ── Resolution helpers ─────────────────────────────────────────────────────
//
// Every one of these fails on AMBIGUITY rather than picking the first match.
// "Adjust the shingles" against four kinds of shingle is a question, not an
// instruction, and guessing writes the correction onto the wrong item.

const needle = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

function matchOne(rows, text, fields, label) {
  const n = needle(text);
  if (!n) return { error: `Which ${label}? Nothing was named.` };
  const hits = rows.filter((r) => fields.some((f) => needle(r[f]).includes(n)));
  if (hits.length === 0) return { error: `No ${label} found matching "${text}".` };
  // An exact match wins outright — "011" should not be called ambiguous just
  // because "0110" also exists.
  const exact = hits.filter((r) => fields.some((f) => needle(r[f]) === n));
  if (exact.length === 1) return { row: exact[0] };
  if (hits.length > 1) {
    const names = hits
      .slice(0, 6)
      .map((r) => r[fields[0]] || "?")
      .join(", ");
    return {
      error: `"${text}" matches more than one ${label} (${names}). Ask the user which one before trying again.`,
    };
  }
  return { row: hits[0] };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const today = () => new Date().toISOString().slice(0, 10);

// Total remaining across an item's batches — the same sum as src helpers' tot().
const onHand = (item) =>
  (item?.batches || []).reduce((sum, b) => sum + (parseFloat(b.rem) || 0), 0);

// Newest known price, used to value found stock — mirrors src helpers'
// newestPrice(). Correction batches priced at 0 would quietly deflate the cost
// of every later pull that consumes them.
const newestPrice = (item) => {
  const batches = item?.batches || [];
  if (batches.length === 0) return 0;
  const sorted = [...batches].sort((a, b) => new Date(b.rcvd) - new Date(a.rcvd));
  return parseFloat(sorted[0]?.price) || 0;
};

const batchId = () => "b_" + crypto.randomBytes(5).toString("hex");

/**
 * Rewrites a batch list so its remaining total equals `newQty`.
 *
 * A direct port of src/features/inventory/AdjustStockModal.jsx's
 * applyStockCorrection, and it has to STAY a port: going up adds one correction
 * batch at the newest known price, going down drains oldest-first the way a
 * pull consumes. Draining newest-first would leave the oldest, cheapest units
 * on the shelf forever and inflate the cost of every later job.
 *
 * Exported for the test that pins it against the frontend's behavior.
 */
export function applyStockCorrection(liveBatches, newQty, { byUserId, byName, reason } = {}) {
  const batches = [...(liveBatches || [])];
  const current = batches.reduce((sum, b) => sum + (parseFloat(b.rem) || 0), 0);
  const delta = newQty - current;

  if (delta > 0) {
    return [
      ...batches,
      {
        id: batchId(),
        rcvd: today(),
        qty: delta,
        price: newestPrice({ batches }) || 0,
        by: byUserId || "system",
        // See src/shared/utils/people: an id alone cannot survive the person
        // being removed, so the name is stored beside it.
        byName: byName || null,
        rem: delta,
        ref: `Manual Adjustment (A.N.V.I.L.${reason ? `: ${reason}` : ""})`,
      },
    ];
  }

  let deficit = Math.abs(delta);
  return [...batches]
    .sort((a, b) => new Date(a.rcvd) - new Date(b.rcvd))
    .map((b) => {
      if (deficit <= 0) return b;
      const take = Math.min(parseFloat(b.rem) || 0, deficit);
      deficit -= take;
      return { ...b, rem: (parseFloat(b.rem) || 0) - take };
    });
}

// ── Phase one: preview ─────────────────────────────────────────────────────

/**
 * Validates an action and describes what it WOULD do. Writes nothing.
 *
 * Returns either { error } — which the model relays as a plain refusal — or
 * { requires_confirmation: true, summary, action }, where `action` is the
 * signed token the widget hands back to confirm.
 */
export async function previewAction(admin, { perms, caller, tool, input, now = Date.now() }) {
  const perm = ACTION_PERM[tool];
  if (!perm) return { error: `Unknown action: ${tool}` };
  if (!perms[perm]) return { error: PERM_DENIED[perm] };

  const built = await buildAction(admin, { caller, tool, input: input || {} });
  if (built.error) return { error: built.error };

  const expiresAt = now + TOKEN_TTL_MS;
  return {
    requires_confirmation: true,
    summary: built.summary,
    action: {
      tool,
      input: built.input,
      expiresAt,
      signature: signAction({
        tool,
        input: built.input,
        userId: caller.userId,
        companyId: caller.companyId,
        expiresAt,
      }),
    },
  };
}

/**
 * Resolves the model's loose arguments into the exact, normalized input a write
 * needs, and the sentence describing it.
 *
 * Normalizing HERE rather than at execute time is what makes the signature
 * meaningful: the token covers resolved ids and a rounded quantity, so the
 * write cannot drift from the preview even if a later lookup would have matched
 * something else.
 */
async function buildAction(admin, { caller, tool, input }) {
  const companyId = caller.companyId;

  switch (tool) {
    case "file_maintenance_request": {
      const { data, error } = await admin
        .from("vehicles")
        .select("id, name, plate, type")
        .eq("company_id", companyId)
        .limit(200);
      if (error) return { error: error.message };
      const found = matchOne(data || [], input.vehicle_name, ["name", "plate"], "vehicle");
      if (found.error) return { error: found.error };
      const v = found.row;

      const issue = String(input.issue_type || "").trim();
      if (!issue) return { error: "What needs doing? The issue type is required." };
      const urgency = ["low", "normal", "high", "critical"].includes(input.urgency)
        ? input.urgency
        : "normal";
      const notes = String(input.notes || "").trim();

      return {
        input: {
          vehicle_id: v.id,
          // Stored the way MaintenanceRequestsView stores it — unit number plus
          // plate — so a ticket A.N.V.I.L. files is indistinguishable from one the
          // crew filed, in every list and report that reads vname.
          vehicle_label: `${v.name} (${v.plate || "No Plate"})`,
          vehicle_type: v.type || "truck",
          issue_type: issue,
          urgency,
          notes,
        },
        summary: `File a ${urgency} maintenance request on ${v.name} (${v.plate || "no plate"}) for "${issue}"${notes ? `, noting: ${notes}` : ""}.`,
      };
    }

    case "schedule_maintenance_request": {
      const day = String(input.scheduled_date || "").trim();
      if (!DAY_RE.test(day)) {
        return { error: "The date must be a calendar day in YYYY-MM-DD form." };
      }
      const { data, error } = await admin
        .from("maintenance_requests")
        .select("id, vname, type, status")
        .eq("company_id", companyId)
        .eq("id", input.request_id)
        .maybeSingle();
      if (error) return { error: error.message };
      if (!data) return { error: `No maintenance request found with id ${input.request_id}.` };
      if (data.status !== "pending") {
        return {
          error: `That request is already ${data.status}, so there is nothing to schedule. Tell the user rather than changing it.`,
        };
      }

      return {
        input: { request_id: data.id, scheduled_date: day },
        summary: `Schedule the ${data.type || "service"} on ${data.vname || "that vehicle"} for ${day}, moving the ticket from pending to scheduled.`,
      };
    }

    case "adjust_stock": {
      const qty = Number(input.new_quantity);
      if (!Number.isFinite(qty) || qty < 0) {
        return { error: "The corrected quantity must be a number of zero or more." };
      }
      const { data, error } = await admin
        .from("inventory")
        .select("id, name, unit, batches")
        .eq("company_id", companyId)
        .limit(500);
      if (error) return { error: error.message };
      const found = matchOne(data || [], input.item_name, ["name"], "inventory item");
      if (found.error) return { error: found.error };
      const item = found.row;

      const current = onHand(item);
      // Rounded to the same two places the modal's number input accepts, so the
      // signed quantity is exactly the one the summary states.
      const target = Math.round(qty * 100) / 100;
      if (target === current) {
        return {
          error: `${item.name} is already at ${current} ${item.unit || "units"} — nothing to correct.`,
        };
      }
      const delta = Math.round((target - current) * 100) / 100;
      const reason = String(input.reason || "").trim();

      return {
        input: { item_id: item.id, item_name: item.name, new_quantity: target, reason },
        summary: `Correct ${item.name} from ${current} to ${target} ${item.unit || "units"} (${delta > 0 ? "+" : ""}${delta})${reason ? `, reason: ${reason}` : ""}.`,
      };
    }

    case "log_mileage": {
      const miles = Number(input.mileage);
      if (!Number.isFinite(miles) || miles < 0) {
        return { error: "The odometer reading must be a number of zero or more." };
      }
      const { data, error } = await admin
        .from("vehicles")
        .select("id, name, plate, mi")
        .eq("company_id", companyId)
        .limit(200);
      if (error) return { error: error.message };
      const found = matchOne(data || [], input.vehicle_name, ["name", "plate"], "vehicle");
      if (found.error) return { error: found.error };
      const v = found.row;

      const reading = Math.round(miles);
      const previous = Number(v.mi) || 0;
      // An odometer does not run backwards. A reading below the last one is a
      // typo or the wrong truck far more often than it is a cluster swap, and
      // accepting it corrupts every miles-since-service figure derived from it.
      if (reading < previous) {
        return {
          error: `${v.name} already reads ${previous} miles, so ${reading} would run the odometer backwards. Check the number or the vehicle with the user.`,
        };
      }

      return {
        input: { vehicle_id: v.id, vehicle_name: v.name, mileage: reading, previous },
        summary: `Log ${reading} miles on ${v.name} (${v.plate || "no plate"}), up ${reading - previous} from ${previous}.`,
      };
    }

    default:
      return { error: `Unknown action: ${tool}` };
  }
}

// ── Phase two: execute ─────────────────────────────────────────────────────

/**
 * Commits a confirmed action. Assumes verifyAction() already passed.
 *
 * Re-checks the permission regardless: the token proves the input is the one
 * that was shown, not that the user still holds the permission. Five minutes is
 * long enough for an admin to have revoked it.
 *
 * Returns { ok: true, message, audit } or { error }. `audit` is what the caller
 * writes to audit_logs — this module does not write the trail itself, so that
 * the action and its log entry stay visibly together in chat.js.
 */
export async function executeAction(admin, { perms, caller, actorName, tool, input }) {
  const perm = ACTION_PERM[tool];
  if (!perm) return { error: `Unknown action: ${tool}` };
  if (!perms[perm]) return { error: PERM_DENIED[perm] };

  const companyId = caller.companyId;

  switch (tool) {
    case "file_maintenance_request": {
      const { data, error } = await admin
        .from("maintenance_requests")
        .insert([
          {
            company_id: companyId,
            vid: input.vehicle_id,
            vname: input.vehicle_label,
            vtype: input.vehicle_type,
            type: input.issue_type,
            urgency: input.urgency,
            notes: input.notes,
            uname: actorName,
            uid: caller.userId,
            status: "pending",
            at: new Date().toISOString(),
          },
        ])
        .select("id")
        .single();
      if (error) return { error: error.message };
      return {
        ok: true,
        message: `Filed. The ${input.issue_type} request on ${input.vehicle_label} is in as ${input.urgency} urgency, pending a manager scheduling it.`,
        audit: {
          action_type: "MAINTENANCE_REQUEST_CREATE",
          description: `A.N.V.I.L. filed a ${input.urgency} ${input.issue_type} request on ${input.vehicle_label}`,
          metadata: { request_id: data?.id, vehicle_id: input.vehicle_id, via: "anvil" },
        },
      };
    }

    case "schedule_maintenance_request": {
      // Still filtered on pending, so a manager who scheduled or closed the
      // ticket in the seconds since the preview wins — this matches zero rows
      // rather than overwriting a decision a person already made.
      const { data, error } = await admin
        .from("maintenance_requests")
        .update({ status: "scheduled", scheduled_date: input.scheduled_date })
        .eq("company_id", companyId)
        .eq("id", input.request_id)
        .eq("status", "pending")
        .select("id, vname, type");
      if (error) return { error: error.message };
      if (!data || data.length === 0) {
        return {
          error:
            "That request is no longer pending — somebody moved it in the last few moments. Nothing was changed.",
        };
      }
      return {
        ok: true,
        message: `Scheduled. The ${data[0].type || "service"} on ${data[0].vname || "that vehicle"} is booked for ${input.scheduled_date}.`,
        audit: {
          action_type: "FLEET_MAINTENANCE",
          description: `A.N.V.I.L. scheduled request ${input.request_id} for ${input.scheduled_date}`,
          metadata: {
            request_id: input.request_id,
            scheduled_date: input.scheduled_date,
            via: "anvil",
          },
        },
      };
    }

    case "adjust_stock": {
      // Batches are re-read here rather than carried in the token: the token's
      // job is to pin the TARGET quantity the user agreed to, and the
      // correction must be computed against whatever is genuinely on the shelf
      // at write time. Carrying a five-minute-old batch list forward would
      // overwrite a receive or a pull that happened in between.
      const { data: live, error: readError } = await admin
        .from("inventory")
        .select("id, name, unit, batches")
        .eq("company_id", companyId)
        .eq("id", input.item_id)
        .maybeSingle();
      if (readError) return { error: readError.message };
      if (!live) return { error: `${input.item_name} is no longer in inventory. Nothing changed.` };

      const before = onHand(live);
      const batches = applyStockCorrection(live.batches || [], input.new_quantity, {
        byUserId: caller.userId,
        byName: actorName,
        reason: input.reason,
      });

      const { error: writeError } = await admin
        .from("inventory")
        .update({ batches })
        .eq("company_id", companyId)
        .eq("id", input.item_id);
      if (writeError) return { error: writeError.message };

      return {
        ok: true,
        message: `Corrected. ${live.name} now reads ${input.new_quantity} ${live.unit || "units"}, ${input.new_quantity >= before ? "up" : "down"} from ${before}.`,
        audit: {
          action_type: "INV_MUTATION",
          description: `A.N.V.I.L. corrected ${live.name} from ${before} to ${input.new_quantity}${input.reason ? ` (${input.reason})` : ""}`,
          metadata: {
            item_id: input.item_id,
            from: before,
            to: input.new_quantity,
            reason: input.reason || null,
            via: "anvil",
          },
        },
      };
    }

    case "log_mileage": {
      const { data: live, error: readError } = await admin
        .from("vehicles")
        .select("id, name, mi, mil")
        .eq("company_id", companyId)
        .eq("id", input.vehicle_id)
        .maybeSingle();
      if (readError) return { error: readError.message };
      if (!live) {
        return { error: `${input.vehicle_name} is no longer in the fleet. Nothing changed.` };
      }

      const previous = Number(live.mi) || 0;
      // Re-checked against the LIVE reading, not the one in the token: a driver
      // may have logged a higher number in the meantime, which makes this one
      // stale rather than merely out of order.
      if (input.mileage < previous) {
        return {
          error: `${live.name} now reads ${previous} miles — higher than the ${input.mileage} that was confirmed. Somebody logged it already, so nothing was changed.`,
        };
      }

      // Appended to the same mileage log the Fleet page writes, so the oil
      // projection (_shared/oilForecast.js) learns from this reading too — a
      // bare `mi` update would move the odometer without giving the forecast
      // the dated point it needs.
      const log = Array.isArray(live.mil) ? live.mil : [];
      const { error: writeError } = await admin
        .from("vehicles")
        .update({
          mi: input.mileage,
          mil: [...log, { dt: today(), mi: input.mileage, by: caller.userId }],
        })
        .eq("company_id", companyId)
        .eq("id", input.vehicle_id);
      if (writeError) return { error: writeError.message };

      return {
        ok: true,
        message: `Logged. ${live.name} reads ${input.mileage} miles, up ${input.mileage - previous}.`,
        audit: {
          action_type: "FLEET_MAINTENANCE",
          description: `A.N.V.I.L. logged ${input.mileage} miles on ${live.name}`,
          metadata: {
            vehicle_id: input.vehicle_id,
            from: previous,
            to: input.mileage,
            via: "anvil",
          },
        },
      };
    }

    default:
      return { error: `Unknown action: ${tool}` };
  }
}
