// src/views/BillingView.jsx
//
// A company's own Billing/accounting tab. Shows the plan, seats used vs. capacity,
// and two actions: buy another 5-seat pack, and open Stripe's hosted portal to manage
// card + invoices. Admin-only within the company.
//
// Pricing shown here mirrors the Stripe prices: $99/mo base (10 users), +$10/mo per 5.
// Seat capacity is authoritative from the DB (set by the Stripe webhook); this view
// never invents it.
import { useEffect, useState } from "react";
import { supabase, getAccessToken } from "../utils/supabase";
import { C } from "../utils/helpers";
import { BRAND, TrussMark } from "../components/SteadwerkMark";
import { useNotify } from "../context/NotificationContext";

const BASE_PRICE = 99;
const BASE_SEATS = 10;
const PACK_PRICE = 10;
const PACK_SEATS = 5;

export default function BillingView({ user }) {
  const { showToast } = useNotify();
  const [seats, setSeats] = useState(null); // { used, capacity }
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "admin" || user?.isPlatformAdmin;

  const load = async () => {
    setLoading(true);
    const [{ data: seatRows }, { data: co }] = await Promise.all([
      supabase.rpc("company_seat_status"),
      supabase.rpc("my_company"),
    ]);
    const s = Array.isArray(seatRows) ? seatRows[0] : seatRows;
    setSeats(s || null);
    // subscription_status isn't returned by my_company (safe columns only); read it
    // off the current user's company via a lightweight companies select (RLS-scoped).
    const { data: statusRow } = await supabase.from("companies").select("subscription_status").maybeSingle();
    setStatus(statusRow?.subscription_status || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: "center", color: C.sub }}>Billing is managed by your company's administrator.</div>;
  }

  const capacity = seats?.capacity; // null = unlimited (comped)
  const used = seats?.used ?? 0;
  const packs = capacity == null ? null : Math.max(0, (capacity - BASE_SEATS) / PACK_SEATS);
  const monthly = capacity == null ? null : BASE_PRICE + (packs || 0) * PACK_PRICE;

  const buyPack = async () => {
    if (!window.confirm(`Add 5 seats for $${PACK_PRICE}/month? Your card is charged a prorated amount now, then the new total each month.`)) return;
    setBusy(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/add-seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, packs: 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast("5 seats added.", "success");
      await load();
    } catch (err) {
      showToast(`Could not add seats: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/billing-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "No billing account yet.");
      window.location.href = data.url;
    } catch (err) {
      showToast(`Could not open billing: ${err.message}`, "error");
      setBusy(false);
    }
  };

  const card = { background: C.w, border: `1px solid ${C.bd}`, borderRadius: 12, padding: 20, marginBottom: 16 };
  const atLimit = capacity != null && used >= capacity;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <TrussMark size={24} />
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 900, color: C.navy, margin: 0 }}>Billing</h1>
      </div>

      {loading ? (
        <div style={{ color: C.sub }}>Loading…</div>
      ) : (
        <>
          {/* Plan */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Plan</div>
            {capacity == null ? (
              <div style={{ fontSize: 18, fontWeight: 800, color: C.navy }}>Complimentary — unlimited users</div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.navy }}>${monthly}<span style={{ fontSize: 14, color: C.sub, fontWeight: 600 }}>/month</span></div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>
                  ${BASE_PRICE} base ({BASE_SEATS} users){packs > 0 ? ` + ${packs} × $${PACK_PRICE} pack${packs > 1 ? "s" : ""} (${packs * PACK_SEATS} extra)` : ""}
                </div>
              </>
            )}
            {status && status !== "active" && (
              <div style={{ marginTop: 10, display: "inline-block", background: status === "past_due" ? "#F7EBDA" : "#F7E4DA", color: status === "past_due" ? BRAND.amberDeep : BRAND.rust, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 800 }}>
                {status === "past_due" ? "Payment past due — update your card below" : status}
              </div>
            )}
          </div>

          {/* Seats */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Users</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: atLimit ? BRAND.rust : C.navy }}>
              {used}{capacity != null ? <span style={{ color: C.sub, fontWeight: 600 }}> / {capacity}</span> : <span style={{ fontSize: 14, color: C.sub, fontWeight: 600 }}> (unlimited)</span>}
            </div>
            {atLimit && <div style={{ fontSize: 13, color: BRAND.rust, marginTop: 6 }}>You're at your seat limit. Add a pack to invite more users.</div>}
            {capacity != null && (
              <button onClick={buyPack} disabled={busy}
                style={{ marginTop: 12, padding: "10px 16px", background: C.gold, color: C.navy, border: "none", borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: busy ? "wait" : "pointer" }}>
                + Add 5 seats (${PACK_PRICE}/mo)
              </button>
            )}
          </div>

          {/* Manage */}
          <div style={card}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Payment & invoices</div>
            <div style={{ fontSize: 13, color: C.sub, marginBottom: 12 }}>Update your card, download invoices, and see billing history on Stripe's secure portal.</div>
            <button onClick={openPortal} disabled={busy}
              style={{ padding: "10px 16px", background: "transparent", color: C.navy, border: `1.5px solid ${C.bd}`, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: busy ? "wait" : "pointer" }}>
              Manage payment & invoices →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
