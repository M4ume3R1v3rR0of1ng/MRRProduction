import { describe, it, expect, beforeAll } from "vitest";
import {
  applyStockCorrection,
  signAction,
  verifyAction,
  previewAction,
  executeAction,
  ACTION_TOOLS,
} from "./anvilActions.js";

// signingKey() reads this at call time, so it only has to exist before the
// first sign/verify — not at import.
beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});

const caller = { userId: "u1", companyId: "c1", email: "driver@example.com" };
const allPerms = {
  maint_submit: true,
  maint_manage: true,
  inv_adjust: true,
  fleet_log_mi: true,
};

// A minimal stand-in for the PostgREST builder, recording what was asked for.
// Only the shapes anvilActions actually chains are implemented — anything else
// throwing is the point, since a new query shape should fail loudly here rather
// than silently resolve to undefined.
function fakeAdmin(tables, { onUpdate, onInsert } = {}) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const builder = {
        _filters: {},
        select() {
          return builder;
        },
        eq(col, val) {
          builder._filters[col] = val;
          return builder;
        },
        limit() {
          return Promise.resolve({ data: rows, error: null });
        },
        maybeSingle() {
          const match = rows.find((r) =>
            Object.entries(builder._filters).every(
              ([k, v]) => k === "company_id" || String(r[k]) === String(v),
            ),
          );
          return Promise.resolve({ data: match || null, error: null });
        },
        insert(payload) {
          onInsert?.(table, payload);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "new-row" }, error: null }),
            }),
          };
        },
        update(changes) {
          const chain = {
            _f: {},
            eq(col, val) {
              chain._f[col] = val;
              return chain;
            },
            select() {
              onUpdate?.(table, changes, chain._f);
              const matched = rows.filter((r) =>
                Object.entries(chain._f).every(
                  ([k, v]) => k === "company_id" || String(r[k]) === String(v),
                ),
              );
              return Promise.resolve({ data: matched, error: null });
            },
            then(resolve) {
              onUpdate?.(table, changes, chain._f);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
      return builder;
    },
  };
}

const batch = (rcvd, rem, price = 10) => ({ id: `b-${rcvd}`, rcvd, qty: rem, rem, price });

// This is a port of src/features/inventory/AdjustStockModal.jsx's function of
// the same name, and these cases exist to keep it one. If the frontend's
// behavior changes, this should fail.
describe("applyStockCorrection", () => {
  it("adds a single correction batch when the count came out high", () => {
    const result = applyStockCorrection([batch("2026-01-01", 10, 7)], 15, { byUserId: "u1" });
    expect(result).toHaveLength(2);
    expect(result[1].rem).toBe(5);
    // Found stock is valued at the newest known price, not zero — otherwise it
    // deflates the cost of every later pull that consumes it.
    expect(result[1].price).toBe(7);
    expect(result[1].ref).toContain("ANVIL");
  });

  it("drains oldest-first when the count came out low, matching how a pull consumes", () => {
    const result = applyStockCorrection([batch("2026-01-01", 10), batch("2026-02-01", 10)], 12, {});
    // 8 taken off the oldest batch, the newest untouched. Draining newest-first
    // would strand the cheapest units on the shelf forever.
    expect(result.find((b) => b.rcvd === "2026-01-01").rem).toBe(2);
    expect(result.find((b) => b.rcvd === "2026-02-01").rem).toBe(10);
  });

  it("drains across batches when one is not enough", () => {
    const result = applyStockCorrection([batch("2026-01-01", 4), batch("2026-02-01", 10)], 2, {});
    expect(result.find((b) => b.rcvd === "2026-01-01").rem).toBe(0);
    expect(result.find((b) => b.rcvd === "2026-02-01").rem).toBe(2);
  });

  it("records who made the correction by name as well as id", () => {
    const [, added] = applyStockCorrection([batch("2026-01-01", 1)], 5, {
      byUserId: "u1",
      byName: "Jane Contractor",
      reason: "monthly count",
    });
    expect(added.by).toBe("u1");
    // An id alone cannot survive the person being removed — see utils/people.
    expect(added.byName).toBe("Jane Contractor");
    expect(added.ref).toContain("monthly count");
  });
});

describe("verifyAction", () => {
  const future = Date.now() + 60_000;
  const input = { item_id: "i1", item_name: "Shingles", new_quantity: 400, reason: "" };
  const good = () => ({
    tool: "adjust_stock",
    input,
    expiresAt: future,
    signature: signAction({ tool: "adjust_stock", input, ...caller, expiresAt: future }),
  });

  it("accepts the action it signed", () => {
    expect(verifyAction(good(), caller)).toEqual({ ok: true });
  });

  // The whole point of signing: the write that lands is the one the person saw.
  it("rejects a tampered quantity", () => {
    const tampered = { ...good(), input: { ...input, new_quantity: 40 } };
    const result = verifyAction(tampered, caller);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not match/i);
  });

  it("rejects a confirmation replayed by a different user", () => {
    expect(verifyAction(good(), { ...caller, userId: "someone-else" }).ok).toBe(false);
  });

  it("rejects a confirmation aimed at another company", () => {
    expect(verifyAction(good(), { ...caller, companyId: "c2" }).ok).toBe(false);
  });

  it("rejects an expired confirmation", () => {
    const past = Date.now() - 1000;
    const stale = {
      tool: "adjust_stock",
      input,
      expiresAt: past,
      signature: signAction({ tool: "adjust_stock", input, ...caller, expiresAt: past }),
    };
    expect(verifyAction(stale, caller).error).toMatch(/expired/i);
  });

  it("is indifferent to the key order the model happened to use", () => {
    // The model's argument order is not stable between turns, so the payload is
    // canonicalized before signing and before verifying.
    const reordered = {
      ...good(),
      input: { reason: "", new_quantity: 400, item_name: "Shingles", item_id: "i1" },
    };
    expect(verifyAction(reordered, caller)).toEqual({ ok: true });
  });

  it("refuses an unsigned or malformed action instead of throwing", () => {
    expect(verifyAction(null, caller).ok).toBe(false);
    expect(verifyAction({ tool: "adjust_stock", input, expiresAt: future }, caller).ok).toBe(false);
    expect(verifyAction({ tool: "drop_tables", input, expiresAt: future }, caller).ok).toBe(false);
  });
});

describe("previewAction", () => {
  const vehicles = [
    { id: "v1", name: "011", plate: "ABC123", type: "truck", mi: 50000 },
    { id: "v2", name: "012", plate: "XYZ789", type: "truck", mi: 10000 },
    { id: "v3", name: "0110", plate: "QQQ111", type: "truck", mi: 1000 },
  ];
  const inventory = [
    {
      id: "i1",
      name: "Architectural Shingles",
      unit: "bundle",
      batches: [batch("2026-01-01", 100)],
    },
    { id: "i2", name: "Ridge Shingles", unit: "bundle", batches: [batch("2026-01-01", 20)] },
  ];

  it("writes nothing and hands back a signed, confirmable summary", async () => {
    let wrote = false;
    const admin = fakeAdmin({ vehicles }, { onInsert: () => (wrote = true) });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "file_maintenance_request",
      input: { vehicle_name: "011", issue_type: "Brakes", urgency: "high", notes: "pulling left" },
    });

    expect(wrote).toBe(false);
    expect(result.requires_confirmation).toBe(true);
    expect(result.summary).toContain("011");
    expect(result.summary).toContain("Brakes");
    expect(verifyAction(result.action, caller)).toEqual({ ok: true });
    // Resolved to the label the crew's own tickets use, so a ticket ANVIL files
    // is indistinguishable in every list that reads vname.
    expect(result.action.input.vehicle_label).toBe("011 (ABC123)");
  });

  it("refuses an action the user lacks the permission for, before touching the data", async () => {
    const admin = fakeAdmin({ vehicles });
    const result = await previewAction(admin, {
      perms: { maint_submit: false },
      caller,
      tool: "file_maintenance_request",
      input: { vehicle_name: "011", issue_type: "Brakes" },
    });
    expect(result.error).toMatch(/permission/i);
    expect(result.requires_confirmation).toBeUndefined();
  });

  it("asks which item rather than guessing between two that match", async () => {
    const admin = fakeAdmin({ inventory });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "adjust_stock",
      input: { item_name: "shingles", new_quantity: 50 },
    });
    expect(result.error).toMatch(/more than one/i);
    expect(result.error).toContain("Architectural Shingles");
  });

  it("lets an exact name win over a longer partial match", async () => {
    // "011" also appears inside "0110" — that is not genuine ambiguity.
    const admin = fakeAdmin({ vehicles });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "log_mileage",
      input: { vehicle_name: "011", mileage: 51000 },
    });
    expect(result.requires_confirmation).toBe(true);
    expect(result.action.input.vehicle_id).toBe("v1");
  });

  it("states the before, after and difference for a stock correction", async () => {
    const admin = fakeAdmin({ inventory });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "adjust_stock",
      input: { item_name: "Architectural", new_quantity: 92, reason: "monthly count" },
    });
    expect(result.summary).toContain("from 100 to 92");
    expect(result.summary).toContain("(-8)");
    expect(result.summary).toContain("monthly count");
  });

  it("refuses a correction that changes nothing", async () => {
    const admin = fakeAdmin({ inventory });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "adjust_stock",
      input: { item_name: "Architectural", new_quantity: 100 },
    });
    expect(result.error).toMatch(/already at 100/);
  });

  it("refuses an odometer reading that runs backwards", async () => {
    const admin = fakeAdmin({ vehicles });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "log_mileage",
      input: { vehicle_name: "012", mileage: 9000 },
    });
    expect(result.error).toMatch(/backwards/i);
  });

  it("refuses a scheduling date that is not a calendar day", async () => {
    const admin = fakeAdmin({ maintenance_requests: [] });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "schedule_maintenance_request",
      input: { request_id: "r1", scheduled_date: "next Tuesday" },
    });
    expect(result.error).toMatch(/YYYY-MM-DD/);
  });

  it("will not reschedule a ticket somebody has already moved", async () => {
    const admin = fakeAdmin({
      maintenance_requests: [
        { id: "r1", vname: "011 (ABC123)", type: "Oil Change", status: "completed" },
      ],
    });
    const result = await previewAction(admin, {
      perms: allPerms,
      caller,
      tool: "schedule_maintenance_request",
      input: { request_id: "r1", scheduled_date: "2026-11-02" },
    });
    expect(result.error).toMatch(/already completed/i);
  });
});

describe("executeAction", () => {
  it("re-checks the permission even though the token verified", async () => {
    // Five minutes is long enough for an admin to have revoked it.
    const admin = fakeAdmin({ inventory: [] });
    const result = await executeAction(admin, {
      perms: {},
      caller,
      actorName: "Jane",
      tool: "adjust_stock",
      input: { item_id: "i1", item_name: "Shingles", new_quantity: 5 },
    });
    expect(result.error).toMatch(/permission/i);
  });

  it("computes the correction against live batches, not the ones previewed", async () => {
    // A receive landed between the preview and the confirm. The target quantity
    // is what the user agreed to; the arithmetic must run against the shelf as
    // it is now, or the write would undo that receive.
    let written = null;
    const admin = fakeAdmin(
      {
        inventory: [
          {
            id: "i1",
            name: "Shingles",
            unit: "bundle",
            batches: [batch("2026-01-01", 100), batch("2026-03-01", 50)],
          },
        ],
      },
      { onUpdate: (_t, changes) => (written = changes) },
    );

    const result = await executeAction(admin, {
      perms: allPerms,
      caller,
      actorName: "Jane",
      tool: "adjust_stock",
      input: { item_id: "i1", item_name: "Shingles", new_quantity: 140, reason: "count" },
    });

    expect(result.ok).toBe(true);
    const remaining = written.batches.reduce((s, b) => s + b.rem, 0);
    expect(remaining).toBe(140);
    expect(result.message).toContain("down from 150");
    expect(result.audit.action_type).toBe("INV_MUTATION");
    expect(result.audit.metadata.via).toBe("anvil");
  });

  it("appends to the mileage log so the oil projection sees the reading", async () => {
    let written = null;
    const admin = fakeAdmin(
      { vehicles: [{ id: "v1", name: "011", mi: 50000, mil: [{ dt: "2026-01-01", mi: 48000 }] }] },
      { onUpdate: (_t, changes) => (written = changes) },
    );
    const result = await executeAction(admin, {
      perms: allPerms,
      caller,
      actorName: "Jane",
      tool: "log_mileage",
      input: { vehicle_id: "v1", vehicle_name: "011", mileage: 51000, previous: 50000 },
    });
    expect(result.ok).toBe(true);
    expect(written.mi).toBe(51000);
    // A bare `mi` update would move the odometer without giving the forecast
    // the dated point it needs (see _shared/oilForecast.js).
    expect(written.mil).toHaveLength(2);
    expect(written.mil[1].mi).toBe(51000);
    expect(written.mil[1].by).toBe("u1");
  });

  it("refuses a confirmed reading that a driver has since overtaken", async () => {
    const admin = fakeAdmin({ vehicles: [{ id: "v1", name: "011", mi: 52000, mil: [] }] });
    const result = await executeAction(admin, {
      perms: allPerms,
      caller,
      actorName: "Jane",
      tool: "log_mileage",
      input: { vehicle_id: "v1", vehicle_name: "011", mileage: 51000, previous: 50000 },
    });
    expect(result.error).toMatch(/logged it already/i);
    expect(result.ok).toBeUndefined();
  });

  it("files a request under the confirming user, scoped to their company", async () => {
    let inserted = null;
    const admin = fakeAdmin({ maintenance_requests: [] }, { onInsert: (_t, p) => (inserted = p) });
    await executeAction(admin, {
      perms: allPerms,
      caller,
      actorName: "Jane Contractor",
      tool: "file_maintenance_request",
      input: {
        vehicle_id: "v1",
        vehicle_label: "011 (ABC123)",
        vehicle_type: "truck",
        issue_type: "Brakes",
        urgency: "high",
        notes: "pulling left",
      },
    });
    // company_id defaults to active_company_id(), which is NULL under a
    // service-role client — so passing it explicitly is load-bearing.
    expect(inserted[0].company_id).toBe("c1");
    expect(inserted[0].uid).toBe("u1");
    expect(inserted[0].uname).toBe("Jane Contractor");
    expect(inserted[0].status).toBe("pending");
  });

  it("will not schedule a ticket that stopped being pending mid-confirm", async () => {
    // The .eq("status", "pending") filter makes the update match zero rows
    // rather than overwriting a decision a person already made.
    const admin = fakeAdmin({
      maintenance_requests: [{ id: "r1", status: "completed", vname: "011", type: "Oil Change" }],
    });
    const result = await executeAction(admin, {
      perms: allPerms,
      caller,
      actorName: "Jane",
      tool: "schedule_maintenance_request",
      input: { request_id: "r1", scheduled_date: "2026-11-02" },
    });
    expect(result.error).toMatch(/no longer pending/i);
  });
});

describe("ACTION_TOOLS definitions", () => {
  it("tells the model plainly that calling one does not commit anything", () => {
    // A model that reads a preview as a failure retries in a loop, so every
    // write tool's description has to say this.
    for (const tool of ACTION_TOOLS) {
      expect(tool.description).toMatch(/does NOT/);
    }
  });

  it("requires the fields each write cannot be built without", () => {
    const byName = Object.fromEntries(ACTION_TOOLS.map((t) => [t.name, t]));
    expect(byName.adjust_stock.input_schema.required).toEqual(["item_name", "new_quantity"]);
    expect(byName.log_mileage.input_schema.required).toEqual(["vehicle_name", "mileage"]);
    expect(byName.schedule_maintenance_request.input_schema.required).toEqual([
      "request_id",
      "scheduled_date",
    ]);
  });
});
