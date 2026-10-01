// src/platform/OwnerConsole.jsx
//
// The platform owner's console — the "local company dashboard" from the original
// thread. Visible ONLY to a platform admin (you), and every action it takes goes
// through a SECURITY DEFINER RPC in supabase/06_platform_admin.sql that re-checks
// is_platform_admin() server-side. Hiding this view in the UI is convenience;
// the real gate is in the database, so a non-owner poking the same RPCs gets nothing.
import { useEffect, useState } from "react";
import { supabase, getAccessToken } from "@/shared/utils/supabase";
import { C, tot, todayLocal } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import { BRAND, TrussMark } from "@/shared/components/SteadwerkMark";
import { useNotify } from "@/shared/context/NotificationContext";
import { logAction } from "@/shared/utils/logger";
import { BASE_SEATS } from "@/features/billing/seatPacks";
import { downloadCSV } from "@/shared/utils/csvExport";
import {
  Row,
  Stack,
  Text,
  Eyebrow,
  Muted,
  Card,
  CardGrid,
  Table,
  Bdg,
  Btn,
  Fld,
  Inp,
  Modal,
  EmptyState,
  LoadingState,
} from "@/shared/components/UIPrimitives";

// Same duplication note as the pricing block atop LandingPage.jsx and the pricing
// constants in supabase/30_platform_revenue.sql: these dollar figures must match
// the real Stripe Prices this endpoint charges (STRIPE_BASE_PRICE_ID /
// STRIPE_ANNUAL_PRICE_ID). Nothing reconciles the three copies automatically —
// change what Stripe charges, change all three, or the modal quotes a number
// checkout doesn't honor.
const BASE_PRICE_MONTHLY = 99;
const BASE_PRICE_ANNUAL = 990;

// Bdg colors: the same pasture/slate/warn/subtle/rust washes this table used
// to spell out by hand.
const STATUS_STYLE = {
  active: { color: "green", label: "Active" },
  trialing: { color: "sky", label: "Trial" },
  past_due: { color: "amber", label: "Past due" },
  canceled: { color: "gray", label: "Canceled" },
  suspended: { color: "red", label: "Suspended" },
};

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Whole dollars. Every amount here is a monthly subscription total, so the cents
// are always .00 or .50 and showing them just adds noise to a scanned column.
function fmtMoney(n) {
  return `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtBytes(b) {
  const n = Number(b) || 0;
  if (n === 0) return "—";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function OwnerConsole({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  const [companies, setCompanies] = useState([]);
  const [usage, setUsage] = useState({}); // company_id -> { total_bytes, object_count }
  const [revenue, setRevenue] = useState({}); // company_id -> admin_revenue_summary row
  const [padmins, setPadmins] = useState([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "" });
  // Hard-delete confirmation: the company pending deletion + the name the owner
  // must retype to arm the button. Null when the modal is closed.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Start-billing modal: the comped company being converted to a real Stripe
  // subscription, plus the two fields Checkout needs that admin_create_company
  // never collected (there was no card yet to attach an email or cadence to).
  const [billingTarget, setBillingTarget] = useState(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [billingInterval, setBillingInterval] = useState("monthly");
  const [startingBilling, setStartingBilling] = useState(false);
  // Read-only cross-company drill-in: the company being inspected + its fetched data.
  const [viewCompany, setViewCompany] = useState(null);
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewBilling, setViewBilling] = useState(null); // admin-billing payload, or { error }

  // Load a target company's operational data READ-ONLY. This works because a platform
  // admin's RLS already permits reading any company's rows; we just query with an
  // explicit company filter. Nothing here writes — it's oversight, not impersonation.
  const openCompanyView = async (company) => {
    setViewCompany(company);
    setViewData(null);
    setViewBilling(null);
    setViewLoading(true);
    try {
      const [jobsRes, invRes, memsRes] = await Promise.all([
        supabase.from("jobs").select("*").eq("company_id", company.id),
        supabase.from("inventory").select("*").eq("company_id", company.id),
        supabase.from("memberships").select("user_id, role, active").eq("company_id", company.id),
      ]);
      const mems = memsRes.data || [];
      const memberIds = mems.map((m) => m.user_id);
      const { data: profs } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name, name, email").in("id", memberIds)
        : { data: [] };
      const roleByUser = Object.fromEntries(mems.map((m) => [m.user_id, m]));
      const members = (profs || []).map((p) => ({
        ...p,
        role: roleByUser[p.id]?.role,
        active: roleByUser[p.id]?.active,
      }));
      setViewData({ jobs: jobsRes.data || [], inventory: invRes.data || [], members });

      // Billing comes from Stripe, so it is fetched separately and allowed to fail
      // on its own. A Stripe outage should cost you the invoice list, not the whole
      // drill-in.
      try {
        const accessToken = await getAccessToken();
        const res = await fetch("/.netlify/functions/admin-billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, companyId: company.id }),
        });
        const bill = await res.json().catch(() => ({}));
        setViewBilling(res.ok && bill.ok ? bill : { error: bill.error || `HTTP ${res.status}` });
      } catch (err) {
        setViewBilling({ error: err.message });
      }
    } catch (err) {
      showToast(`${t.ocLoadCompanyFail.replace("{name}", company.name)} ${err.message}`, "error");
      setViewData({ jobs: [], inventory: [], members: [] });
    } finally {
      setViewLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: usageRows }, { data: adminRows }, { data: revRows }] =
      await Promise.all([
        supabase.rpc("admin_list_companies"),
        supabase.rpc("admin_storage_usage"),
        supabase.rpc("admin_list_platform_admins"),
        supabase.rpc("admin_revenue_summary"),
      ]);
    if (error) showToast(`${t.ocLoadCompaniesFail} ${error.message}`, "error");
    else setCompanies(data || []);
    setUsage(Object.fromEntries((usageRows || []).map((u) => [u.company_id, u])));
    setPadmins(adminRows || []);
    // Keyed by company id so the table can look a row's revenue up without a second
    // pass. An empty map (migration 30 not run yet) leaves the column showing "—"
    // rather than breaking the console.
    setRevenue(Object.fromEntries((revRows || []).map((r) => [r.id, r])));
    setLoading(false);
  };

  // CSV export of the columns useful for reaching out to customers — name, slug,
  // billing contact (supabase/47), status, and MRR. Built client-side from data
  // already loaded, so it always matches exactly what the table shows.
  const exportCompaniesCsv = () => {
    const headers = ["Company", "Slug", "Billing contact", "Status", "MRR", "Users", "Created"];
    const rows = companies.map((co) => [
      co.name,
      co.slug,
      co.billing_contact_name || "",
      co.subscription_status,
      revenue[co.id]?.mrr ?? "",
      co.user_count ?? "",
      co.created_at ? co.created_at.slice(0, 10) : "",
    ]);
    downloadCSV(`steadwerk-companies-${todayLocal()}.csv`, headers, rows);
  };

  const grantAdmin = async (e) => {
    e.preventDefault();
    const email = adminEmail.trim().toLowerCase();
    if (!email) return;
    const { error } = await supabase.rpc("admin_set_platform_admin", {
      target_email: email,
      value: true,
    });
    if (error) showToast(error.message, "error");
    else {
      showToast(t.ocNowPlatformAdmin.replace("{email}", email), "success");
      setAdminEmail("");
      await load();
    }
  };

  const revokeAdmin = async (email) => {
    if (email === user.email && !window.confirm(t.ocRevokeOwnConfirm)) return;
    const { error } = await supabase.rpc("admin_set_platform_admin", {
      target_email: email,
      value: false,
    });
    if (error) showToast(error.message, "error");
    else {
      showToast(t.ocNoLongerAdmin.replace("{email}", email), "success");
      await load();
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Belt-and-suspenders: the DB already refuses non-owners, but don't even render
  // the console to one.
  if (!user?.isPlatformAdmin) {
    return <EmptyState message={t.ocRestricted} style={{ margin: 40 }} />;
  }

  const setStatus = async (company, status) => {
    const verb =
      status === "suspended" ? t.ocVerbSuspend : status === "active" ? t.ocVerbReactivate : status;
    const warning = status === "suspended" ? ` ${t.ocSuspendWarning}` : "";
    if (
      !window.confirm(
        `${t.ocStatusConfirm.replace("{verb}", verb).replace("{name}", company.name)}${warning}`,
      )
    )
      return;
    setBusyId(company.id);
    const { error } = await supabase.rpc("admin_set_company_status", {
      target: company.id,
      new_status: status,
    });
    if (error) showToast(`${t.ocFailed} ${error.message}`, "error");
    else {
      showToast(
        t.ocStatusChanged.replace("{name}", company.name).replace("{status}", status),
        "success",
      );
      await load();
    }
    setBusyId(null);
  };

  // Hard delete — irreversible. Routes through the delete-company function, which
  // re-checks platform-admin, that the company is suspended, and the typed name.
  // It also cancels Stripe, purges storage, and reaps orphaned logins server-side.
  const deleteCompany = async () => {
    if (!deleteTarget || confirmText.trim() !== deleteTarget.name || deleting) return;
    setDeleting(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/delete-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          companyId: deleteTarget.id,
          confirmName: confirmText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const warn =
        Array.isArray(data.warnings) && data.warnings.length
          ? ` ${t.ocCleanupWarn} ${data.warnings.join("; ")}`
          : "";
      showToast(
        `${t.ocDeleted.replace("{name}", deleteTarget.name)}${warn}`,
        warn ? "warning" : "success",
      );
      setDeleteTarget(null);
      setConfirmText("");
      await load();
    } catch (err) {
      showToast(`${t.ocDeleteFailed} ${err.message}`, "error");
    } finally {
      setDeleting(false);
    }
  };

  // Opens a real Stripe Checkout Session for a comped company via
  // start-company-billing.js, then hands the platform admin off to it in a new tab
  // to enter a card. The company itself only flips to billed once stripe-webhook.js
  // sees that session complete — this call just starts that process, same as
  // clicking "Start your company" on the public signup does for a new one.
  const startBilling = async () => {
    const email = billingEmail.trim().toLowerCase();
    if (!billingTarget || !email || startingBilling) return;
    setStartingBilling(true);
    // Open the tab NOW, synchronously, still inside the click's call stack — before
    // either await below yields control. A browser only allows window.open to bypass
    // its popup blocker when it happens in direct, synchronous response to a user
    // gesture; call it after an await (as this used to) and Safari/Chrome silently
    // drop it, no error, nothing to catch. We fill this blank tab in once the real
    // Stripe URL comes back, rather than opening a second one.
    //
    // Deliberately NOT passing "noopener" here: per spec, window.open() with
    // noopener returns null — there is then no handle left to navigate once the
    // URL is known, which is exactly what was happening (the blank tab stayed
    // blank forever, and the code fell through to a second, now-async window.open
    // that the popup blocker ate). We still don't want the Stripe tab holding a
    // `window.opener` back into this one, so that's stripped by hand right below
    // instead of via the noopener flag.
    const checkoutTab = window.open("", "_blank");
    if (checkoutTab) checkoutTab.opener = null;
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/start-company-billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          companyId: billingTarget.id,
          billingEmail: email,
          billingInterval,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || `HTTP ${res.status}`);

      if (checkoutTab) checkoutTab.location.href = data.url;
      // Pre-open was itself blocked (rare, but possible under stricter settings) —
      // fall back to the direct call so at least this attempt still has a shot.
      else window.open(data.url, "_blank", "noopener");
      showToast(t.ocCheckoutOpened.replace("{name}", billingTarget.name), "success");
      setBillingTarget(null);
      setBillingEmail("");
      setBillingInterval("monthly");
    } catch (err) {
      checkoutTab?.close();
      showToast(`${t.ocStartBillingFailed} ${err.message}`, "error");
    } finally {
      setStartingBilling(false);
    }
  };

  // Step into a tenant and work as its admin. Distinct from the read-only drill-in
  // above: that is for looking, this is for fixing.
  //
  // The audit entry is written BEFORE the switch, so it lands in the owner's own
  // company log where it is attributable to them rather than appearing inside the
  // customer's history as though one of their staff did it. The reload is the same
  // reasoning as CompanySwitcher: every list and permission in memory belongs to
  // the previous company and none of it may survive the move.
  const enterCompany = async (company) => {
    if (!window.confirm(t.ocEnterConfirm.replace("{name}", company.name))) return;
    setBusyId(company.id);
    try {
      await logAction(
        user.id,
        user.email,
        "PLATFORM_ENTER_COMPANY",
        `Platform owner entered "${company.name}" (${company.slug}) as admin.`,
        { company_id: company.id },
        "production",
      );
      const { error } = await supabase.rpc("set_active_company", { target: company.id });
      if (error) throw error;
      window.location.reload();
    } catch (err) {
      showToast(`${t.ocFailed} ${err.message}`, "error");
      setBusyId(null);
    }
  };

  const slugify = (s) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const createCompany = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const slug = form.slug.trim() || slugify(name);
    if (!name) return showToast(t.ocNameRequired, "warning");
    setCreating(true);
    const { error } = await supabase.rpc("admin_create_company", {
      p_name: name,
      p_slug: slug,
      p_status: "trialing",
    });
    if (error) showToast(`${t.ocFailed} ${error.message}`, "error");
    else {
      showToast(t.ocCreated.replace("{name}", name), "success");
      setForm({ name: "", slug: "" });
      await load();
    }
    setCreating(false);
  };

  const totalActive = companies.filter((c) =>
    ["active", "trialing", "past_due"].includes(c.subscription_status),
  ).length;
  const totalBytes = Object.values(usage).reduce((s, u) => s + (Number(u.total_bytes) || 0), 0);

  // Platform MRR. Only companies the RPC marked is_billed contribute, so comped
  // tenants and trials count as zero — see the header of supabase/30 for why.
  const revRows = Object.values(revenue);
  const totalMrr = revRows.reduce((s, r) => s + (Number(r.mrr) || 0), 0);
  const payingCount = revRows.filter((r) => r.is_billed).length;
  const trialCount = revRows.filter((r) => r.subscription_status === "trialing").length;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <Row gap={5} style={{ marginBottom: 4 }}>
        <TrussMark size={26} />
        <Text
          as="h1"
          weight="black"
          color={C.navy}
          font="display"
          style={{ fontSize: 26, margin: 0 }}
        >
          {t.ocTitle}
        </Text>
      </Row>
      <Text as="p" size="md" color={C.sub} style={{ marginBottom: 18 }}>
        {companies.length} companies · {totalActive} active · {fmtBytes(totalBytes)} stored across
        the platform · signed in as {user.email}
      </Text>

      {/* ── The business, in one line ──
          MRR leads because it is the number that decides everything else. ARR is
          just MRR × 12 and is shown because it is the figure people quote, not
          because it is separately measured. Trials sit beside them rather than
          inside them: nothing has been charged yet, so folding them into revenue
          would report money that does not exist. */}
      <CardGrid minWidth={150} fit style={{ marginBottom: 24 }}>
        {[
          { label: "Monthly recurring", value: fmtMoney(totalMrr), tone: BRAND.pasture, big: true },
          { label: "Annual run rate", value: fmtMoney(totalMrr * 12), tone: C.navy },
          { label: "Paying companies", value: String(payingCount), tone: C.navy },
          {
            label: "In trial",
            value: String(trialCount),
            tone: trialCount > 0 ? BRAND.amberDeep : C.sub,
          },
        ].map((s) => (
          <Card key={s.label} pad="var(--space-6) var(--space-7)">
            <Eyebrow style={{ marginBottom: 4 }}>{s.label}</Eyebrow>
            <Text
              weight="black"
              color={s.tone}
              font="display"
              style={{ fontSize: s.big ? 28 : 22, lineHeight: 1.1 }}
            >
              {s.value}
            </Text>
          </Card>
        ))}
      </CardGrid>

      {/* Create company */}
      <Card as="form" onSubmit={createCompany} style={{ marginBottom: 24 }}>
        <Row gap={4} align="flex-end" wrap>
          <Fld label={t.ocNewCompany} style={{ flex: "1 1 220px", marginBottom: 0 }}>
            <Inp
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  name: e.target.value,
                  slug: f.slug || slugify(e.target.value),
                }))
              }
              placeholder={t.ocNamePlaceholder}
            />
          </Fld>
          <Fld label={t.ocSlug} style={{ flex: "1 1 180px", marginBottom: 0 }}>
            <Inp
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder={t.ocSlugPlaceholder}
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </Fld>
          <Btn v="gold" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create company"}
          </Btn>
        </Row>
      </Card>

      {/* Company table */}
      <Row justify="flex-end" style={{ marginBottom: 10 }}>
        <Btn v="ghost" onClick={exportCompaniesCsv} disabled={companies.length === 0}>
          {t.ocExportCsv}
        </Btn>
      </Row>
      <Card pad="none" style={{ overflow: "hidden" }}>
        <Table pad="xl" size="md" minWidth={820}>
          <thead>
            <tr>
              {[
                "Company",
                "Status",
                "MRR",
                "Users",
                "Storage",
                "Created",
                "Last activity",
                "Actions",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <Text
                  as="td"
                  colSpan={8}
                  color={C.sub}
                  style={{ padding: 24, textAlign: "center" }}
                >
                  {t.ocLoading}
                </Text>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <Text
                  as="td"
                  colSpan={8}
                  color={C.sub}
                  style={{ padding: 24, textAlign: "center" }}
                >
                  {t.ocNoCompanies}
                </Text>
              </tr>
            ) : (
              companies.map((co) => {
                const st = STATUS_STYLE[co.subscription_status] || {
                  color: "gray",
                  label: co.subscription_status,
                };
                const suspended = co.subscription_status === "suspended";
                const rev = revenue[co.id];
                return (
                  <tr key={co.id}>
                    <td>
                      <Text weight="bold" color={C.navy}>
                        {co.name}
                      </Text>
                      <Muted style={{ fontFamily: "var(--font-mono)" }}>{co.slug}</Muted>
                    </td>
                    <td>
                      <Bdg color={st.color}>{st.label}</Bdg>
                    </td>
                    {/* Comped and trialing companies show a dash, not $0. Zero reads
                        as "this customer pays nothing", which is a problem; a dash
                        reads as "not billed", which is the actual situation. */}
                    <td>
                      {!rev ? (
                        <Text as="span" color={C.sub}>
                          —
                        </Text>
                      ) : rev.is_billed ? (
                        <>
                          <Text as="span" weight="extrabold" color={BRAND.pasture}>
                            {fmtMoney(rev.mrr)}
                          </Text>
                          {rev.billing_interval === "annual" && (
                            <Muted
                              as="span"
                              style={{ marginLeft: 5 }}
                              title="Billed annually, shown as its monthly equivalent"
                            >
                              annual
                            </Muted>
                          )}
                          {rev.recurring_packs > 0 && (
                            <Muted>
                              base + {rev.recurring_packs} pack
                              {rev.recurring_packs === 1 ? "" : "s"}
                            </Muted>
                          )}
                        </>
                      ) : (
                        <Text
                          as="span"
                          color={C.sub}
                          title={
                            co.subscription_status === "trialing"
                              ? "In trial — nothing charged yet"
                              : "No Stripe subscription (comped)"
                          }
                        >
                          {co.subscription_status === "trialing" ? "trial" : "comped"}
                        </Text>
                      )}
                    </td>
                    <Text as="td" color={C.navy}>
                      {co.active_user_count}
                      {co.user_count !== co.active_user_count ? (
                        <Text as="span" color={C.sub}>
                          {" "}
                          / {co.user_count}
                        </Text>
                      ) : null}
                      {rev?.grandfathered_packs > 0 && (
                        <Muted title="Seat packs bought under the old one-time pricing. They grant capacity but are never billed again.">
                          +{rev.grandfathered_packs} grandfathered
                        </Muted>
                      )}
                    </Text>
                    <Text as="td" color={C.sub} title={`${usage[co.id]?.object_count || 0} files`}>
                      {fmtBytes(usage[co.id]?.total_bytes)}
                    </Text>
                    <Text as="td" color={C.sub}>
                      {fmtDate(co.created_at)}
                    </Text>
                    <Text as="td" color={C.sub}>
                      {fmtDate(co.last_activity)}
                    </Text>
                    <td>
                      <Row align="stretch" wrap>
                        <Btn
                          v="outline"
                          tone={C.blue}
                          sz="sm"
                          onClick={() => openCompanyView(co)}
                          disabled={busyId === co.id}
                        >
                          {t.ocView}
                        </Btn>
                        {/* Not offered for the company you are already in — there is
                            nowhere to go, and the button would look like a no-op. */}
                        {co.id !== user.companyId && (
                          <Btn
                            v="outline"
                            tone={C.plum}
                            sz="sm"
                            onClick={() => enterCompany(co)}
                            disabled={busyId === co.id}
                          >
                            {t.ocEnter}
                          </Btn>
                        )}
                        {/* Only offered where BillingView would otherwise show "comped":
                            not already billed, not mid-trial (Stripe already owns that
                            clock), not suspended, and never on Steadwerk's own tenant —
                            the platform operator has no reason to bill itself. slug is
                            what supabase/32 keys is_platform_company off of; that flag
                            itself isn't in admin_list_companies()'s column list, so the
                            slug is the cheapest correct check without widening it. */}
                        {rev &&
                          !rev.is_billed &&
                          co.subscription_status !== "trialing" &&
                          co.slug !== "steadwerk" &&
                          !suspended && (
                            <Btn
                              v="green"
                              sz="sm"
                              onClick={() => {
                                setBillingTarget(co);
                                setBillingEmail("");
                                setBillingInterval("monthly");
                              }}
                              disabled={busyId === co.id}
                            >
                              {t.ocStartBilling}
                            </Btn>
                          )}
                        {suspended ? (
                          <>
                            <Btn
                              v="green"
                              sz="sm"
                              onClick={() => setStatus(co, "active")}
                              disabled={busyId === co.id}
                            >
                              {t.ocReactivate}
                            </Btn>
                            {/* Delete is offered ONLY on suspended rows — suspend-then-delete is the
                                deliberate two-step that keeps a live company one click from safety. */}
                            <Btn
                              v="danger"
                              sz="sm"
                              onClick={() => {
                                setDeleteTarget(co);
                                setConfirmText("");
                              }}
                              disabled={busyId === co.id}
                            >
                              {t.ocDelete}
                            </Btn>
                          </>
                        ) : (
                          <Btn
                            v="outline"
                            tone={BRAND.rust}
                            sz="sm"
                            onClick={() => setStatus(co, "suspended")}
                            disabled={busyId === co.id}
                          >
                            {t.ocSuspend}
                          </Btn>
                        )}
                      </Row>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </Card>

      {/* ── Platform administrators ──
          Only a platform admin can grant/revoke this role (enforced by the RPC),
          and the last one can never be removed. This is how the capability spreads —
          by an existing owner's hand, never self-assigned. */}
      <Card pad="var(--space-8)" style={{ marginTop: 24 }}>
        <Eyebrow style={{ marginBottom: 4 }}>{t.ocPlatformAdmins}</Eyebrow>
        <Muted size="sm" style={{ marginBottom: 14 }}>
          {t.ocPlatformAdminsDesc}
        </Muted>

        <Stack gap={3} style={{ marginBottom: 16 }}>
          {padmins.map((a) => (
            <Row
              key={a.id}
              gap={4}
              justify="space-between"
              style={{ padding: "8px 12px", background: C.lg, borderRadius: 8 }}
            >
              <div>
                <Text as="span" weight="bold" color={C.navy}>
                  {a.full_name || a.email}
                </Text>
                <Muted as="span" size="sm" style={{ marginLeft: 8 }}>
                  {a.email}
                </Muted>
                {a.email === user.email && (
                  <Text
                    as="span"
                    size="xs"
                    weight="extrabold"
                    color={BRAND.pasture}
                    style={{ marginLeft: 8 }}
                  >
                    you
                  </Text>
                )}
              </div>
              <Btn
                v="outline"
                sz="sm"
                tone={BRAND.rust}
                onClick={() => revokeAdmin(a.email)}
                disabled={padmins.length === 1}
                title={padmins.length === 1 ? "Can't remove the last platform admin" : "Revoke"}
              >
                {t.ocRevoke}
              </Btn>
            </Row>
          ))}
        </Stack>

        <Row onSubmit={grantAdmin} as="form" align="stretch" wrap>
          <Inp
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder={t.ocPromotePlaceholder}
            style={{ flex: "1 1 240px", width: "auto" }}
          />
          <Btn type="submit">{t.ocGrantAdmin}</Btn>
        </Row>
        <Muted style={{ marginTop: 8 }}>
          The person must already have a Steadwerk login. Granting doesn't add them to any company —
          it's platform-wide oversight only.
        </Muted>
      </Card>

      {/* ── Start-billing confirmation ──
          Collects the two things Checkout needs that a comped company never had a
          reason to have on file: who to bill, and which cadence. Everything else
          (price ids, trial-free subscription_data) is decided server-side in
          start-company-billing.js, same as create-checkout.js decides them for a
          brand-new signup. */}
      {billingTarget && (
        <Modal
          title={
            <Text as="span" color={BRAND.pasture}>
              {t.ocStartBillingTitle.replace("{name}", billingTarget.name)}
            </Text>
          }
          onClose={() => !startingBilling && setBillingTarget(null)}
        >
          <Text as="p" size="base" color={C.navy} style={{ lineHeight: 1.6, margin: "0 0 16px" }}>
            {t.ocStartBillingDesc
              .replace(
                "{price}",
                billingInterval === "annual"
                  ? t.ocAnnualRate.replace("{price}", `$${BASE_PRICE_ANNUAL}`)
                  : t.ocMonthlyRate.replace("{price}", `$${BASE_PRICE_MONTHLY}`),
              )
              .replace("{seats}", BASE_SEATS)}
          </Text>
          <Fld label={t.ocBillingEmail}>
            <Inp
              autoFocus
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startBilling()}
              placeholder={t.ocBillingEmailPlaceholder}
              disabled={startingBilling}
            />
          </Fld>
          <Fld label={t.ocBillingCadence}>
            <Row align="stretch">
              {["monthly", "annual"].map((iv) => (
                <Btn
                  key={iv}
                  type="button"
                  v={billingInterval === iv ? "green" : "ghost"}
                  aria-pressed={billingInterval === iv}
                  onClick={() => setBillingInterval(iv)}
                  disabled={startingBilling}
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  {iv === "monthly" ? t.ocMonthly : t.ocAnnual}
                </Btn>
              ))}
            </Row>
          </Fld>
          <Row gap={4} justify="flex-end" style={{ marginTop: 22 }}>
            <Btn v="ghost" onClick={() => setBillingTarget(null)} disabled={startingBilling}>
              {t.ocCancel}
            </Btn>
            <Btn
              v="green"
              onClick={startBilling}
              disabled={startingBilling || !billingEmail.trim()}
            >
              {startingBilling ? t.ocOpeningCheckout : t.ocOpenCheckout}
            </Btn>
          </Row>
        </Modal>
      )}

      {/* ── Hard-delete confirmation ──
          Irreversible, so it demands the exact company name typed back before the
          button arms. The server re-checks every guard; this is the human gate. */}
      {deleteTarget && (
        <Modal
          title={
            <Text as="span" color={BRAND.rust}>
              {t.ocDeleteTitle.replace("{name}", deleteTarget.name)}
            </Text>
          }
          onClose={() => !deleting && setDeleteTarget(null)}
        >
          <Text as="p" size="base" color={C.navy} style={{ lineHeight: 1.6, margin: "0 0 14px" }}>
            {t.ocDeleteWarning} <strong>{t.ocDeleteWarningBold}</strong> {t.ocDeleteWarningRest}
          </Text>
          <Fld
            label={
              <>
                {t.ocTypeToConfirm}{" "}
                <Text as="span" font="mono" style={{ textTransform: "none" }}>
                  {deleteTarget.name}
                </Text>{" "}
                {t.ocToConfirm}
              </>
            }
          >
            <Inp
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && deleteCompany()}
              placeholder={deleteTarget.name}
              disabled={deleting}
            />
          </Fld>
          <Row gap={4} justify="flex-end" style={{ marginTop: 20 }}>
            <Btn v="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t.ocCancel}
            </Btn>
            <Btn
              v="danger"
              onClick={deleteCompany}
              disabled={deleting || confirmText.trim() !== deleteTarget.name}
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </Btn>
          </Row>
        </Modal>
      )}

      {/* ── Read-only company drill-in ──
          Platform-admin oversight: inspect a tenant's live jobs, inventory, and team
          without leaving your own company. Read-only — nothing here writes. */}
      {viewCompany && (
        <Modal extraWide title={viewCompany.name} onClose={() => setViewCompany(null)}>
          <Text size="sm" weight="bold" color={C.sub} style={{ marginBottom: 16 }}>
            {t.ocReadOnly}
          </Text>

          {viewLoading || !viewData ? (
            <LoadingState label={t.ocLoading} />
          ) : (
            <Stack gap="22px">
              {/* Billing — Stripe's own numbers, not the modelled MRR from
                    supabase/30. When these two disagree, the price constants in
                    that migration are the thing that is wrong. */}
              <div>
                <Eyebrow style={{ fontSize: 12, marginBottom: 8 }}>Billing</Eyebrow>
                {!viewBilling ? (
                  <Text size="base" color={C.sub}>
                    {t.ocLoading}
                  </Text>
                ) : viewBilling.error ? (
                  <Text size="base" color={BRAND.rust}>
                    {viewBilling.error}
                  </Text>
                ) : !viewBilling.billed ? (
                  <Text size="base" color={C.sub}>
                    {t.ocNotBilled}
                  </Text>
                ) : (
                  <>
                    <Row gap={8} align="stretch" wrap style={{ marginBottom: 12, fontSize: 13 }}>
                      <div>
                        <Text
                          size="xs"
                          weight="extrabold"
                          color={C.sub}
                          style={{ textTransform: "uppercase" }}
                        >
                          Charging
                        </Text>
                        <Text weight="extrabold" color={C.navy}>
                          {fmtMoney(viewBilling.subscription?.total)}
                          <Text as="span" weight="semibold" color={C.sub}>
                            {viewBilling.subscription?.items?.[0]?.interval === "year"
                              ? " / year"
                              : " / month"}
                          </Text>
                        </Text>
                      </div>
                      <div>
                        <Text
                          size="xs"
                          weight="extrabold"
                          color={C.sub}
                          style={{ textTransform: "uppercase" }}
                        >
                          Renews
                        </Text>
                        <Text color={C.navy}>
                          {fmtDate(viewBilling.subscription?.currentPeriodEnd)}
                        </Text>
                      </div>
                      <div>
                        <Text
                          size="xs"
                          weight="extrabold"
                          color={C.sub}
                          style={{ textTransform: "uppercase" }}
                        >
                          Card
                        </Text>
                        <Text color={C.navy}>
                          {viewBilling.card
                            ? `${viewBilling.card.brand} ···· ${viewBilling.card.last4}`
                            : "—"}
                        </Text>
                      </div>
                      {viewBilling.subscription?.cancelAtPeriodEnd && (
                        <Text weight="extrabold" color={BRAND.rust} style={{ alignSelf: "center" }}>
                          {t.ocCancelsAtPeriodEnd}
                        </Text>
                      )}
                    </Row>

                    {viewBilling.invoices.length === 0 ? (
                      <Text size="base" color={C.sub}>
                        {t.ocNoInvoices}
                      </Text>
                    ) : (
                      <Table
                        pad="sm"
                        size="base"
                        minWidth={460}
                        style={{ border: `1px solid ${C.bd}`, borderRadius: 8 }}
                      >
                        <thead>
                          <tr>
                            {["Invoice", "Date", "Amount", "Status", ""].map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {viewBilling.invoices.map((inv) => (
                            <tr key={inv.id}>
                              <Text
                                as="td"
                                size="sm"
                                color={C.sub}
                                style={{ fontFamily: "var(--font-mono)" }}
                              >
                                {inv.number || inv.id}
                              </Text>
                              <Text as="td" color={C.sub}>
                                {fmtDate(inv.created)}
                              </Text>
                              <Text as="td" weight="bold" color={C.navy}>
                                {fmtMoney(inv.amountDue)}
                              </Text>
                              <td>
                                <Text
                                  as="span"
                                  weight="bold"
                                  color={
                                    inv.status === "paid"
                                      ? BRAND.pasture
                                      : inv.status === "open"
                                        ? BRAND.amberDeep
                                        : C.sub
                                  }
                                  style={{ textTransform: "capitalize" }}
                                >
                                  {inv.status}
                                </Text>
                              </td>
                              <td>
                                {inv.hostedUrl && (
                                  <Text
                                    href={inv.hostedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    as="a"
                                    size="sm"
                                    weight="bold"
                                    color={C.blue}
                                  >
                                    View
                                  </Text>
                                )}
                                {inv.pdfUrl && (
                                  <Text
                                    href={inv.pdfUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    as="a"
                                    size="sm"
                                    weight="bold"
                                    color={C.blue}
                                    style={{ marginLeft: 10 }}
                                  >
                                    PDF
                                  </Text>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </>
                )}
              </div>

              {/* Jobs */}
              <div>
                <Eyebrow style={{ fontSize: 12, marginBottom: 8 }}>
                  Jobs ({viewData.jobs.length})
                </Eyebrow>
                {viewData.jobs.length === 0 ? (
                  <Text size="base" color={C.sub}>
                    {t.ocNoJobs}
                  </Text>
                ) : (
                  <Table
                    pad="sm"
                    size="base"
                    minWidth={560}
                    style={{ border: `1px solid ${C.bd}`, borderRadius: 8 }}
                  >
                    <thead>
                      <tr>
                        {["Status", "PO", "Name", "Assigned", "Created"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewData.jobs.slice(0, 100).map((j) => {
                        const sup = viewData.members.find(
                          (m) => m.id === (j.assignedto || j.assignedTo),
                        );
                        return (
                          <tr key={j.id}>
                            <td style={{ textTransform: "capitalize" }}>{j.status || "—"}</td>
                            <Text as="td" color={C.sub}>
                              {j.po || "—"}
                            </Text>
                            <Text as="td" weight="semibold" color={C.navy}>
                              {j.title || j.name || "—"}
                            </Text>
                            <Text as="td" color={C.sub}>
                              {sup?.full_name || sup?.name || "—"}
                            </Text>
                            <Text as="td" color={C.sub}>
                              {fmtDate(j.created || j.createdAt)}
                            </Text>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </div>

              {/* Inventory */}
              <div>
                <Eyebrow style={{ fontSize: 12, marginBottom: 8 }}>
                  Inventory ({viewData.inventory.length})
                </Eyebrow>
                {viewData.inventory.length === 0 ? (
                  <Text size="base" color={C.sub}>
                    {t.ocNoInventory}
                  </Text>
                ) : (
                  <Table
                    pad="sm"
                    size="base"
                    minWidth={520}
                    style={{ border: `1px solid ${C.bd}`, borderRadius: 8 }}
                  >
                    <thead>
                      <tr>
                        {["Item", "Category", "On hand", "Status"].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewData.inventory.slice(0, 100).map((i) => {
                        const onHand = tot(i);
                        const low = onHand <= (i.alrt || 0);
                        return (
                          <tr key={i.id}>
                            <Text as="td" weight="semibold" color={C.navy}>
                              {i.name}
                            </Text>
                            <Text as="td" color={C.sub}>
                              {i.cat || "—"}
                            </Text>
                            <td>
                              {onHand} {i.unit || ""}
                            </td>
                            <td>
                              <Text
                                as="span"
                                weight="bold"
                                color={low ? BRAND.rust : BRAND.pasture}
                              >
                                {low ? "Low" : "OK"}
                              </Text>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </div>

              {/* Team */}
              <div>
                <Eyebrow style={{ fontSize: 12, marginBottom: 8 }}>
                  Team ({viewData.members.length})
                </Eyebrow>
                {viewData.members.length === 0 ? (
                  <Text size="base" color={C.sub}>
                    {t.ocNoMembers}
                  </Text>
                ) : (
                  <Stack gap={2}>
                    {viewData.members.map((m) => (
                      <Card
                        key={m.id}
                        variant="flat"
                        pad="7px 10px"
                        style={{ background: C.lg, border: "none", fontSize: 13 }}
                      >
                        <Row gap={4} justify="space-between">
                          <span>
                            <Text as="span" weight="bold" color={C.navy}>
                              {m.full_name || m.name || m.email}
                            </Text>{" "}
                            <Text as="span" color={C.sub} style={{ marginLeft: 6 }}>
                              {m.email}
                            </Text>
                          </span>
                          <Text
                            as="span"
                            weight="bold"
                            color={C.sub}
                            style={{ textTransform: "capitalize" }}
                          >
                            {m.role || "—"}
                            {m.active === false ? " (inactive)" : ""}
                          </Text>
                        </Row>
                      </Card>
                    ))}
                  </Stack>
                )}
              </div>
            </Stack>
          )}

          <Row justify="flex-end" style={{ marginTop: 20 }}>
            <Btn onClick={() => setViewCompany(null)}>{t.ocClose}</Btn>
          </Row>
        </Modal>
      )}
    </div>
  );
}
