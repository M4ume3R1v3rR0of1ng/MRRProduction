// src/App.jsx
import { lazy, Suspense, useState, useEffect } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { supabase } from "./shared/utils/supabase";
import { useAppData } from "./core/useAppData";
import OmniSearch from "./shared/components/OmniSearch";
import SyncIndicator from "./shared/components/SyncIndicator";
import { RoleBdg, SkeletonCards, LoadingState } from "./shared/components/UIPrimitives";
import IdleTimeoutWrapper from "./shared/components/IdleTimeoutWrapper";

// Centralized Stateless Calculation & Helper Utilities
import { C, tot, oilSt, predDays, detSt, fd, fm } from "./shared/utils/helpers";
import { translations } from "./shared/utils/translations";
import { IS_IOS_APP } from "./core/platform";

import CompanySwitcher from "./shared/components/CompanySwitcher";
import VisitingBanner from "./shared/components/VisitingBanner";
import { SteadwerkMark, TrussMark } from "./shared/components/SteadwerkMark";
import Sidebar from "./shared/layouts/Sidebar";

// ── Code splitting ──────────────────────────────────────────────────────────
//
// LandingPage stays a static import. It is the first paint for cold traffic off
// steadwerk.com, and making it a lazy chunk would cost that visitor an extra
// round trip before anything renders — the opposite of the point.
//
// Everything else is deferred. Before this, all 15 view modules were static
// imports, so someone who arrived to read the marketing page downloaded Reports,
// Owner Console, Fleet, Settings and the rest — 905 kB raw / 248 kB gzipped —
// before the hero appeared. The people being sold to here are crews on phones
// with poor signal, and this page is the top of the funnel.
//
// Every view below has exactly one default export, which React.lazy requires.
import LandingPage from "./public/LandingPage";

const LoginScreen = lazy(() => import("./features/auth/LoginScreen"));
const TermsPage = lazy(() => import("./public/TermsPage"));
const PrivacyPage = lazy(() => import("./public/PrivacyPage"));
const TrainingPage = lazy(() => import("./public/TrainingPage"));
const TrainingView = lazy(() => import("./features/training/TrainingView"));
const ResetPasswordScreen = lazy(() => import("./features/auth/ResetPasswordScreen"));
const OwnerConsole = lazy(() => import("./platform/OwnerConsole"));
// The conditional is load-bearing, not belt-and-braces. Gating only the render
// site leaves this lazy() declaration referencing the chunk, so Rollup still
// emits BillingView into the App Store bundle: unreachable, but shipped. Putting
// the import() in a branch that folds away at build time is what actually keeps
// the seat-purchase and Stripe-portal code out of the binary.
const BillingView = IS_IOS_APP ? null : lazy(() => import("./features/billing/BillingView"));
const DashboardView = lazy(() => import("./features/dashboard/DashboardView"));
const ScheduleView = lazy(() => import("./features/schedule/ScheduleView"));
const ProfileView = lazy(() => import("./features/auth/ProfileView"));
const InventoryView = lazy(() => import("./features/inventory/InventoryView.jsx"));
const BuildJobsView = lazy(() => import("./features/jobs/BuildJobsView"));
const PullInventoryView = lazy(() => import("./features/jobs/PullInventoryView"));
const FleetManagementView = lazy(() => import("./features/fleet/FleetManagementView"));
const MaintenanceRequestsView = lazy(
  () => import("./features/maintenance/MaintenanceRequestsView"),
);
const ReportsView = lazy(() => import("./features/reports/ReportsView"));
const UserManagementView = lazy(() => import("./features/users/UserManagementView"));
const SettingsView = lazy(() => import("./features/settings/SettingsView"));
const AuditLogView = lazy(() => import("./features/users/AuditLogView"));

// The assistant is a floating widget, useful but never the reason someone opened
// the app, so it loads after the view they actually asked for.
const ChatWidget = lazy(() => import("./shared/components/ChatWidget"));

// Browser-tab titles, keyed by the same route string (location.pathname minus
// the leading slash) that drives Sidebar's active-item highlight. English only —
// this app is bilingual in its UI copy, but a browser tab title/history entry
// isn't something either language's users have ever asked to see localized.
const VIEW_TITLES = {
  dashboard: "Dashboard",
  schedule: "Schedule",
  buildjobs: "Build Jobs",
  pull: "Pull Inventory",
  inventory: "Inventory",
  fleet: "Fleet",
  requests: "Maintenance Requests",
  reports: "Reports",
  users: "Users",
  logs: "Audit Log",
  settings: "Settings",
  billing: "Billing",
  owner: "Owner Console",
  training: "Training",
  profile: "Profile",
};

// Mascot Branding Asset

// Shown while a lazy view chunk is in flight. Painted on the app ground rather
// than left blank so a slow connection does not flash white between routes.
function ChunkFallback({ full = false }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: full ? "100vh" : 240,
        width: "100%",
        background: full ? C.bg : "transparent",
      }}
    >
      <LoadingState label="Loading..." />
    </div>
  );
}

const jSC = {
  draft: { c: "gray", l: "Draft", icon: "📝" },
  approved: { c: "blue", l: "Approved", icon: "✅" },
  active: { c: "amber", l: "Active", icon: "🔄" },
  completed: { c: "green", l: "Completed", icon: "🏁" },
  closed: { c: "purple", l: "Closed", icon: "🔒" },
};

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useState("");
  // Deep-link from OmniSearch (which record the destination view should open)
  // and the "just moved down the pipeline" highlight both live in the query
  // string — ?open=<id> / ?highlight=<id>&hlabel=<text> — rather than local
  // state, so a link to /buildjobs?open=4471 is bookmarkable and shareable and
  // survives a refresh instead of evaporating the moment the tab reloads.
  const [searchParams, setSearchParams] = useSearchParams();

  // The whole app used to ship one static <title>Steadwerk</title> from index.html
  // no matter which screen was open — every tab in a crew's browser looked
  // identical, and "Steadwerk" was the only thing a browser history search could
  // ever match. Has to run unconditionally, ahead of the recovery/loading/logged-out
  // early returns below — a hook after a conditional return breaks the rules of
  // hooks, so this reads location.pathname directly rather than the `view` constant
  // derived from it further down, after those returns.
  //
  // Only acts on paths VIEW_TITLES actually knows (the authenticated app views) and
  // no-ops otherwise — the logged-out pages (landing, login, terms, privacy) set
  // their own title via useDocumentMeta, and this effect runs in the same render as
  // theirs but commits AFTER them (child effects before parent effects), so an
  // unconditional write here would win the race and silently overwrite what they set.
  useEffect(() => {
    const view = location.pathname.slice(1);
    if (VIEW_TITLES[view]) document.title = `${VIEW_TITLES[view]} · Steadwerk`;
  }, [location.pathname]);

  // Password-recovery interception. When someone opens the reset link from their
  // email, Supabase redirects back here with a recovery token in the URL hash and
  // silently establishes a session. Without this flag that session would just log
  // them into the portal with no way to actually set a new password — the reported
  // "it logs me in but never resets the password" bug. Detect it synchronously from
  // the hash so the reset screen wins before any auto-login can render, and also
  // honor the PASSWORD_RECOVERY auth event as a backstop.
  const [recovery, setRecovery] = useState(
    () => typeof window !== "undefined" && (window.location.hash || "").includes("type=recovery"),
  );

  // Which tab the LoginScreen opens on ("login" vs. the self-serve "start a
  // company" flow) — not part of the URL, just which pane is pre-selected when
  // /login renders.
  //
  // The iOS app opens on the login form and can never reach "/" (the marketing
  // landing page): that page publishes the subscription rates, and an App Store
  // build that shows a price is an App Store build that owes Apple In-App
  // Purchase. See utils/platform.js.
  const [loginMode, setLoginMode] = useState("login");
  // Where "← Back" on the Terms page should return to, since it's reachable from
  // both the landing footer and the login disclaimer.
  const [termsReturn, setTermsReturn] = useState("login");

  // ── 🟢 CONSUME DECOUPLED CUSTOM STATE INFRASTRUCTURE HOOK ──
  const app = useAppData();

  useEffect(() => {
    const { data: { subscription } = {} } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => subscription?.unsubscribe();
  }, []);

  // Someone holding a live session must never land on the marketing page. A stored
  // session can come back without a company selected — most often someone who
  // belongs to more than one and has not picked yet. useAppData then can't build
  // curUser, and the "/" landing default would strand them on the hero with
  // no way to finish signing in. LoginScreen picks the session up and shows the
  // company picker, so send them there.
  useEffect(() => {
    if (app.loading || app.curUser) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } = {} }) => {
      if (!cancelled && session?.user) navigate("/login");
    });
    return () => {
      cancelled = true;
    };
  }, [app.loading, app.curUser]);

  // The active tenant's name for display. branding.displayName (editable in Settings)
  // wins over the canonical companies.name, which itself beats the membership copy.
  // Falls back to the PRODUCT name, never to a hardcoded tenant — that would show one
  // company another's name.
  const companyDisplayName =
    app.company?.branding?.displayName ||
    app.company?.name ||
    app.curUser?.companyName ||
    "Steadwerk";

  // The platform operator's own tenant — no roofing operations, so the app is the
  // Owner Console rather than the product. See supabase/32.
  const isPlatformCompany = app.company?.is_platform_company === true;

  // "dashboard" is the wrong landing here: it renders crews, trucks and job counts
  // for a company that has none, and the sidebar no longer offers it. Move to the
  // console once, when the flag first resolves, and only from the default view so
  // this can never yank someone off a screen they navigated to themselves.
  useEffect(() => {
    if (isPlatformCompany && location.pathname === "/dashboard") {
      navigate("/owner", { replace: true });
    }
  }, [isPlatformCompany, location.pathname]);

  // ── 🎨 PER-COMPANY BRAND ACCENT ──
  // Each company's accent color (companies.branding.accent) drives the --brand-accent
  // CSS variable the app themes off — primary CTAs, modal rules, the dashboard header.
  // Set on the document root so modals and popups inherit it too. --brand-accent-ink is
  // whichever of dark/white text contrasts better with the chosen accent, so a button
  // label stays legible whatever color a company picks.
  useEffect(() => {
    const accent = app.company?.branding?.accent || "#C97B2D";
    const relLum = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return 0.3;
      const [r, g, b] = [0, 2, 4]
        .map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const L = relLum(accent);
    const ink = 1.05 / (L + 0.05) >= (L + 0.05) / 0.071 ? "#FFFFFF" : "#23282D";
    const root = document.documentElement;
    root.style.setProperty("--brand-accent", accent);
    root.style.setProperty("--brand-accent-ink", ink);
  }, [app.company?.branding?.accent]);

  // "← Back" out of Terms/Privacy. Both are reachable from either the landing
  // footer or the login disclaimer, and termsReturn already tracks which one —
  // so this can navigate straight there rather than guessing from history state.
  const backFromAuthView = (fallback) => {
    navigate(fallback === "landing" ? "/" : "/login");
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const navigateTo = (nextView) => navigate("/" + nextView);

  const openSearchResult = (targetView, itemId) => {
    navigate(`/${targetView}?open=${encodeURIComponent(itemId)}`);
  };
  // Gated on pathname (not just "is there an ?open= param") so a stray query
  // string left over from a previous view never gets picked up by whichever
  // route happens to render next.
  const searchTargetFor = (v) => (location.pathname === "/" + v ? searchParams.get("open") : null);
  const clearSearchTarget = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("open");
        return next;
      },
      { replace: true },
    );
  };

  // A job that just moved down the pipeline, handed to whichever screen now owns
  // it: { view, id, label }. The label is what the destination card's badge says,
  // so "Just built" and "Just completed" can use one mechanism.
  //
  // Deliberately a separate query param from the search target above: that one
  // opens the job's detail modal, and this is meant to leave the card sitting
  // there glowing until the person actually goes and touches it.
  const showJobIn = (targetView, jobId, label) => {
    const params = new URLSearchParams();
    params.set("highlight", jobId);
    if (label) params.set("hlabel", label);
    navigate(`/${targetView}?${params.toString()}`);
  };
  const highlightFor = (v) => {
    if (location.pathname !== "/" + v) return null;
    const id = searchParams.get("highlight");
    if (!id) return null;
    return { view: v, id, label: searchParams.get("hlabel") || "" };
  };
  const clearJobHighlight = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("highlight");
        next.delete("hlabel");
        return next;
      },
      { replace: true },
    );
  };

  // Clearing curUser alone left the underlying Supabase session (and its token
  // in localStorage) valid and reusable — logout/idle-timeout must actually
  // invalidate it server-side too.
  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Sign-out failed:", err);
    } finally {
      app.setCurUser(null);
      // A returning user who just signed out wants the login form, not the
      // marketing page they've already seen a hundred times.
      navigate("/login");
    }
  };

  // Language survives a reload. Without this it reset to English on every page
  // load, so a Spanish-speaking crew member had to re-pick Spanish every single
  // time they opened the app — which made the translations close to useless.
  // Falls back to the browser's own language before English, so a phone set to
  // Spanish gets a Spanish portal on first visit with nothing to configure.
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem("sw_lang");
      if (saved === "en" || saved === "es") return saved;
    } catch {
      // Private mode / storage disabled. Fall through to detection.
    }
    return typeof navigator !== "undefined" &&
      String(navigator.language || "")
        .toLowerCase()
        .startsWith("es")
      ? "es"
      : "en";
  });

  useEffect(() => {
    try {
      localStorage.setItem("sw_lang", lang);
    } catch {
      // Nothing to do — the picker still works for this session.
    }
  }, [lang]);
  const t = translations[lang] || translations.en;

  // ── 🔑 PASSWORD RECOVERY RENDER LAYER ──
  // Takes precedence over the loading splash and the auth check: a recovery link
  // must land on the set-password screen, never on the portal, no matter what the
  // session bootstrap decided.
  if (recovery) {
    return (
      <Suspense fallback={<ChunkFallback full />}>
        <ResetPasswordScreen
          lang={lang}
          onDone={() => {
            // Password changed and session signed out inside the screen. Navigating
            // to /login (rather than a raw replaceState) both drops back to a clean
            // login and clears the recovery hash — the new URL carries none — while
            // keeping the router's own location in sync with the address bar.
            app.setCurUser(null);
            setRecovery(false);
            navigate("/login", { replace: true });
          }}
        />
      </Suspense>
    );
  }

  // ── ⏳ HARDENED PROGRESS BAR LOADING FALLBACK ──
  if (app.loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyGroup: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: C.bg,
          flexDirection: "column",
          gap: "var(--space-6)",
        }}
      >
        {/* Platform mark, not the Maumee River mascot — this splash renders for every
            company on the platform, before we even know which one. */}
        <div style={{ marginBottom: 4 }}>
          <SteadwerkMark size={88} filled />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-3)",
            width: "100%",
            maxWidth: "240px",
          }}
        >
          {/* External Track Container */}
          <div
            style={{
              width: "100%",
              height: "6px",
              backgroundColor: C.line,
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            {/* Dynamic Colored Bar Indicator */}
            <div
              style={{
                height: "100%",
                backgroundColor: C.amber,
                width: `${app.loadingProgress}%`,
                transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                borderRadius: "10px",
              }}
            />
          </div>

          <div
            style={{
              color: C.navy,
              fontWeight: "var(--weight-bold)",
              fontSize: "var(--text-base)",
              letterSpacing: "0.5px",
              marginTop: 4,
            }}
          >
            Syncing your yard... {app.loadingProgress}%
          </div>
        </div>

        {/* A skeleton of the dashboard sitting under the progress bar. The bar
            alone leaves the screen empty for the whole load; showing the shape
            that is coming makes the wait feel shorter and stops the hard jump
            from blank to full dashboard. Hidden on phones, where it would push
            the progress bar off-screen. */}
        <div
          className="sw-hide-phone"
          style={{ width: "100%", maxWidth: 880, padding: "0 24px", marginTop: 8, opacity: 0.55 }}
        >
          <SkeletonCards count={3} cols={3} />
        </div>
      </div>
    );
  }

  // ── 🔒 AUTH CHECK RENDER LAYER ──
  if (!app.curUser) {
    return (
      <Suspense fallback={<ChunkFallback full />}>
        <Routes>
          {/* Public Terms & Conditions page — reachable from the landing footer
              and the login disclaimer; "← Back" returns to whichever opened it. */}
          <Route
            path="/terms"
            element={<TermsPage onBack={() => backFromAuthView(termsReturn)} />}
          />
          {/* Public Privacy Policy. Shares termsReturn with the Terms page above:
              both are reachable from the same two places and both go back where
              they came from, so a second piece of state would only be a second
              thing to keep in step. Apple requires a reachable privacy URL for
              App Store review, and this route is it. */}
          <Route
            path="/privacy"
            element={<PrivacyPage onBack={() => backFromAuthView(termsReturn)} />}
          />
          {/* Public help & training page — the product tour and future
              walkthroughs. Lazy like Terms: it carries its own stylesheet and a
              video element, and cold traffic landing on the marketing page
              should not pay for either. */}
          <Route
            path="/training"
            element={<TrainingPage onBack={() => backFromAuthView("landing")} />}
          />
          {/* Public front door. The marketing landing page hands off to the
              login/signup form via its Sign in / Start your company buttons.
              The !IS_IOS_APP guard is what actually keeps LandingPage out of the
              App Store bundle: it is the only reference to the component, so with
              the flag folded to false at build time the whole marketing page and
              every rate on it is dropped rather than merely made unreachable. On
              iOS there is no landing page at all, so "/" goes straight to login. */}
          <Route
            path="/"
            element={
              IS_IOS_APP ? (
                <Navigate to="/login" replace />
              ) : (
                <LandingPage
                  onSignIn={() => {
                    setLoginMode("login");
                    navigate("/login");
                  }}
                  onStart={() => {
                    setLoginMode("signup");
                    navigate("/login");
                  }}
                  onShowTerms={() => {
                    setTermsReturn("landing");
                    navigate("/terms");
                  }}
                  onShowPrivacy={() => {
                    setTermsReturn("landing");
                    navigate("/privacy");
                  }}
                  onShowTraining={() => navigate("/training")}
                />
              )
            }
          />
          <Route
            path="/login"
            element={
              <LoginScreen
                onLogin={(u) => {
                  app.setCurUser(u);
                  navigateTo("dashboard");
                }}
                initialMode={loginMode}
                onBack={() => backFromAuthView("landing")}
                onShowTerms={() => {
                  setTermsReturn("login");
                  navigate("/terms");
                }}
                onShowPrivacy={() => {
                  setTermsReturn("login");
                  navigate("/privacy");
                }}
                activeLogo={app.activeLogo}
                lang={lang}
                setLang={setLang}
              />
            }
          />
          {/* Any portal path hit while logged out (a stale bookmark, a shared
              link, a session that just expired) — and anything else unmatched —
              lands on the login form rather than 404ing. */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // Derived from the URL rather than tracked separately — Sidebar's active-item
  // highlight (and BuildJobsView's now-unused `view` prop below) both key off
  // this string exactly as they did when it was its own piece of state.
  const view = location.pathname.slice(1) || "dashboard";

  return (
    <IdleTimeoutWrapper
      lang={lang}
      isAuthenticated={!!app.curUser}
      onLogout={handleLogout}
      timeout={1800000}
    >
      {" "}
      {/* ── 🟢 1. LOCK THE ROOT CONTAINER VIEWPORT TO SCREEN HEIGHT ── */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          height: "100vh", // Force the layout wrapper to freeze at exactly screen height
          maxHeight: "100vh",
          background: C.bg,
          fontFamily: "var(--font-sans)",
          width: "100vw",
          overflow: "hidden", // Prevents the whole browser page from ever scrolling
        }}
      >
        {/* Renders nothing unless the platform owner is inside a tenant they are
            not a member of. See components/VisitingBanner. */}
        <VisitingBanner user={app.curUser} onLogout={handleLogout} lang={lang} />

        {/* 📱 MOBILE HEADER NAVIGATION BAR */}
        {/* The status-bar inset is PADDING on this bar, not a margin above it, so
            the bar's own dark background fills the notch area. A margin would
            expose the page ground behind the clock and leave a pale stripe across
            the top of an otherwise dark app. Left/right insets cover landscape,
            where the notch moves to one side. */}
        {isMobile && (
          <div
            style={{
              background: C.shell,
              color: C.shellInk,
              padding:
                "var(--safe-top) calc(20px + var(--safe-right)) 0 calc(20px + var(--safe-left))",
              height: "var(--chrome-total)",
              boxSizing: "border-box",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              position: "sticky",
              top: 0,
              zIndex: 100,
              boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              flexShrink: 0,
            }}
          >
            {/* The TENANT's name, not the platform's. This header sits inside their
                portal — hardcoding "MAUMEE RIVER ROOFING" here would have greeted
                every other company by your company's name. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-display)",
                fontWeight: "var(--weight-bold)",
                fontSize: "var(--text-base)",
                color: C.shellInk,
              }}
            >
              <TrussMark size={20} />
              {companyDisplayName}
            </div>
            <button
              onClick={() => setMobileMenuOpen((o) => !o)}
              style={{
                background: "transparent",
                border: "none",
                color: C.shellInk,
                fontSize: "var(--text-3xl)",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              {mobileMenuOpen ? "✕" : "☰"}
            </button>
          </div>
        )}

        {/* 🗺️ CONTAINER ROUTER NAVIGATION DRAWER LAYOUT */}
        {/* (Added height constraint to sidebar element) */}
        {/* The drawer hangs off the bottom of the header, so it starts at the bar
            height PLUS the status-bar inset and loses that same amount of height.
            paddingBottom keeps the last nav item clear of the home indicator,
            which otherwise sits on top of it and eats the tap. */}
        <div
          style={{
            width: isMobile ? "100%" : collapsed ? 64 : 260,
            display: isMobile && !mobileMenuOpen ? "none" : "block",
            position: isMobile ? "fixed" : "relative",
            top: isMobile ? "var(--chrome-total)" : 0,
            left: 0,
            height: isMobile ? "calc(100vh - var(--chrome-total))" : "100vh",
            paddingBottom: isMobile ? "var(--safe-bottom)" : 0,
            boxSizing: "border-box",
            zIndex: 99,
            overflowY: "auto",
            flexShrink: 0,
          }}
        >
          <Sidebar
            cur={view}
            onNav={(v) => {
              navigateTo(v);
              if (isMobile) setMobileMenuOpen(false);
            }}
            user={app.curUser}
            onLogout={handleLogout}
            collapsed={isMobile ? false : collapsed}
            setCollapsed={setCollapsed}
            companyName={companyDisplayName}
            isPlatformAdmin={app.curUser?.isPlatformAdmin}
            isPlatformCompany={isPlatformCompany}
            pendingReqs={app.pendingReqCount}
            lowStock={app.lowStockCount}
            newJobsForMe={app.newJobsForMe}
            jobsAwaitingClose={app.jobsAwaitingCloseCount}
            chatUnread={app.chatUnread}
            activeLogo={app.activeLogo}
            perms={app.userPerms}
            lang={lang}
            setLang={setLang}
          />
        </div>

        {/* 📊 CORE PANEL FRAMEWORK METER BODY */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            height: "100%", // Inherit frozen screen layout constraints
            marginTop: isMobile ? "var(--chrome-total)" : 0,
            // Keeps the bottom of every view clear of the home indicator on an
            // installed iOS app. 0px everywhere else.
            paddingBottom: isMobile ? "var(--safe-bottom)" : 0,
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          {app.loadErrors.length > 0 && (
            <div
              style={{
                background: "var(--c-rust-wash)",
                borderBottom: "2px solid var(--c-rust)",
                color: "var(--c-rust)",
                padding: "10px 20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                flexShrink: 0,
                fontSize: "var(--text-sm)",
                fontWeight: "var(--weight-bold)",
              }}
            >
              <span>
                ⚠️ Live data failed to load: {app.loadErrors.join(", ")}. Those sections are shown
                empty rather than with possibly-wrong data — don't make changes until this clears.
              </span>
              <button
                onClick={() => app.reload()}
                style={{
                  background: C.rust,
                  color: C.onAccent,
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontWeight: "var(--weight-bold)",
                  fontSize: "var(--text-sm)",
                  flexShrink: 0,
                }}
              >
                🔄 Retry
              </button>
            </div>
          )}
          {!isMobile && (
            <div
              style={{
                background: C.w,
                padding: "0 20px",
                height: 56,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: `1px solid ${C.bd}`,
                boxShadow: "var(--shadow-xs)",
                flexShrink: 0,
              }}
            >
              <div
                style={{ fontSize: "var(--text-sm)", color: C.sub, flexShrink: 0, marginRight: 24 }}
              >
                {companyDisplayName}
                {app.warehouses?.[0]?.name ? ` · ${app.warehouses[0].name}` : ""}
              </div>

              <div
                style={{
                  flex: 1,
                  maxWidth: "400px",
                  display: "flex",
                  justifyContent: "flex-start",
                  paddingRight: "40px",
                }}
              >
                <OmniSearch
                  jobs={app.jobs}
                  users={app.users}
                  reqs={app.reqs}
                  inv={app.inv}
                  vehs={app.vehs}
                  perms={app.userPerms}
                  onNavigate={navigateTo}
                  onOpenItem={openSearchResult}
                  onInventorySearch={setInventorySearchQuery}
                  lang={lang}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-5)",
                  flexShrink: 0,
                  marginLeft: 24,
                }}
              >
                <SyncIndicator lang={lang} />
                {app.newJobsForMe > 0 && (
                  <div
                    onClick={() => navigateTo("pull")}
                    style={{
                      background: C.tB,
                      color: C.tl,
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-bold)",
                      cursor: "pointer",
                    }}
                  >
                    🎉 {app.newJobsForMe}{" "}
                    {app.newJobsForMe === 1 ? t.chromeNewJobOne : t.chromeNewJobMany}
                  </div>
                )}
                {app.pendingReqCount > 0 && app.userPerms.maint_manage && (
                  <div
                    onClick={() => navigateTo("requests")}
                    style={{
                      background: C.pB,
                      color: C.pu,
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-bold)",
                      cursor: "pointer",
                    }}
                  >
                    🔧 {app.pendingReqCount} {t.chromePending}
                  </div>
                )}
                {app.lowStockCount > 0 && app.userPerms.inv_view && (
                  <div
                    onClick={() => navigateTo("inventory")}
                    style={{
                      background: C.aB,
                      color: C.am,
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-bold)",
                      cursor: "pointer",
                    }}
                  >
                    ⚠️ {app.lowStockCount} {t.chromeLowStock}
                  </div>
                )}
                {app.jobsAwaitingCloseCount > 0 && app.userPerms.jobs_close && (
                  <div
                    onClick={() => navigateTo("buildjobs")}
                    style={{
                      background: C.tB,
                      color: C.tl,
                      borderRadius: 20,
                      padding: "3px 10px",
                      fontSize: "var(--text-xs)",
                      fontWeight: "var(--weight-bold)",
                      cursor: "pointer",
                    }}
                  >
                    🧾 {app.jobsAwaitingCloseCount} awaiting close
                  </div>
                )}
                <CompanySwitcher user={app.curUser} lang={lang} />
                <RoleBdg role={app.curUser.role} lang={lang} />
              </div>
            </div>
          )}

          {/* ── 🟢 2. CENTRAL DISPATCH PANEL CARDS SCROLL INSIDE THIS CANVAS ONLY ── */}
          <div
            className="global-app-scrollbar" // Connects with custom slim styling markers
            style={{
              flex: 1,
              padding: isMobile ? 16 : 20,
              overflowY: "auto", // Confines scroll mechanics strictly to the open sub-view card
              background: C.bg,
            }}
          >
            {/* One boundary for the whole switch: only one view is ever mounted,
                so a single fallback covers every route change. */}
            <Suspense fallback={<ChunkFallback />}>
              <Routes>
                {/* "/" and a lingering "/login" both just mean "put me somewhere
                inside the portal" once signed in. */}
                <Route
                  path="/"
                  element={<Navigate to={isPlatformCompany ? "/owner" : "/dashboard"} replace />}
                />
                <Route path="/login" element={<Navigate to="/dashboard" replace />} />
                <Route
                  path="/dashboard"
                  element={
                    <DashboardView
                      inv={app.inv}
                      vehs={app.vehs}
                      reqs={app.reqs}
                      jobs={app.jobs}
                      jobTrailers={app.jobTrailers}
                      users={app.users}
                      user={app.curUser}
                      perms={app.userPerms}
                      onNav={navigateTo}
                      tot={tot}
                      jSC={jSC}
                      lang={lang}
                      setLang={setLang}
                      onMarkChatRead={app.markChatRead}
                      setJobs={app.setJobs}
                      setReqs={app.setReqs}
                      company={app.company}
                      activeLogo={app.activeLogo}
                    />
                  }
                />
                <Route
                  path="/schedule"
                  element={
                    <ScheduleView
                      jobs={app.jobs}
                      reqs={app.reqs}
                      vehs={app.vehs}
                      jobTrailers={app.jobTrailers}
                      users={app.users}
                      jSC={jSC}
                      onNav={navigateTo}
                      lang={lang}
                    />
                  }
                />
                <Route
                  path="/buildjobs"
                  element={
                    app.userPerms.jobs_build || app.userPerms.jobs_close ? (
                      <BuildJobsView
                        jobs={app.jobs}
                        company={app.company}
                        jobNotifications={app.jobNotifications}
                        setJobs={app.setJobs}
                        inv={app.inv}
                        setInv={app.setInv}
                        vehs={app.vehs}
                        jobTrailers={app.jobTrailers}
                        setJobTrailers={app.setJobTrailers}
                        users={app.users}
                        user={app.curUser}
                        perms={app.userPerms}
                        jSC={jSC}
                        view={view}
                        onNav={navigateTo}
                        acculynxConfig={app.acculynxConfig}
                        lang={lang}
                        setLang={setLang}
                        openItemId={searchTargetFor("buildjobs")}
                        onOpenItemHandled={clearSearchTarget}
                        activeLogo={app.activeLogo}
                        highlight={highlightFor("buildjobs")}
                        onHighlightCleared={clearJobHighlight}
                        onShowJobIn={showJobIn}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/pull"
                  element={
                    <PullInventoryView
                      jobs={app.jobs}
                      company={app.company}
                      jobNotifications={app.jobNotifications}
                      setJobs={app.setJobs}
                      inv={app.inv}
                      setInv={app.setInv}
                      vehs={app.vehs}
                      jobTrailers={app.jobTrailers}
                      setJobTrailers={app.setJobTrailers}
                      users={app.users}
                      user={app.curUser}
                      perms={app.userPerms}
                      activeLogo={app.activeLogo}
                      acculynxConfig={app.acculynxConfig}
                      jSC={jSC}
                      lang={lang}
                      setLang={setLang}
                      openItemId={searchTargetFor("pull")}
                      onOpenItemHandled={clearSearchTarget}
                      highlight={highlightFor("pull")}
                      onHighlightCleared={clearJobHighlight}
                      onShowJobIn={showJobIn}
                    />
                  }
                />
                <Route
                  path="/inventory"
                  element={
                    app.userPerms.inv_view ? (
                      <InventoryView
                        inv={app.inv}
                        setInv={app.setInv}
                        jobs={app.jobs}
                        setJobs={app.setJobs}
                        users={app.users}
                        user={app.curUser}
                        perms={app.userPerms}
                        inventorySearchQuery={inventorySearchQuery}
                        setInventorySearchQuery={setInventorySearchQuery}
                        lang={lang}
                        setLang={setLang}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/fleet"
                  element={
                    app.userPerms.fleet_view ? (
                      <FleetManagementView
                        vehs={app.vehs}
                        setVehs={app.setVehs}
                        reqs={app.reqs}
                        setReqs={app.setReqs}
                        jobs={app.jobs}
                        setJobs={app.setJobs}
                        jobTrailers={app.jobTrailers}
                        setJobTrailers={app.setJobTrailers}
                        jSC={jSC}
                        users={app.users}
                        user={app.curUser}
                        perms={app.userPerms}
                        maintenanceNotifications={app.maintenanceNotifications}
                        maintManagers={app.maintManagers}
                        oilSt={oilSt}
                        detSt={detSt}
                        predDays={predDays}
                        fd={fd}
                        fm={fm}
                        inventorySearchQuery={inventorySearchQuery}
                        setInventorySearchQuery={setInventorySearchQuery}
                        lang={lang}
                        setLang={setLang}
                        openItemId={searchTargetFor("fleet")}
                        onOpenItemHandled={clearSearchTarget}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/requests"
                  element={
                    app.userPerms.maint_submit || app.userPerms.maint_manage ? (
                      <MaintenanceRequestsView
                        reqs={app.reqs}
                        setReqs={app.setReqs}
                        vehs={app.vehs}
                        setVehs={app.setVehs}
                        users={app.users}
                        user={app.curUser}
                        perms={app.userPerms}
                        maintenanceNotifications={app.maintenanceNotifications}
                        maintManagers={app.maintManagers}
                        lang={lang}
                        setLang={setLang}
                        openItemId={searchTargetFor("requests")}
                        onOpenItemHandled={clearSearchTarget}
                        company={app.company}
                        activeLogo={app.activeLogo}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/reports"
                  element={
                    app.userPerms.reports_view ? (
                      <ReportsView
                        jobs={app.jobs}
                        setJobs={app.setJobs}
                        users={app.users}
                        user={app.curUser}
                        perms={app.userPerms}
                        inv={app.inv}
                        vehs={app.vehs}
                        reqs={app.reqs}
                        lang={lang}
                        setLang={setLang}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/users"
                  element={
                    app.userPerms.users_manage ? (
                      <UserManagementView
                        users={app.users}
                        setUsers={app.setUsers}
                        currentUser={app.curUser}
                        rolePerms={app.rolePerms}
                        userOverrides={app.userOverrides}
                        setUserOverrides={app.setUserOverrides}
                        onUpdateUser={(updated) => {
                          app.setCurUser(updated);
                          app.setUsers((p) =>
                            p.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)),
                          );
                        }}
                        lang={lang}
                        setLang={setLang}
                        openItemId={searchTargetFor("users")}
                        onOpenItemHandled={clearSearchTarget}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/settings"
                  element={
                    app.userPerms.settings_manage ? (
                      <SettingsView
                        warehouses={app.warehouses}
                        company={app.company}
                        setCompany={app.setCompany}
                        jobNotifications={app.jobNotifications}
                        setJobNotifications={app.setJobNotifications}
                        maintenanceNotifications={app.maintenanceNotifications}
                        setMaintenanceNotifications={app.setMaintenanceNotifications}
                        setWarehouses={app.setWH}
                        logos={app.logos}
                        setLogos={app.setLogos}
                        rolePerms={app.rolePerms}
                        setRolePerms={app.setRolePerms}
                        acculynxConfig={app.acculynxConfig}
                        setAccuLynxConfig={app.setAccuLynxConfig}
                        lang={lang}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/logs"
                  element={
                    app.userPerms.users_manage ? (
                      <AuditLogView
                        perms={app.userPerms}
                        inv={app.inv}
                        users={app.users}
                        companyId={app.curUser?.companyId}
                        lang={lang}
                      />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                <Route
                  path="/owner"
                  element={
                    app.curUser.isPlatformAdmin ? (
                      <OwnerConsole user={app.curUser} lang={lang} />
                    ) : (
                      <Navigate to="/dashboard" replace />
                    )
                  }
                />
                {/* Sold outside the app on iOS. BillingView buys seat packs and opens
                the Stripe portal, both of which are purchases Apple would require
                to run through In-App Purchase. The flag guards the route
                registration itself, on top of the lazy import above being
                conditional, so the component drops out of the App Store bundle
                entirely. */}
                {!IS_IOS_APP && (
                  <Route
                    path="/billing"
                    element={
                      app.curUser.role === "admin" || app.curUser.isPlatformAdmin ? (
                        <BillingView user={app.curUser} lang={lang} />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                )}
                {/* No permission gate. Training is how someone learns the parts of
                the app they already have access to; gating it would hide the
                explanation from exactly the people who need it most. */}
                <Route
                  path="/training"
                  element={
                    <TrainingView
                      lang={lang}
                      user={app.curUser}
                      company={app.company}
                      trainingMedia={app.trainingMedia}
                      setTrainingMedia={app.setTrainingMedia}
                    />
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProfileView
                      user={app.curUser}
                      lang={lang}
                      onUpdateUser={(updated) => {
                        app.setCurUser(updated);
                        app.setUsers((p) =>
                          p.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)),
                        );
                      }}
                    />
                  }
                />
                <Route
                  path="/terms"
                  element={<TermsPage onBack={() => backFromAuthView(termsReturn)} />}
                />
                <Route
                  path="/privacy"
                  element={<PrivacyPage onBack={() => backFromAuthView(termsReturn)} />}
                />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </div>
      <Suspense fallback={null}>
        <ChatWidget user={app.curUser} lang={lang} />
      </Suspense>
    </IdleTimeoutWrapper>
  );
}
