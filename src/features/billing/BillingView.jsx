// src/features/billing/BillingView.jsx
//
// A company's own Billing/accounting tab. Shows the plan, seats used vs. capacity,
// and two actions: buy another 5-seat pack, and open Stripe's hosted portal to manage
// card + invoices. Admin-only within the company.
//
// Pricing shown here mirrors the Stripe prices: $99/mo base (10 users), +$10/mo per 5.
// Seat capacity is authoritative from the DB (set by the Stripe webhook); this view
// never invents it.
import { useEffect, useState } from "react";
import { supabase, getAccessToken } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import { BRAND, TrussMark } from "@/shared/components/SteadwerkMark";
import { useNotify } from "@/shared/context/NotificationContext";
import {
  Card,
  Row,
  Text,
  Eyebrow,
  Muted,
  EmptyState,
  Stack,
  Bdg,
  Divider,
  Btn,
  Inp,
  Callout,
} from "@/shared/components/UIPrimitives";

const BASE_PRICE = 99;
const BASE_SEATS = 10;
const PACK_PRICE = 10;
const PACK_SEATS = 5;
// Must match LandingPage.jsx's own ANNUAL_PRICE and the STRIPE_ANNUAL_PRICE_ID
// amount — discounted 12-month prepay, the "2 months free" option.
const ANNUAL_PRICE = 990;
const ANNUAL_SAVINGS_PCT = Math.round((1 - ANNUAL_PRICE / (BASE_PRICE * 12)) * 100);
// A member is warned once they're this far into their seat capacity, before
// changePacks/atLimit actually blocks anything.
const SEAT_WARNING_RATIO = 0.8;

import { translations } from "@/shared/utils/translations";
import { maxRemovablePacks, validatePackChange } from "./seatPacks";

export default function BillingView({ user, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  const [seats, setSeats] = useState(null); // { used, capacity }
  const [status, setStatus] = useState(null);
  // Packs bought under the old one-time pricing. Needed to work out how much of the
  // total capacity is actually billed, and therefore how much is removable.
  const [grandfatheredPacks, setGrandfatheredPacks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contactName, setContactName] = useState("");
  const [savedContactName, setSavedContactName] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [billingInterval, setBillingInterval] = useState(null); // "monthly" | "annual" | null
  const [annualBusy, setAnnualBusy] = useState(false);
  const [cardInfo, setCardInfo] = useState(null); // { hasCard, brand, last4, expMonth, expYear }

  const isAdmin = user?.role === "admin" || user?.isPlatformAdmin;

  const load = async () => {
    setLoading(true);
    const [{ data: seatRows }, { data: companyRows }] = await Promise.all([
      supabase.rpc("company_seat_status"),
      supabase.rpc("my_company"),
    ]);
    const s = Array.isArray(seatRows) ? seatRows[0] : seatRows;
    setSeats(s || null);
    const co = Array.isArray(companyRows) ? companyRows[0] : companyRows;
    setContactName(co?.billing_contact_name || "");
    setSavedContactName(co?.billing_contact_name || "");
    // subscription_status isn't returned by my_company (safe columns only); read it
    // off the current user's company via a lightweight companies select (RLS-scoped).
    const { data: statusRow } = await supabase
      .from("companies")
      .select("subscription_status, purchased_seat_packs, billing_interval")
      .maybeSingle();
    setStatus(statusRow?.subscription_status || null);
    setGrandfatheredPacks(statusRow?.purchased_seat_packs || 0);
    setBillingInterval(statusRow?.billing_interval || null);
    setLoading(false);

    // Card details are a second, non-blocking round trip — only worth making for a
    // company actually billed through Stripe, and the Payment & invoices card below
    // renders fine while this is still in flight.
    if (s?.capacity != null) {
      try {
        const accessToken = await getAccessToken();
        const res = await fetch("/.netlify/functions/billing-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) setCardInfo(data);
      } catch {
        // Non-critical — the card-expiry hint just doesn't show.
      }
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!isAdmin) {
    return <EmptyState message={t.blAdminOnly} style={{ margin: 40 }} />;
  }

  const capacity = seats?.capacity; // null = unlimited (comped)
  const used = seats?.used ?? 0;
  const packs = capacity == null ? null : Math.max(0, (capacity - BASE_SEATS) / PACK_SEATS);
  // Only the recurring packs appear on the bill. Packs bought under the old one-time
  // pricing are grandfathered: they still grant seats and are never charged again.
  const grandfathered = Math.max(0, grandfatheredPacks || 0);
  const recurring = Math.max(0, (packs ?? 0) - grandfathered);
  const monthly = capacity == null ? null : BASE_PRICE + PACK_PRICE * recurring;
  const removable = maxRemovablePacks({ recurringPacks: recurring, capacity, used });
  const nearingLimit = capacity != null && used < capacity && used / capacity >= SEAT_WARNING_RATIO;

  // Expired or expiring this month/next — a difference in total months, so it's
  // correct across a December→January boundary without any date-library math.
  let cardExpired = false;
  let cardExpiringSoon = false;
  if (cardInfo?.hasCard) {
    const now = new Date();
    const nowMonths = now.getFullYear() * 12 + (now.getMonth() + 1);
    const cardMonths = cardInfo.expYear * 12 + cardInfo.expMonth;
    const diff = cardMonths - nowMonths;
    cardExpired = diff < 0;
    cardExpiringSoon = diff >= 0 && diff <= 1;
  }

  // delta is signed: +1 buys a pack, -1 drops one. Capacity moves when the
  // subscription.updated webhook lands, so this reloads rather than guessing.
  const changePacks = async (delta) => {
    const check = validatePackChange({ delta, recurringPacks: recurring, capacity, used });
    if (!check.ok) {
      showToast(check.error, "info");
      return;
    }
    const confirmMsg =
      delta > 0
        ? t.blAddSeatsConfirm.replace("{pack}", PACK_PRICE).replace("{base}", BASE_PRICE)
        : t.blRemoveSeatsConfirm.replace("{pack}", PACK_PRICE).replace("{seats}", PACK_SEATS);
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/add-seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, delta }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Stripe emits subscription.updated, the webhook recomputes capacity, and this
      // reload picks it up. There is a beat where the two disagree; saying so is better
      // than optimistically rendering a number the database has not agreed to yet.
      showToast(delta > 0 ? t.blSeatsAdded : t.blSeatsRemoved, "success");
      await load();
    } catch (err) {
      showToast(`${delta > 0 ? t.blAddSeatsFail : t.blRemoveSeatsFail} ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveContactName = async () => {
    const trimmed = contactName.trim();
    if (!trimmed) return;
    setContactBusy(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/update-billing-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setContactName(trimmed);
      setSavedContactName(trimmed);
      showToast(t.blBillingContactSaved, "success");
    } catch (err) {
      showToast(`${t.blBillingContactFail} ${err.message}`, "error");
    } finally {
      setContactBusy(false);
    }
  };

  const switchToAnnual = async () => {
    if (!window.confirm(t.blSwitchAnnualConfirm)) return;
    setAnnualBusy(true);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/.netlify/functions/switch-billing-interval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      showToast(t.blSwitchAnnualDone, "success");
      await load();
    } catch (err) {
      showToast(`${t.blSwitchAnnualFail} ${err.message}`, "error");
    } finally {
      setAnnualBusy(false);
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
      showToast(`${t.blOpenBillingFail} ${err.message}`, "error");
      setBusy(false);
    }
  };

  const atLimit = capacity != null && used >= capacity;

  return (
    <div style={{ padding: "24px 28px", maxWidth: 640, margin: "0 auto" }}>
      <Row gap={4} style={{ marginBottom: 20 }}>
        <TrussMark size={24} />
        <Text
          as="h1"
          weight="black"
          color={C.navy}
          font="display"
          style={{ fontSize: 24, margin: 0 }}
        >
          {t.blTitle}
        </Text>
      </Row>

      {loading ? (
        <Text color={C.sub}>{t.blLoading}</Text>
      ) : (
        <>
          {/* Plan */}
          <Card variant="flat" pad="var(--space-8)" style={{ marginBottom: 16 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t.blPlan}</Eyebrow>
            {capacity == null ? (
              <Text size="xl" weight="extrabold" color={C.navy}>
                {t.blComplimentary}
              </Text>
            ) : (
              <>
                <Text size="3xl" weight="black" color={C.navy}>
                  ${monthly}
                  <Text as="span" size="md" weight="semibold" color={C.sub}>
                    /month
                  </Text>
                </Text>
                <Text size="base" color={C.sub} style={{ marginTop: 4 }}>
                  ${BASE_PRICE} base ({BASE_SEATS} users)
                  {recurring > 0 &&
                    ` · ${recurring} crew pack${recurring > 1 ? "s" : ""} at $${PACK_PRICE}/mo (${recurring * PACK_SEATS} seats)`}
                  {/* Called out separately so it is obvious these are not on the bill. */}
                  {grandfathered > 0 &&
                    ` · ${grandfathered} pack${grandfathered > 1 ? "s" : ""} already paid for (${grandfathered * PACK_SEATS} seats, no charge)`}
                </Text>
              </>
            )}
            {status && status !== "active" && (
              <Stack gap={0} align="flex-start" style={{ marginTop: 10 }}>
                <Bdg color={status === "past_due" ? "amber" : "red"}>
                  {status === "past_due" ? "Payment past due — update your card below" : status}
                </Bdg>
              </Stack>
            )}
            {/* Only a monthly company sees this — an annual one already has it, and a
                comped company (capacity == null) has no Stripe billing to switch. */}
            {capacity != null && billingInterval === "monthly" && (
              <>
                <Divider style={{ margin: "14px 0" }} />
                <Text size="base" color={C.sub} style={{ marginBottom: 10 }}>
                  {t.blSwitchAnnualBlurb
                    .replace("{price}", ANNUAL_PRICE)
                    .replace("{pct}", ANNUAL_SAVINGS_PCT)}
                </Text>
                <Btn v="ghost" onClick={switchToAnnual} disabled={annualBusy}>
                  {t.blSwitchAnnual}
                </Btn>
              </>
            )}
          </Card>

          {/* Billing contact — who to address on receipts, invoices, and any custom
              email sent about this account. Stripe only ever knows the company
              name, not a person; this is the one place that person's name lives.
              See supabase/47. */}
          <Card variant="flat" pad="var(--space-8)" style={{ marginBottom: 16 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t.blBillingContact}</Eyebrow>
            <Text size="base" color={C.sub} style={{ marginBottom: 12 }}>
              {t.blBillingContactBlurb}
            </Text>
            <Row gap={4} align="stretch" wrap>
              <Inp
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder={t.blBillingContactPlaceholder}
                style={{ flex: "1 1 220px", width: "auto", color: C.navy }}
              />
              <Btn
                v="gold"
                onClick={saveContactName}
                disabled={
                  contactBusy || !contactName.trim() || contactName.trim() === savedContactName
                }
              >
                {t.blSaveContact}
              </Btn>
            </Row>
          </Card>

          {/* Seats */}
          <Card variant="flat" pad="var(--space-8)" style={{ marginBottom: 16 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t.blUsers}</Eyebrow>
            <Text size="3xl" weight="black" color={atLimit ? BRAND.rust : C.navy}>
              {used}
              {capacity != null ? (
                <Text as="span" weight="semibold" color={C.sub}>
                  {" "}
                  / {capacity}
                </Text>
              ) : (
                <Text as="span" size="md" weight="semibold" color={C.sub}>
                  {" "}
                  (unlimited)
                </Text>
              )}
            </Text>
            {atLimit && (
              <Text size="base" color={BRAND.rust} style={{ marginTop: 6 }}>
                {t.blSeatLimit}
              </Text>
            )}
            {/* A quiet nudge before atLimit actually blocks anything — so an admin
                can add a pack ahead of it stopping someone mid-invite. */}
            {!atLimit && nearingLimit && (
              <Text size="base" color={BRAND.amberDeep} style={{ marginTop: 6 }}>
                {t.blSeatsNearLimit}
              </Text>
            )}
            {capacity != null && (
              <>
                <Row gap={4} align="stretch" wrap style={{ marginTop: 12 }}>
                  <Btn v="gold" onClick={() => changePacks(1)} disabled={busy}>
                    + Add {PACK_SEATS} seats (${PACK_PRICE}/mo)
                  </Btn>
                  {/* Only ever offers to drop a pack that is actually being billed, and
                      never one that would strand users already using the seats. */}
                  <Btn
                    v="ghost"
                    onClick={() => changePacks(-1)}
                    disabled={busy || removable === 0}
                    title={removable === 0 ? t.blRemoveBlocked : undefined}
                  >
                    − Remove {PACK_SEATS} seats
                  </Btn>
                </Row>
                <Muted size="sm" style={{ marginTop: 8 }}>
                  {t.blProrationNote}
                </Muted>
              </>
            )}
          </Card>

          {/* Manage
              A comped company has no Stripe customer at all — admin_create_company
              makes the company row, and only create-checkout.js ever creates a
              customer. billing-portal.js therefore has nothing to open and returns
              "No billing account for this company yet".
              capacity == null is the marker for comped, set by supabase/09: only
              Stripe-billed companies carry a numeric ceiling. The card above
              already says "Complimentary" off the same signal, so offering a
              payment portal underneath it was the screen contradicting itself. */}
          <Card variant="flat" pad="var(--space-8)" style={{ marginBottom: 16 }}>
            <Eyebrow style={{ marginBottom: 8 }}>{t.blPaymentInvoices}</Eyebrow>
            {capacity == null ? (
              <Text size="base" color={C.sub} style={{ lineHeight: 1.6 }}>
                {t.blNoBillingAccount}
              </Text>
            ) : (
              <>
                {(cardExpired || cardExpiringSoon) && (
                  <Callout
                    tone={cardExpired ? "danger" : "warn"}
                    pad="sm"
                    size="base"
                    weight="bold"
                    color={cardExpired ? BRAND.rust : BRAND.amberDeep}
                    style={{ marginBottom: 12 }}
                  >
                    {(cardExpired ? t.blCardExpired : t.blCardExpiringSoon)
                      .replace("{last4}", cardInfo.last4)
                      .replace("{month}", String(cardInfo.expMonth).padStart(2, "0"))
                      .replace("{year}", cardInfo.expYear)}
                  </Callout>
                )}
                <Text size="base" color={C.sub} style={{ marginBottom: 12 }}>
                  {t.blPortalBlurb}
                </Text>
                <Btn v="ghost" onClick={openPortal} disabled={busy}>
                  {t.blManagePayment}
                </Btn>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
