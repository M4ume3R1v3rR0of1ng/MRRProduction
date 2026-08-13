import React, { createContext, useContext, useState, useEffect } from 'react';
import { C } from '../utils/helpers';
import { TrussMark } from '../components/SteadwerkMark';

const NotificationContext = createContext();

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // The open confirm dialog: { opts, resolve }. Null when nothing is being asked.
  const [ask, setAsk] = useState(null);

  // A themed stand-in for window.confirm, which renders the browser's own dialog —
  // "localhost:5173 says", system fonts, an OK button that looks like nothing else
  // in the product. It also blocks the main thread, so nothing behind it can paint.
  //
  // Promise-based so it drops straight into the call sites that already read
  // window.confirm's boolean:
  //
  //     if (!(await confirm({ ... }))) return;
  //
  // Lives on this provider rather than in its own because every view already calls
  // useNotify(), so no extra wiring and no second provider around the tree.
  const confirm = (opts) =>
    new Promise((resolve) => {
      setAsk({ opts: typeof opts === "string" ? { message: opts } : opts, resolve });
    });

  const settle = (value) => {
    setAsk((cur) => {
      cur?.resolve(value);
      return null;
    });
  };

  const showToast = (message, type = 'error', duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  };

  useEffect(() => {
    if (!ask) return;
    const onKey = (e) => { if (e.key === "Escape") settle(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  // The audit logger (utils/logger.js) has no access to this context, so it
  // announces a persistent failure via a window event — once per session.
  useEffect(() => {
    const onAuditFailure = () => {
      showToast(
        '⚠️ Activity logging is failing — actions are not being recorded in the audit log. Let your admin know.',
        'warning',
        10000,
      );
    };
    window.addEventListener('mrr-audit-log-failure', onAuditFailure);
    return () => window.removeEventListener('mrr-audit-log-failure', onAuditFailure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Maps notification types to cohesive operational design tokens
  const getToastStyle = (type) => {
    switch (type) {
      case 'success': return { bg: C.gB || '#d1fae5', border: C.gr || '#10b981', color: '#065f46' };
      case 'warning': return { bg: C.aB || '#fef3c7', border: C.am || '#f59e0b', color: '#92400e' };
      case 'error':
      default: return { bg: '#fee2e2', border: '#ef4444', color: '#991b1b' };
    }
  };

  return (
    <NotificationContext.Provider value={{ showToast, confirm }}>
      {children}

      {/* ── Themed confirm ──
          Same shell as UIPrimitives' Modal so it reads as part of the product: the
          amber rule under the title, the surface token that inverts with the theme,
          the app's own radii and shadows.

          The backdrop deliberately does NOT dismiss. Both answers here carry
          consequences — leaving a job open versus completing it with no report
          filed — and a stray click landing on "cancel" before the user has read
          anything is not a decision. It also matches UIPrimitives' Modal, which
          has never closed on a backdrop click. Escape still cancels: that is
          deliberate where a misclick is not, and it is what the native confirm
          this replaced already did. */}
      {ask && (() => {
        const o = ask.opts || {};
        const danger = o.tone === "danger";
        return (
          <div
            className="mrr-backdrop"
            style={{ position: "fixed", inset: 0, background: "var(--c-backdrop)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-5)" }}
          >
            <div
              className="mrr-modal"
              role="alertdialog"
              aria-modal="true"
              style={{ background: C.w, borderRadius: "var(--radius-2xl)", width: "100%", maxWidth: 440, boxShadow: "var(--shadow-lg)", overflow: "hidden" }}
            >
              <div style={{ padding: "var(--space-7) var(--space-8)", borderBottom: `2px solid ${danger ? C.rust : "var(--brand-accent, var(--c-amber))"}` }}>
                <h2 style={{ margin: 0, fontSize: "var(--text-lg)", fontWeight: "var(--weight-extrabold)", color: danger ? C.rust : C.navy, display: "flex", alignItems: "center", gap: 10 }}>
                  <TrussMark size={22} color={danger ? C.rust : undefined} />
                  {o.title || "Are you sure?"}
                </h2>
              </div>

              <div style={{ padding: "var(--space-8)" }}>
                <p style={{ margin: 0, color: C.navy, fontSize: "var(--text-md)", lineHeight: 1.65 }}>
                  {o.message}
                </p>
                {o.detail && (
                  <p style={{ margin: "12px 0 0", color: C.sub, fontSize: "var(--text-base)", lineHeight: 1.6 }}>
                    {o.detail}
                  </p>
                )}

                <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-7)" }}>
                  <button
                    className="mrr-btn"
                    onClick={() => settle(false)}
                    style={{ flex: 1, padding: "11px", background: C.subtle, color: C.barnwood, border: "none", borderRadius: "var(--radius-lg)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", cursor: "pointer" }}
                  >
                    {o.cancelLabel || "Cancel"}
                  </button>
                  <button
                    className="mrr-btn"
                    autoFocus
                    onClick={() => settle(true)}
                    style={{ flex: 1, padding: "11px", background: danger ? C.rust : "var(--brand-accent, var(--c-amber))", color: danger ? "var(--c-on-accent)" : "var(--brand-accent-ink, var(--c-shell))", border: "none", borderRadius: "var(--radius-lg)", fontWeight: "var(--weight-extrabold)", fontSize: "var(--text-base)", cursor: "pointer" }}
                  >
                    {o.confirmLabel || "Confirm"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Floating Toast Portal Container Layout */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: "var(--space-4)", maxWidth: 360 }}>
        {toasts.map((t) => {
          const style = getToastStyle(t.type);
          return (
            <div
              key={t.id}
              style={{
                background: style.bg,
                borderLeft: `5px solid ${style.border}`,
                color: style.color,
                padding: '12px 16px',
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                animation: 'slideIn 0.2s ease',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                gap: 12
              }}
            >
              <div>{t.message}</div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: "var(--weight-black)", padding: 0, fontSize: "var(--text-md)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export const useNotify = () => useContext(NotificationContext);