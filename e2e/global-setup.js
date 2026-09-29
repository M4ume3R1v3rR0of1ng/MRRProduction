// e2e/global-setup.js
//
// Seeds one disposable company, its members, two stocked inventory items and one
// truck, using the service-role key exactly like scripts/verify-tenant-isolation.mjs
// does — a real company/user/session, not a mock. Runs once before the whole
// Playwright run; global-teardown.js removes everything it creates.
//
// State is handed to the spec files through a JSON file rather than an
// exported value, because Playwright's globalSetup and the test files run in
// separate processes with no shared memory.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSupabaseEnv } from "./env.js";
import { totpCode, totpStep } from "./totp.js";

const STATE_FILE = path.join(fileURLToPath(new URL(".", import.meta.url)), ".e2e-state.json");
const TEST_SLUG = "zz-e2e-test";

const newPassword = () => `Test-${Math.random().toString(36).slice(2)}-9xQ!`;

export default async function globalSetup() {
  const { url, anonKey, serviceKey } = loadSupabaseEnv();
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Leftovers from a previous run that crashed before teardown ran.
  const { data: stale } = await admin
    .from("companies")
    .select("id")
    .eq("slug", TEST_SLUG)
    .maybeSingle();
  if (stale) await admin.from("companies").delete().eq("id", stale.id);

  const { data: company, error: companyErr } = await admin
    .from("companies")
    .insert({ name: "ZZ E2E Test Co", slug: TEST_SLUG, subscription_status: "active" })
    .select("id")
    .single();
  if (companyErr) throw companyErr;

  const runId = Date.now();
  const createdUserIds = [];
  try {
    await seed({ url, anonKey, admin, company, runId, createdUserIds });
  } catch (err) {
    // No state file yet, so global-teardown.js can't know what to remove — undo
    // it here instead of leaving auth users behind a half-seeded company.
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
    await admin.from("companies").delete().eq("id", company.id);
    throw err;
  }
}

async function seed({ url, anonKey, admin, company, runId, createdUserIds }) {
  // An auth user plus the membership and profile rows a real invite would leave
  // behind. The password is returned so a spec can sign in as them.
  const createMember = async (key, fullName, role) => {
    const email = `e2e-${key}-${runId}@example.invalid`;
    const password = newPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    const userId = data.user.id;
    createdUserIds.push(userId);
    await admin
      .from("memberships")
      .insert({ user_id: userId, company_id: company.id, role, active: true });
    await admin
      .from("profiles")
      .update({ full_name: fullName, active_company_id: company.id, active: true })
      .eq("id", userId);
    return { userId, email, password, name: fullName };
  };

  const adminUser = await createMember("admin", "ZZ E2E Admin", "admin");

  // A member with a role BuildJobsView's approve modal will actually offer as an
  // assignee (fieldUsers = role "field" or "Site Supervisor"). Never signed in —
  // just needs to exist so the "Assign to Site Supervisor" dropdown has
  // something to select.
  const supervisor = await createMember("supervisor", "ZZ E2E Supervisor", "field");

  // A driver: "employee" holds maint_submit but not maint_manage, so this is the
  // account that files a maintenance ticket without being able to act on it.
  const driver = await createMember("driver", "ZZ E2E Driver", "employee");

  // An account with a verified TOTP factor. The admin API can list and delete
  // factors but not create one, so enrolment goes through the user's own session,
  // the same enroll -> challengeAndVerify sequence MfaPanel.jsx runs, answered
  // with a code computed from the returned secret.
  //
  // A failure here is recorded rather than thrown: it only makes the MFA spec
  // meaningless, and should fail that spec by name instead of every other flow.
  // (In practice: "MFA enroll is disabled for TOTP" when the project has TOTP
  // turned off under Authentication → Multi-Factor in the Supabase dashboard.)
  const mfaUser = await createMember("mfa", "ZZ E2E MFA User", "admin");
  let mfaSecret = null;
  let mfaEnrolledStep = null;
  let mfaSetupError = null;
  try {
    const asMfaUser = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: mfaSignInErr } = await asMfaUser.auth.signInWithPassword({
      email: mfaUser.email,
      password: mfaUser.password,
    });
    if (mfaSignInErr) throw mfaSignInErr;
    const { data: enrolled, error: enrollErr } = await asMfaUser.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "e2e authenticator",
    });
    if (enrollErr) throw enrollErr;
    mfaEnrolledStep = totpStep();
    const { error: verifyErr } = await asMfaUser.auth.mfa.challengeAndVerify({
      factorId: enrolled.id,
      code: totpCode(enrolled.totp.secret, mfaEnrolledStep),
    });
    if (verifyErr) throw verifyErr;
    mfaSecret = enrolled.totp.secret;
    await asMfaUser.auth.signOut();
  } catch (err) {
    mfaSetupError = err.message || String(err);
  }

  // Catalog items. Shape mirrors the real insert in
  // src/features/inventory/ItemFormModal.jsx — company_id is set explicitly
  // here because that field is normally filled by a DB trigger keyed off the
  // caller's session, which the service-role key has none of.
  const seedItem = async (key, name, unit, qty) => {
    const id = `i_e2e_${key}_${runId}`;
    const { error } = await admin.from("inventory").insert({
      id,
      company_id: company.id,
      name,
      cat: "Roofing Materials",
      unit,
      alrt: 5,
      batches: [
        {
          id: `b_e2e_${key}_${runId}`,
          rcvd: new Date().toISOString().slice(0, 10),
          qty,
          rem: qty,
          price: 25,
          by: adminUser.userId,
        },
      ],
    });
    if (error) throw error;
    return { id, name, unit, qty };
  };

  // Enough stock that the pipeline's 1-unit pull never trips the shortfall dialog.
  const pipelineItem = await seedItem("pipe", "ZZ E2E Test Shingle", "bundle", 100);
  // Its own item, so the receiving spec's arithmetic doesn't depend on whether
  // the pipeline spec has pulled from the other one yet.
  const receivingItem = await seedItem("rcv", "ZZ E2E Receiving Underlayment", "roll", 10);

  // One truck for the maintenance spec. Shape mirrors buildVehicle() in
  // src/features/fleet/AddVehicleModal.jsx.
  const vehicle = {
    id: `v_e2e_${runId}`,
    name: "ZZ-E2E-01",
    plate: "E2E-0001",
    type: "truck",
    yr: 2020,
    make: "Ford",
    model: "F-250",
    mi: 50000,
  };
  const { error: vehErr } = await admin.from("vehicles").insert({
    ...vehicle,
    company_id: company.id,
    lomi: vehicle.mi,
    oii: 5000,
    dii: 90,
    ldd: new Date().toISOString().slice(0, 10),
    mil: [],
    sl: [],
    assignedTo: "",
    status: "active",
  });
  if (vehErr) throw vehErr;

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      {
        companyId: company.id,
        // Every auth user created above, for global-teardown.js.
        userIds: createdUserIds,
        adminUserId: adminUser.userId,
        adminEmail: adminUser.email,
        adminPassword: adminUser.password,
        adminName: adminUser.name,
        supervisorUserId: supervisor.userId,
        supervisorName: supervisor.name,
        driverEmail: driver.email,
        driverPassword: driver.password,
        driverName: driver.name,
        mfaEmail: mfaUser.email,
        mfaPassword: mfaUser.password,
        mfaSecret,
        mfaEnrolledStep,
        mfaSetupError,
        itemName: pipelineItem.name,
        receivingItem,
        vehicle,
      },
      null,
      2,
    ),
  );
}

export { STATE_FILE };
