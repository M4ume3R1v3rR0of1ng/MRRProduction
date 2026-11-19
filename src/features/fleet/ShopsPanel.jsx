// src/features/fleet/ShopsPanel.jsx
//
// Fleet → Shops: the outside shops a company's trucks go to, each with its
// contact details, what it handles, the work it has done and what that cost.
// Data and rules: supabase/67_fleet_shops.sql. History math: ./shops.js.
//
// Everyone in the company can see this list (a driver needs the shop's phone
// number). Only fleet_edit holders see Add, Edit, Archive and Find Past Records,
// and the database enforces the same line (shops_write policy), so hiding the
// buttons is a courtesy, not the lock.
import { useMemo, useState } from "react";
import { Store, Phone, Mail, MapPin, User, Plus, Link2 } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import {
  Btn,
  Bdg,
  Fld,
  Inp,
  TA,
  Modal,
  EmptyState,
  CardGrid,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Card,
} from "@/shared/components/UIPrimitives";
import { useNotify } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";
import { logAction } from "@/shared/utils/logger";
import { shopHistory, shopFormError, parseSpecialties } from "./shops";

const money = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtDay = (d) => {
  if (!d) return "";
  const day = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return Number.isNaN(day.getTime()) ? String(d) : day.toLocaleDateString();
};

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  contact: "",
  specialties: "",
  notes: "",
};

export default function ShopsPanel({
  shopsApi,
  vehs,
  setVehs,
  reqs,
  setReqs,
  perms,
  user,
  lang = "en",
}) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();
  const { shops, loading, missing, saveShop } = shopsApi;
  const canEdit = !!perms?.fleet_edit;

  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState(null);
  // null = closed; { id?: string, ...EMPTY_FORM } = open on that shop
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState(false);

  const histories = useMemo(
    () => Object.fromEntries(shops.map((s) => [s.id, shopHistory(s, vehs, reqs)])),
    [shops, vehs, reqs],
  );

  const listed = shops
    .filter((s) => showArchived || s.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const archivedCount = shops.filter((s) => s.active === false).length;
  const open = shops.find((s) => s.id === openId) || null;

  const startEdit = (shop) =>
    setEditing(
      shop
        ? {
            id: shop.id,
            name: shop.name || "",
            phone: shop.phone || "",
            email: shop.email || "",
            address: shop.address || "",
            contact: shop.contact || "",
            specialties: (shop.specialties || []).join(", "),
            notes: shop.notes || "",
          }
        : { ...EMPTY_FORM },
    );

  const submit = async () => {
    const problem = shopFormError(editing, shops, editing.id || null);
    if (problem) {
      showToast(problem === "name_required" ? t.shNameRequired : t.shNameTaken, "warning");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveShop({
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name.trim().replace(/\s+/g, " "),
        phone: editing.phone.trim() || null,
        email: editing.email.trim() || null,
        address: editing.address.trim() || null,
        contact: editing.contact.trim() || null,
        specialties: parseSpecialties(editing.specialties),
        notes: editing.notes.trim() || null,
      });
      await logAction(
        user.id,
        user.email,
        "FLEET_MAINTENANCE",
        `${editing.id ? "Updated" : "Added"} shop "${saved.name}"`,
        { shop_id: saved.id },
        "fleet",
      );
      showToast(t.shSaved, "success");
      setEditing(null);
    } catch (err) {
      // 23505: the database's own unique-name index, for a clash this list did
      // not know about (a shop another manager added a moment ago).
      showToast(
        err?.code === "23505" ? t.shNameTaken : `${t.shSaveFailed} ${err.message}`,
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (shop, active) => {
    try {
      await saveShop({ id: shop.id, active });
      await logAction(
        user.id,
        user.email,
        "FLEET_MAINTENANCE",
        `${active ? "Restored" : "Archived"} shop "${shop.name}"`,
        { shop_id: shop.id },
        "fleet",
      );
      if (!active && !showArchived) setOpenId(null);
    } catch (err) {
      showToast(`${t.shSaveFailed} ${err.message}`, "error");
    }
  };

  // Ties old records to this shop by exact name (link_shop_history in
  // supabase/67), then re-reads the vehicles and tickets it may have stamped so
  // the history on screen shows them straight away.
  const linkPast = async (shop) => {
    setLinking(true);
    try {
      const { data, error } = await supabase.rpc("link_shop_history", { p_shop_id: shop.id });
      if (error) throw error;
      const [{ data: freshVehs }, { data: freshReqs }] = await Promise.all([
        supabase.from("vehicles").select("*").eq("company_id", user.companyId),
        supabase.from("maintenance_requests").select("*").eq("company_id", user.companyId),
      ]);
      if (freshVehs) setVehs(freshVehs);
      if (freshReqs) setReqs(freshReqs.sort((a, b) => new Date(b.at) - new Date(a.at)));
      const services = data?.services || 0;
      const requests = data?.requests || 0;
      showToast(
        services || requests
          ? t.shLinked.replace("{services}", services).replace("{requests}", requests)
          : t.shLinkedNone.replace("{name}", shop.name),
        services || requests ? "success" : "info",
      );
    } catch (err) {
      showToast(`${t.shSaveFailed} ${err.message}`, "error");
    } finally {
      setLinking(false);
    }
  };

  if (missing) {
    return (
      <Callout tone="warn" size="base" weight="semibold" color={C.am} style={{ marginTop: 12 }}>
        {t.shMissing}
      </Callout>
    );
  }

  return (
    <Stack gap={4} style={{ paddingBottom: 24 }}>
      <Row justify="space-between" align="center" style={{ flexWrap: "wrap", gap: 10 }}>
        <Text
          as="p"
          size="base"
          color={C.sub}
          style={{ margin: 0, maxWidth: 640, lineHeight: 1.5 }}
        >
          {t.shIntro}
        </Text>
        <Row gap={3}>
          {archivedCount > 0 && (
            <Btn v="ghost" sz="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t.shHideArchived : `${t.shShowArchived} (${archivedCount})`}
            </Btn>
          )}
          {canEdit && (
            <Btn v="primary" sz="sm" onClick={() => startEdit(null)}>
              <Plus size={13} aria-hidden="true" /> {t.shAdd}
            </Btn>
          )}
        </Row>
      </Row>

      {loading ? null : listed.length === 0 ? (
        <EmptyState
          icon={Store}
          message={t.shEmpty}
          subtitle={canEdit ? t.shEmptySub : t.shEmptySubViewer}
        />
      ) : (
        <CardGrid minWidth={260}>
          {listed.map((s) => {
            const h = histories[s.id];
            return (
              <Card key={s.id} onClick={() => setOpenId(s.id)} pad="md">
                <Stack gap={2}>
                  <Row justify="space-between" align="flex-start" gap={2}>
                    <Text
                      as="h3"
                      weight="extrabold"
                      color={C.barnwood}
                      style={{ margin: 0, fontSize: 15 }}
                    >
                      {s.name}
                    </Text>
                    {s.active === false && <Bdg color="gray">{t.shArchived}</Bdg>}
                  </Row>
                  {(s.specialties || []).length > 0 && (
                    <Row gap={1} style={{ flexWrap: "wrap" }}>
                      {s.specialties.map((w) => (
                        <Bdg key={w} color="sky">
                          {w}
                        </Bdg>
                      ))}
                    </Row>
                  )}
                  {s.phone && <Muted>{s.phone}</Muted>}
                  <Muted>
                    {h.visits
                      ? `${h.visits} ${h.visits === 1 ? t.shVisit : t.shVisits} · ${money(h.spend)} · ${t.shLastVisit} ${fmtDay(h.lastVisit)}`
                      : t.shNever}
                    {h.upcoming.length > 0 && ` · ${h.upcoming.length} ${t.shUpcomingShort}`}
                  </Muted>
                </Stack>
              </Card>
            );
          })}
        </CardGrid>
      )}

      {/* ── One shop ── */}
      {open && !editing && (
        <Modal
          title={
            <Row gap={3}>
              <Store size={17} aria-hidden="true" /> {open.name}
            </Row>
          }
          onClose={() => setOpenId(null)}
          wide
        >
          <ShopDetail
            shop={open}
            history={histories[open.id]}
            t={t}
            canEdit={canEdit}
            linking={linking}
            onEdit={() => startEdit(open)}
            onArchive={() => setActive(open, open.active === false)}
            onLinkPast={() => linkPast(open)}
          />
        </Modal>
      )}

      {/* ── Add / edit ── */}
      {editing && (
        <Modal title={editing.id ? t.shEdit : t.shNew} onClose={() => !saving && setEditing(null)}>
          <Stack gap={3}>
            <Fld label={t.shName}>
              <Inp
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t.shNamePlaceholder}
                autoFocus
              />
            </Fld>
            <Fld label={t.shSpecialties} hint={t.shSpecialtiesHint}>
              <Inp
                value={editing.specialties}
                onChange={(e) => setEditing({ ...editing, specialties: e.target.value })}
              />
            </Fld>
            <Fld label={t.shPhone}>
              <Inp
                type="tel"
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
              />
            </Fld>
            <Fld label={t.shEmail}>
              <Inp
                type="email"
                value={editing.email}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
              />
            </Fld>
            <Fld label={t.shAddress}>
              <Inp
                value={editing.address}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
              />
            </Fld>
            <Fld label={t.shContact}>
              <Inp
                value={editing.contact}
                onChange={(e) => setEditing({ ...editing, contact: e.target.value })}
              />
            </Fld>
            <Fld label={t.shNotes}>
              <TA
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </Fld>
            <Row gap={4}>
              <Btn
                v="ghost"
                onClick={() => setEditing(null)}
                disabled={saving}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {t.cancel}
              </Btn>
              <Btn
                v="primary"
                onClick={submit}
                disabled={saving}
                style={{ flex: 1, justifyContent: "center" }}
              >
                {saving ? t.shSaving : t.shSave}
              </Btn>
            </Row>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

function ShopDetail({ shop, history, t, canEdit, linking, onEdit, onArchive, onLinkPast }) {
  const contactRows = [
    [Phone, shop.phone, shop.phone ? `tel:${shop.phone.replace(/[^\d+]/g, "")}` : null],
    [Mail, shop.email, shop.email ? `mailto:${shop.email}` : null],
    [MapPin, shop.address, null],
    [User, shop.contact, null],
  ].filter(([, value]) => value);

  return (
    <Stack gap={4}>
      {shop.active === false && (
        <Callout tone="warn" size="sm" color={C.am}>
          {t.shArchivedNote}
        </Callout>
      )}

      {(contactRows.length > 0 || (shop.specialties || []).length > 0) && (
        <Stack gap={2}>
          {(shop.specialties || []).length > 0 && (
            <Row gap={1} style={{ flexWrap: "wrap" }}>
              {shop.specialties.map((w) => (
                <Bdg key={w} color="sky">
                  {w}
                </Bdg>
              ))}
            </Row>
          )}
          {contactRows.map(([Icon, value, href]) => (
            <Row key={value} gap={2}>
              <Icon size={14} color={C.sub} aria-hidden="true" />
              {href ? (
                <a href={href} style={{ color: C.slate, fontWeight: 600 }}>
                  {value}
                </a>
              ) : (
                <Text as="span" color={C.barnwood}>
                  {value}
                </Text>
              )}
            </Row>
          ))}
          {shop.notes && <Muted style={{ whiteSpace: "pre-wrap" }}>{shop.notes}</Muted>}
        </Stack>
      )}

      <Row gap={6} style={{ flexWrap: "wrap" }}>
        <Stat label={t.shVisitsLabel} value={history.visits} />
        <Stat label={t.shSpend} value={money(history.spend)} />
        <Stat label={t.shLastVisit} value={history.lastVisit ? fmtDay(history.lastVisit) : "—"} />
      </Row>

      {history.upcoming.length > 0 && (
        <Stack gap={2}>
          <Text as="h3" size="md" color={C.navy} style={{ margin: 0 }}>
            {t.shUpcoming}
          </Text>
          {history.upcoming.map((u) => (
            <Row key={u.requestId} justify="space-between" gap={3}>
              <Text as="span" color={C.barnwood}>
                <strong>{u.vehicleName}</strong> · {u.type}
              </Text>
              <Muted>{u.date ? fmtDay(u.date) : t.shNotScheduled}</Muted>
            </Row>
          ))}
        </Stack>
      )}

      <Stack gap={2}>
        <Text as="h3" size="md" color={C.navy} style={{ margin: 0 }}>
          {t.shHistory}
        </Text>
        {history.done.length === 0 ? (
          <Muted>{t.shNoHistory}</Muted>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-sm)" }}
            >
              <thead>
                <tr style={{ textAlign: "left", color: C.sub }}>
                  <th style={{ padding: "4px 6px" }}>{t.shColDate}</th>
                  <th style={{ padding: "4px 6px" }}>{t.shColVehicle}</th>
                  <th style={{ padding: "4px 6px" }}>{t.shColWork}</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>{t.shColCost}</th>
                </tr>
              </thead>
              <tbody>
                {history.done.map((e, i) => (
                  <tr
                    key={`${e.vehicleId}-${e.date}-${i}`}
                    style={{ borderTop: `1px solid ${C.bd}` }}
                  >
                    <td style={{ padding: "6px", whiteSpace: "nowrap" }}>{fmtDay(e.date)}</td>
                    <td style={{ padding: "6px" }}>{e.vehicleName}</td>
                    <td style={{ padding: "6px" }}>
                      {e.type}
                      {e.notes ? <Muted>{e.notes}</Muted> : null}
                    </td>
                    <td style={{ padding: "6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {money(e.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Stack>

      {canEdit && (
        <Stack gap={2} style={{ borderTop: `1px solid ${C.bd}`, paddingTop: 12 }}>
          <Row gap={3} style={{ flexWrap: "wrap" }}>
            <Btn v="primary" sz="sm" onClick={onEdit}>
              {t.shEdit}
            </Btn>
            <Btn v="ghost" sz="sm" onClick={onLinkPast} disabled={linking}>
              <Link2 size={13} aria-hidden="true" /> {linking ? t.shLinking : t.shLinkPast}
            </Btn>
            <Btn
              v="outline"
              tone={shop.active === false ? C.slate : C.rust}
              sz="sm"
              onClick={onArchive}
            >
              {shop.active === false ? t.shRestore : t.shArchive}
            </Btn>
          </Row>
          <Muted>{t.shLinkPastHint.replace("{name}", shop.name)}</Muted>
        </Stack>
      )}
    </Stack>
  );
}

function Stat({ label, value }) {
  return (
    <Stack gap={0}>
      <Muted>{label}</Muted>
      <Text as="span" weight="extrabold" color={C.barnwood} style={{ fontSize: 18 }}>
        {value}
      </Text>
    </Stack>
  );
}
