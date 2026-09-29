// src/test/fakeSupabase.js
//
// A recording stand-in for the Supabase client, for component tests that press a
// button and need to know what it wrote.
//
// Swapped in underneath utils/supabase.js rather than in place of it:
//
//     vi.mock("@supabase/supabase-js", async () => {
//       const { fakeSupabase } = await import("@/test/fakeSupabase");
//       return { createClient: () => fakeSupabase };
//     });
//
// Mocking utils/supabase.js itself would not work. updateRowStrict reaches the
// client through that module's own local binding, so replacing the export leaves
// the real client behind it. Replacing createClient means updateRowStrict,
// isTransportError and logAction all run for real, against this.
//
// Every query and rpc is recorded on `calls` once it is awaited. By default each
// one succeeds with the answer a healthy database would give: an update matched
// its row, an insert read back what it wrote, a select found nothing. A test that
// wants something else scripts it with respond(), and the first matching script
// wins, so a test's own script overrides the defaults below.
//
// One instance per test file (module state), cleared by reset() in beforeEach.

const calls = [];
let scripts = [];

const matches = (match, call) =>
  typeof match === "function"
    ? match(call)
    : Object.entries(match).every(([k, v]) => call[k] === v);

function defaultResult(call) {
  if (call.op === "rpc") return { data: null, error: null };
  if (call.op === "select") return { data: call.single ? null : [], error: null };
  if (!call.returning) return { data: null, error: null };
  // updateRowStrict reads back `id` and treats an empty array as "no such row".
  if (call.op === "update") return { data: [{ id: call.filters.id }], error: null };
  if (call.op === "insert") {
    return { data: call.payload.map((row, i) => ({ id: `new-${i + 1}`, ...row })), error: null };
  }
  return { data: [], error: null };
}

function resolve(call) {
  calls.push(call);
  const hit = scripts.find((s) => matches(s.match, call));
  if (!hit) return defaultResult(call);
  if (hit.once) scripts = scripts.filter((s) => s !== hit);
  const result = typeof hit.result === "function" ? hit.result(call) : hit.result;
  return { data: null, error: null, ...result };
}

// Chainable and awaitable, like postgrest-js. Nothing is recorded until the chain
// is awaited, so `call` always carries the finished shape of the query.
function thenable(call) {
  const b = {
    then: (ok, fail) =>
      Promise.resolve()
        .then(() => resolve(call))
        .then(ok, fail),
  };
  return b;
}

function from(table) {
  const call = { table, op: "select", payload: undefined, filters: {}, returning: false };
  const b = thenable(call);
  const chain =
    (fn) =>
    (...args) => {
      fn(...args);
      return b;
    };
  Object.assign(b, {
    select: chain((columns) => {
      if (call.op === "select") call.columns = columns;
      else call.returning = true;
    }),
    insert: chain((rows) => Object.assign(call, { op: "insert", payload: rows })),
    upsert: chain((rows) => Object.assign(call, { op: "upsert", payload: rows })),
    update: chain((fields) => Object.assign(call, { op: "update", payload: fields })),
    delete: chain(() => (call.op = "delete")),
    eq: chain((col, v) => (call.filters[col] = v)),
    in: chain((col, vs) => (call.filters[col] = vs)),
    order: chain(() => {}),
    limit: chain(() => {}),
    single: chain(() => (call.single = true)),
    maybeSingle: chain(() => (call.single = true)),
  });
  return b;
}

export const fakeSupabase = {
  from,
  rpc: (fn, args) => thenable({ op: "rpc", fn, args }),
  auth: {
    getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    refreshSession: async () => ({ data: { session: { access_token: "test-token" } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
};

// Script the answer to the next matching call(s). `match` is a partial call
// ({ table: "jobs", op: "update" }, { fn: "commit_job_materials" }) or a predicate;
// `result` is { data, error } or a function of the call returning one.
export function respond(match, result, { once = false } = {}) {
  scripts.unshift({ match, result, once });
}

export function reset() {
  calls.length = 0;
  scripts = [];
}

// Every call so far, in the order it was awaited.
export const allCalls = () => [...calls];

// What changed the database, minus the audit trail — the question most tests ask.
// Audit writes are left out so a test about a job does not also have to account
// for logAction; use auditLog() for those.
export const writes = () => calls.filter((c) => c.op !== "select" && c.table !== "audit_logs");

// The action_types logAction wrote, in order.
export const auditLog = () =>
  calls.filter((c) => c.table === "audit_logs").map((c) => c.payload[0].action_type);

export const rpcCalls = (fn) => calls.filter((c) => c.op === "rpc" && c.fn === fn);
