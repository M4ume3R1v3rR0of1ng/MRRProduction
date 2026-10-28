// src/features/inventory/AddFromLibraryModal.jsx
//
// "Add from library": pick generic positions out of Steadwerk's shared catalog
// and copy them into this company's own. The point of the feature is a new
// company standing its Inventory up in one click instead of thirty dialogs, so
// Select all is a first-class control rather than a convenience.
//
// It stays available after onboarding on purpose: an established company can pull
// in a category they have started carrying, or pick up positions Steadwerk has
// added to the library since they signed up.
//
// The copying rules — new ids, no price, no link back to the library — all live in
// ./inventoryCatalog, which is also where the tests are. This file is the dialog.
import { useEffect, useMemo, useState } from "react";
import { Library, Search, AlertTriangle, PackagePlus } from "lucide-react";
import { C } from "@/shared/utils/helpers";
import { logAction } from "@/shared/utils/logger";
import {
  Btn,
  Inp,
  Modal,
  Row,
  Stack,
  Text,
  Muted,
  Callout,
  Card,
  Bdg,
  LoadingState,
  EmptyState,
  TextBtn,
} from "@/shared/components/UIPrimitives";
import { useNotify } from "@/shared/context/NotificationContext";
import { translations } from "@/shared/utils/translations";
import {
  fetchInventoryCatalog,
  availableCatalog,
  groupByCategory,
  searchCatalog,
  importCatalogItems,
} from "./inventoryCatalog";

export default function AddFromLibraryModal({ inv = [], user, onImported, onClose, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const { showToast } = useNotify();

  const [catalog, setCatalog] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [srch, setSrch] = useState("");
  // Selected ids, as a Set in state. Replaced rather than mutated on every toggle
  // so React sees a new object and re-renders.
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchInventoryCatalog()
      .then((rows) => alive && setCatalog(rows))
      // A missing table (61 not run) must leave the dialog saying so rather than
      // looking like an empty library, which would read as "nothing to add".
      .catch((err) => alive && setLoadErr(err?.message || String(err)));
    return () => {
      alive = false;
    };
  }, []);

  // Anything this company already carries is filtered out before the search and
  // before the counts, so a name they have cannot be selected, imported, or
  // counted. Recomputed against `inv` so an item added behind this dialog in
  // another tab disappears from the list on the next render.
  const offerable = useMemo(() => availableCatalog(catalog || [], inv), [catalog, inv]);
  const visible = useMemo(() => searchCatalog(offerable, srch), [offerable, srch]);
  const grouped = useMemo(() => groupByCategory(visible), [visible]);

  // How many library positions this company already has. Shown rather than hidden,
  // because "the library has 38 items and I am being offered 6" is otherwise
  // confusing enough to look like a bug.
  const alreadyHave = (catalog?.length || 0) - offerable.length;

  const toggle = (id) =>
    setPicked((p) => {
      const next = new Set(p);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Select all operates on what is VISIBLE, not the whole library: with a search
  // term typed, "select all" meaning "also the things you filtered out" would be
  // a trap. Clearing is global, because "clear" never surprises anyone.
  const allVisiblePicked = visible.length > 0 && visible.every((r) => picked.has(r.id));
  const toggleAllVisible = () =>
    setPicked((p) => {
      const next = new Set(p);
      if (allVisiblePicked) visible.forEach((r) => next.delete(r.id));
      else visible.forEach((r) => next.add(r.id));
      return next;
    });

  const toggleCategory = (rows) =>
    setPicked((p) => {
      const next = new Set(p);
      const all = rows.every((r) => next.has(r.id));
      rows.forEach((r) => (all ? next.delete(r.id) : next.add(r.id)));
      return next;
    });

  const close = () => {
    if (!saving) onClose?.();
  };

  const run = async () => {
    // Guard against the picked set outliving the list it came from: a row filtered
    // out since (because it got added in another tab) must not be imported twice.
    const chosen = offerable.filter((r) => picked.has(r.id));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      const created = await importCatalogItems(chosen);
      onImported?.(created);
      await logAction(
        user?.id ?? null,
        user?.email ?? null,
        "INV_MUTATION",
        `Imported ${created.length} catalog position(s) from the Steadwerk inventory library`,
        {
          count: created.length,
          names: created.map((r) => r.name),
        },
        "inventory",
      );
      showToast(t.invLibAddedOk.replace("{n}", String(created.length)), "success");
      onClose?.();
    } catch (err) {
      console.error(err);
      showToast(`${t.invLibAddFail} ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        <Row gap="7px">
          <Library size={16} aria-hidden="true" /> {t.invLibTitle}
        </Row>
      }
      onClose={close}
      disableCloseButton={saving}
      wide
      footer={
        <Row gap={3} justify="space-between" wrap style={{ width: "100%" }}>
          <Muted size="sm">
            {t.invLibSelected.replace("{n}", String(picked.size))}
            {alreadyHave > 0 && <> · {t.invLibAlreadyHave.replace("{n}", String(alreadyHave))}</>}
          </Muted>
          <Row gap={2}>
            <Btn v="ghost" onClick={close} disabled={saving}>
              {t.trCancel}
            </Btn>
            <Btn v="primary" onClick={run} disabled={saving || picked.size === 0}>
              <PackagePlus size={14} aria-hidden="true" />{" "}
              {saving ? t.invLibAdding : t.invLibAddN.replace("{n}", String(picked.size))}
            </Btn>
          </Row>
        </Row>
      }
    >
      <Stack gap={4}>
        <Muted size="sm" style={{ maxWidth: "70ch" }}>
          {t.invLibBlurb}
        </Muted>

        {loadErr ? (
          <Callout tone="warn" pad="sm" bordered icon={AlertTriangle} size="sm" color={C.warnInk}>
            {t.invLibLoadFail} {loadErr}
          </Callout>
        ) : catalog === null ? (
          <LoadingState label={t.invLibLoading} />
        ) : offerable.length === 0 ? (
          // Two different nothings, and conflating them would be unhelpful: an
          // empty library is Steadwerk's problem, whereas "you already have all of
          // it" is the happy ending.
          <EmptyState
            well
            icon={Library}
            message={catalog.length === 0 ? t.invLibEmptyTitle : t.invLibHaveAllTitle}
            subtitle={catalog.length === 0 ? t.invLibEmptyBody : t.invLibHaveAllBody}
          />
        ) : (
          <>
            <Row gap={3} wrap justify="space-between">
              <Inp
                prefix={<Search size={14} aria-hidden="true" />}
                placeholder={t.invLibSearch}
                value={srch}
                onChange={(e) => setSrch(e.target.value)}
                disabled={saving}
                style={{ flex: 1, minWidth: 220 }}
              />
              <Row gap={2}>
                <TextBtn onClick={toggleAllVisible} disabled={saving || visible.length === 0}>
                  {allVisiblePicked ? t.invLibClearVisible : t.invLibSelectAll}
                </TextBtn>
              </Row>
            </Row>

            {visible.length === 0 ? (
              <Muted size="sm">{t.invLibNoMatch}</Muted>
            ) : (
              <Stack gap={4}>
                {[...grouped.entries()].map(([category, rows]) => {
                  const allPicked = rows.every((r) => picked.has(r.id));
                  return (
                    <Card key={category} pad={4}>
                      <Stack gap={3}>
                        <Row gap={3} justify="space-between" wrap>
                          <Row gap="7px">
                            <Text weight="extrabold" color={C.navy}>
                              {category}
                            </Text>
                            <Bdg color="blue">{rows.length}</Bdg>
                          </Row>
                          <TextBtn onClick={() => toggleCategory(rows)} disabled={saving}>
                            {allPicked ? t.invLibClearCat : t.invLibSelectCat}
                          </TextBtn>
                        </Row>
                        <Stack gap={2}>
                          {rows.map((r) => (
                            <Row
                              key={r.id}
                              as="label"
                              gap={3}
                              justify="space-between"
                              wrap
                              style={{
                                padding: "8px 10px",
                                borderRadius: "var(--radius-md)",
                                border: `1px solid ${picked.has(r.id) ? C.tl : C.bd}`,
                                background: picked.has(r.id) ? C.tB : "transparent",
                                cursor: saving ? "not-allowed" : "pointer",
                              }}
                            >
                              <Row gap={3} style={{ minWidth: 0 }}>
                                <input
                                  type="checkbox"
                                  checked={picked.has(r.id)}
                                  onChange={() => toggle(r.id)}
                                  disabled={saving}
                                  style={{ margin: 0, flexShrink: 0 }}
                                />
                                <Text style={{ minWidth: 0 }}>{r.name}</Text>
                              </Row>
                              <Muted size="sm" style={{ flexShrink: 0 }}>
                                {r.unit} · {t.invLibAlertAt.replace("{n}", String(r.alrt))}
                              </Muted>
                            </Row>
                          ))}
                        </Stack>
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
