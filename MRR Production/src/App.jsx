// src/App.jsx
import { lazy, Suspense, useState, useEffect } from "react";
import { supabase } from "./utils/supabase";
import { useAppData } from "./hooks/useAppData";
import OmniSearch from "./components/OmniSearch";
import SyncIndicator from "./components/SyncIndicator";
import { RoleBdg, SkeletonCards, LoadingState } from "./components/UIPrimitives";
import IdleTimeoutWrapper from "./components/IdleTimeoutWrapper";

// Centralized Stateless Calculation & Helper Utilities
import { C, tot, oilSt, predDays, detSt, fd, fm } from "./utils/helpers";
import { translations } from "./utils/translations";
import { IS_IOS_APP } from "./utils/platform";

import CompanySwitcher from "./components/CompanySwitcher";
import VisitingBanner from "./components/VisitingBanner";
import { SteadwerkMark, TrussMark, BRAND } from "./components/SteadwerkMark";
import Sidebar from "./layouts/Sidebar";

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
import LandingPage from "./views/LandingPage";

const LoginScreen = lazy(() => import("./views/LoginScreen"));
const TermsPage = lazy(() => import("./views/TermsPage"));
const PrivacyPage = lazy(() => import("./views/PrivacyPage"));
const TrainingPage = lazy(() => import("./views/TrainingPage"));
const TrainingView = lazy(() => import("./views/TrainingView"));
const ResetPasswordScreen = lazy(() => import("./views/ResetPasswordScreen"));
const OwnerConsole = lazy(() => import("./views/OwnerConsole"));
// The conditional is load-bearing, not belt-and-braces. Gating only the render
// site leaves this lazy() declaration referencing the chunk, so Rollup still
// emits BillingView into the App Store bundle: unreachable, but shipped. Putting
// the import() in a branch that folds away at build time is what actually keeps
// the seat-purchase and Stripe-portal code out of the binary.
const BillingView = IS_IOS_APP ? null : lazy(() => import("./views/BillingView"));
const DashboardView = lazy(() => import("./views/DashboardView"));
const ScheduleView = lazy(() => import("./views/ScheduleView"));
const ProfileView = lazy(() => import("./views/ProfileView"));
const InventoryView = lazy(() => import("./views/InventoryView.jsx"));
const BuildJobsView = lazy(() => import("./views/BuildJobsView"));
const PullInventoryView = lazy(() => import("./views/PullInventoryView"));
const FleetManagementView = lazy(() => import("./views/FleetManagementView"));
const MaintenanceRequestsView = lazy(() => import("./views/MaintenanceRequestsView"));
const ReportsView = lazy(() => import("./views/ReportsView"));
const UserManagementView = lazy(() => import("./views/UserManagementView"));
const SettingsView = lazy(() => import("./views/SettingsView"));
const AuditLogView = lazy(() => import("./views/AuditLogView"));

// The assistant is a floating widget, useful but never the reason someone opened
// the app, so it loads after the view they actually asked for.
const ChatWidget = lazy(() => import("./components/ChatWidget"));

// Mascot Branding Asset



// Shown while a lazy view chunk is in flight. Painted on the app ground rather
// than left blank so a slow connection does not flash white between routes.
function ChunkFallback({ full = false }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: full ? "100vh" : 240, width: "100%", background: full ? C.bg : "transparent",
    }}>
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
  const [view, setView] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useState("");
  // Deep-link from OmniSearch: which record the destination view should open
  const [searchOpenTarget, setSearchOpenTarget] = useState(null); // { view, id }

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

  // What a logged-out visitor sees. "landing" is the public marketing front door;
  // "login" is the sign-in / signup form. Fresh visitors start on the landing;
  // logging out or finishing a password reset drops returning users straight to
  // the login form instead of back through marketing. loginMode picks which tab
  // the LoginScreen opens on ("login" vs. the self-serve "start a company" flow).
  //
  // The iOS app opens on the login form and can never reach "landing": that page
  // publishes the subscription rates, and an App Store build that shows a price
  // is an App Store build that owes Apple In-App Purchase. See utils/platform.js.
  const [authView, setAuthView] = useState(IS_IOS_APP ? "login" : "landing");
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
  // curUser, and authView's "landing" default would strand them on the hero with
  // no way to finish signing in. LoginScreen picks the session up and shows the
  // company picker, so send them there.
  useEffect(() => {
    if (app.loading || app.curUser) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } = {} }) => {
      if (!cancelled && session?.user) setAuthView("login");
    });
    return () => { cancelled = true; };
  }, [app.loading, app.curUser]);

  // The active tenant's name for display. branding.displayName (editable in Settings)
  // wins over the canonical companies.name, which itself beats the membership copy.
  // Falls back to the PRODUCT name, never to a hardcoded tenant — that would show one
  // company another's name.
  const companyDisplayName =
    app.company?.branding?.displayName || app.company?.name || app.curUser?.companyName || "Steadwerk";

  // The platform operator's own tenant — no roofing operations, so the app is the
  // Owner Console rather than the product. See supabase/32.
  const isPlatformCompany = app.company?.is_platform_company === true;

  // "dashboard" is the wrong landing here: it renders crews, trucks and job counts
  // for a company that has none, and the sidebar no longer offers it. Move to the
  // console once, when the flag first resolves, and only from the default view so
  // this can never yank someone off a screen they navigated to themselves.
  useEffect(() => {
    if (isPlatformCompany && view === "dashboard") setView("owner");
  }, [isPlatformCompany, view]);

  // ── 🧭 BROWSER NATIVE HISTORY POPSTATE INTERCEPTOR ──
  // Two separate navigation spaces share one history stack: the public flow
  // (landing / login / terms, keyed by `authView`) and the signed-in portal
  // (keyed by `view`). Which one a popped entry belongs to depends on whether
  // anyone is signed in, so branch on that rather than on the entry alone.
  useEffect(() => {
    const handlePopState = (event) => {
      const state = event.state || {};
      if (!app.curUser) {
        // The very first entry of a visit has no state object at all, and that
        // entry is always the landing page. On iOS there is no landing page, so
        // the floor is the login form: popping back must never surface pricing.
        setAuthView(state.authView || (IS_IOS_APP ? "login" : "landing"));
        return;
      }
      setView(state.view || "dashboard");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [app.curUser]);

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

  // Public navigation has to push a real history entry, the same way navigateTo
  // does for the portal. Landing → Sign in / Start your company / Terms were
  // plain setState calls, so the browser had nothing to pop and Back looked
  // broken — it either did nothing or dumped you off the site entirely.
  const goAuthView = (next) => {
    setAuthView(next);
    window.history.pushState({ authView: next }, "", "");
  };

  // Back out of a public screen. Prefer real history so the browser's own Back
  // button and the in-app one stay on the same stack; fall back to a plain state
  // change when this screen was reached without a push (a logout drops straight
  // to "login", and popping there would leave the site).
  const backFromAuthView = (fallback) => {
    if (window.history.state?.authView) window.history.back();
    else setAuthView(fallback);
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const navigateTo = (nextView) => {
    setView(nextView);
    window.history.pushState({ view: nextView }, "", "");
  };

  const openSearchResult = (targetView, itemId) => {
    setSearchOpenTarget({ view: targetView, id: itemId });
    navigateTo(targetView);
  };
  const searchTargetFor = (v) => (searchOpenTarget?.view === v ? searchOpenTarget.id : null);
  const clearSearchTarget = () => setSearchOpenTarget(null);

  // A job that just moved down the pipeline, handed to whichever screen now owns
  // it: { view, id, label }. The label is what the destination card's badge says,
  // so "Just built" and "Just completed" can use one mechanism.
  //
  // Deliberately NOT the search target above: that one opens the job's detail
  // modal, and this is meant to leave the card sitting there glowing until the
  // person actually goes and touches it.
  const [jobHighlight, setJobHighlight] = useState(null);
  const showJobIn = (targetView, jobId, label) => {
    setJobHighlight({ view: targetView, id: jobId, label });
    navigateTo(targetView);
  };
  const highlightFor = (v) => (jobHighlight?.view === v ? jobHighlight : null);
  const clearJobHighlight = () => setJobHighlight(null);

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
      setAuthView("login");
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
    return typeof navigator !== "undefined" && String(navigator.language || "").toLowerCase().startsWith("es")
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
          // Password changed and session signed out inside the screen. Clear the
          // recovery token from the URL and drop back to a clean login.
          window.history.replaceState({}, "", window.location.pathname);
          app.setCurUser(null);
          setAuthView("login");
          setRecovery(false);
        }}
      />
      </Suspense>
    );
  }

  // ── ⏳ HARDENED PROGRESS BAR LOADING FALLBACK ──
  if (app.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyGroup: "center", justifyContent: "center", minHeight: "100vh", background: C.bg, flexDirection: "column", gap: "var(--space-6)" }}>
        {/* Platform mark, not the Maumee River mascot — this splash renders for every
            company on the platform, before we even know which one. */}
        <div style={{ marginBottom: 4 }}>
          <SteadwerkMark size={88} filled />
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", width: "100%", maxWidth: "240px" }}>
          {/* External Track Container */}
          <div style={{ width: "100%", height: "6px", backgroundColor: C.line, borderRadius: "10px", overflow: "hidden" }}>
            {/* Dynamic Colored Bar Indicator */}
            <div
              style={{
                height: "100%",
                backgroundColor: C.amber,
                width: `${app.loadingProgress}%`,
                transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                borderRadius: "10px"
              }}
            />
          </div>

          <div style={{ color: C.navy, fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", letterSpacing: "0.5px", marginTop: 4 }}>
            Syncing your yard... {app.loadingProgress}%
          </div>
        </div>

        {/* A skeleton of the dashboard sitting under the progress bar. The bar
            alone leaves the screen empty for the whole load; showing the shape
            that is coming makes the wait feel shorter and stops the hard jump
            from blank to full dashboard. Hidden on phones, where it would push
            the progress bar off-screen. */}
        <div className="sw-hide-phone" style={{ width: "100%", maxWidth: 880, padding: "0 24px", marginTop: 8, opacity: 0.55 }}>
          <SkeletonCards count={3} cols={3} />
        </div>
      </div>
    );
  }

  // ── 🔒 AUTH CHECK RENDER LAYER ──
  if (!app.curUser) {
    // Public Terms & Conditions page — reachable from the landing footer and the
    // login disclaimer; "← Back" returns to whichever opened it.
    if (authView === "terms") {
      return (
        <Suspense fallback={<ChunkFallback full />}>
          <TermsPage onBack={() => backFromAuthView(termsReturn)} />
        </Suspense>
      );
    }
    // Public Privacy Policy. Shares termsReturn with the Terms page above: both
    // are reachable from the same two places and both go back where they came
    // from, so a second piece of state would only be a second thing to keep in
    // step. Apple requires a reachable privacy URL for App Store review, and
    // this route is it.
    if (authView === "privacy") {
      return (
        <Suspense fallback={<ChunkFallback full />}>
          <PrivacyPage onBack={() => backFromAuthView(termsReturn)} />
        </Suspense>
      );
    }
    // Public help & training page — the product tour and future walkthroughs.
    // Lazy like Terms: it carries its own stylesheet and a video element, and
    // cold traffic landing on the marketing page should not pay for either.
    if (authView === "training") {
      return (
        <Suspense fallback={<ChunkFallback full />}>
          <TrainingPage onBack={() => backFromAuthView("landing")} />
        </Suspense>
      );
    }
    // Public front door. The marketing landing page hands off to the login/signup
    // form via its Sign in / Start your company buttons.
    // The !IS_IOS_APP guard is what actually keeps LandingPage out of the App
    // Store bundle: it is the only reference to the component, so with the flag
    // folded to false at build time the whole marketing page and every rate on it
    // is dropped rather than merely made unreachable.
    if (!IS_IOS_APP && authView === "landing") {
      return (
        <LandingPage
          onSignIn={() => { setLoginMode("login"); goAuthView("login"); }}
          onStart={() => { setLoginMode("signup"); goAuthView("login"); }}
          onShowTerms={() => { setTermsReturn("landing"); goAuthView("terms"); }}
          onShowPrivacy={() => { setTermsReturn("landing"); goAuthView("privacy"); }}
          onShowTraining={() => goAuthView("training")}
        />
      );
    }
    return (
      <Suspense fallback={<ChunkFallback full />}>
      <LoginScreen
        onLogin={(u) => {
          app.setCurUser(u);
          navigateTo("dashboard");
        }}
        initialMode={loginMode}
        onBack={() => backFromAuthView("landing")}
        onShowTerms={() => { setTermsReturn("login"); goAuthView("terms"); }}
        onShowPrivacy={() => { setTermsReturn("login"); goAuthView("privacy"); }}
        activeLogo={app.activeLogo}
        lang={lang}
        setLang={setLang}
      />
      </Suspense>
    );
  }

return (
<IdleTimeoutWrapper 
      lang={lang}
      isAuthenticated={!!app.curUser} 
      onLogout={handleLogout}
      timeout={1800000}
    >    {/* ── 🟢 1. LOCK THE ROOT CONTAINER VIEWPORT TO SCREEN HEIGHT ── */}
    <div style={{
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      height: "100vh", // Force the layout wrapper to freeze at exactly screen height
      maxHeight: "100vh",
      background: C.bg,
      fontFamily: "var(--font-sans)",
      width: "100vw",
      overflow: "hidden" // Prevents the whole browser page from ever scrolling
    }}>

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
          <div style={{ background: C.shell, color: C.shellInk, padding: "var(--safe-top) calc(20px + var(--safe-right)) 0 calc(20px + var(--safe-left))", height: "var(--chrome-total)", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 4px rgba(0,0,0,0.15)", flexShrink: 0 }}>
            {/* The TENANT's name, not the platform's. This header sits inside their
                portal — hardcoding "MAUMEE RIVER ROOFING" here would have greeted
                every other company by your company's name. */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)", fontSize: "var(--text-base)", color: C.shellInk }}>
              <TrussMark size={20} />
              {companyDisplayName}
            </div>
            <button onClick={() => setMobileMenuOpen((o) => !o)} style={{ background: "transparent", border: "none", color: C.shellInk, fontSize: "var(--text-3xl)", cursor: "pointer", lineHeight: 1 }}>
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
        <div style={{ width: isMobile ? "100%" : collapsed ? 64 : 260, display: isMobile && !mobileMenuOpen ? "none" : "block", position: isMobile ? "fixed" : "relative", top: isMobile ? "var(--chrome-total)" : 0, left: 0, height: isMobile ? "calc(100vh - var(--chrome-total))" : "100vh", paddingBottom: isMobile ? "var(--safe-bottom)" : 0, boxSizing: "border-box", zIndex: 99, overflowY: "auto", flexShrink: 0 }}>
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
        <div style={{ 
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
          overflow: "hidden"
        }}>
          {app.loadErrors.length > 0 && (
            <div style={{ background: "var(--c-rust-wash)", borderBottom: "2px solid var(--c-rust)", color: "var(--c-rust)", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0, fontSize: "var(--text-sm)", fontWeight: "var(--weight-bold)" }}>
              <span>
                ⚠️ Live data failed to load: {app.loadErrors.join(", ")}. Those sections are shown empty rather than with possibly-wrong data — don't make changes until this clears.
              </span>
              <button
                onClick={() => app.reload()}
                style={{ background: C.rust, color: C.onAccent, border: "none", borderRadius: "var(--radius-md)", padding: "6px 14px", cursor: "pointer", fontWeight: "var(--weight-bold)", fontSize: "var(--text-sm)", flexShrink: 0 }}
              >
                🔄 Retry
              </button>
            </div>
          )}
          {!isMobile && (
            <div style={{ background: C.w, padding: "0 20px", height: 56, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.bd}`, boxShadow: "var(--shadow-xs)", flexShrink: 0 }}>
              <div style={{ fontSize: "var(--text-sm)", color: C.sub, flexShrink: 0, marginRight: 24 }}>
                {companyDisplayName}{app.warehouses?.[0]?.name ? ` · ${app.warehouses[0].name}` : ""}
              </div>

              <div style={{ flex: 1, maxWidth: "400px", display: "flex", justifyContent: "flex-start", paddingRight: "40px" }}>
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

              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)", flexShrink: 0, marginLeft: 24 }}>
                <SyncIndicator lang={lang} />
                {app.newJobsForMe > 0 && (
                  <div onClick={() => navigateTo("pull")} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    🎉 {app.newJobsForMe} {app.newJobsForMe === 1 ? t.chromeNewJobOne : t.chromeNewJobMany}
                  </div>
                )}
                {app.pendingReqCount > 0 && app.userPerms.maint_manage && (
                  <div onClick={() => navigateTo("requests")} style={{ background: C.pB, color: C.pu, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    🔧 {app.pendingReqCount} {t.chromePending}
                  </div>
                )}
                {app.lowStockCount > 0 && app.userPerms.inv_view && (
                  <div onClick={() => navigateTo("inventory")} style={{ background: C.aB, color: C.am, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
                    ⚠️ {app.lowStockCount} {t.chromeLowStock}
                  </div>
                )}
                {app.jobsAwaitingCloseCount > 0 && app.userPerms.jobs_close && (
                  <div onClick={() => navigateTo("buildjobs")} style={{ background: C.tB, color: C.tl, borderRadius: 20, padding: "3px 10px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", cursor: "pointer" }}>
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
              background: C.bg 
            }}
          >
            {/* One boundary for the whole switch: only one view is ever mounted,
                so a single fallback covers every route change. */}
            <Suspense fallback={<ChunkFallback />}>
            {view === "dashboard" && (
              <DashboardView inv={app.inv} vehs={app.vehs} reqs={app.reqs} jobs={app.jobs} jobTrailers={app.jobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} onNav={navigateTo} tot={tot} jSC={jSC} lang={lang} setLang={setLang} onMarkChatRead={app.markChatRead} setJobs={app.setJobs} setReqs={app.setReqs} company={app.company} activeLogo={app.activeLogo} />
            )}
            {view === "schedule" && (
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
            )}
            {view === "buildjobs" && (app.userPerms.jobs_build || app.userPerms.jobs_close) && (
              <BuildJobsView jobs={app.jobs} company={app.company} jobNotifications={app.jobNotifications} setJobs={app.setJobs} inv={app.inv} vehs={app.vehs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} jSC={jSC} view={view} onNav={navigateTo} acculynxConfig={app.acculynxConfig} lang={lang} setLang={setLang} openItemId={searchTargetFor("buildjobs")} onOpenItemHandled={clearSearchTarget} activeLogo={app.activeLogo} highlight={highlightFor("buildjobs")} onHighlightCleared={clearJobHighlight} onShowJobIn={showJobIn}/>
            )}
            {view === "pull" && (
              <PullInventoryView jobs={app.jobs} company={app.company} jobNotifications={app.jobNotifications} setJobs={app.setJobs} inv={app.inv} setInv={app.setInv} vehs={app.vehs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} users={app.users} user={app.curUser} perms={app.userPerms} activeLogo={app.activeLogo} acculynxConfig={app.acculynxConfig} jSC={jSC} lang={lang} setLang={setLang} openItemId={searchTargetFor("pull")} onOpenItemHandled={clearSearchTarget} highlight={highlightFor("pull")} onHighlightCleared={clearJobHighlight} onShowJobIn={showJobIn} />
            )}
            {view === "inventory" && app.userPerms.inv_view && (
              <InventoryView inv={app.inv} setInv={app.setInv} jobs={app.jobs} setJobs={app.setJobs} users={app.users} user={app.curUser} perms={app.userPerms} inventorySearchQuery={inventorySearchQuery} setInventorySearchQuery={setInventorySearchQuery} lang={lang} setLang={setLang} />
            )}
            {view === "fleet" && app.userPerms.fleet_view && (
              <FleetManagementView vehs={app.vehs} setVehs={app.setVehs} reqs={app.reqs} setReqs={app.setReqs} jobs={app.jobs} setJobs={app.setJobs} jobTrailers={app.jobTrailers} setJobTrailers={app.setJobTrailers} jSC={jSC} users={app.users} user={app.curUser} perms={app.userPerms} maintenanceNotifications={app.maintenanceNotifications} maintManagers={app.maintManagers} oilSt={oilSt} detSt={detSt} predDays={predDays} fd={fd} fm={fm} inventorySearchQuery={inventorySearchQuery} setInventorySearchQuery={setInventorySearchQuery} lang={lang} setLang={setLang} openItemId={searchTargetFor("fleet")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "requests" && (app.userPerms.maint_submit || app.userPerms.maint_manage) && (
              <MaintenanceRequestsView reqs={app.reqs} setReqs={app.setReqs} vehs={app.vehs} users={app.users} user={app.curUser} perms={app.userPerms} maintenanceNotifications={app.maintenanceNotifications} maintManagers={app.maintManagers} lang={lang} setLang={setLang} openItemId={searchTargetFor("requests")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "reports" && app.userPerms.reports_view && (
              <ReportsView jobs={app.jobs} setJobs={app.setJobs} users={app.users} user={app.curUser} perms={app.userPerms} inv={app.inv} vehs={app.vehs} reqs={app.reqs} lang={lang} setLang={setLang} />
            )}
            {view === "users" && app.userPerms.users_manage && (
              <UserManagementView users={app.users} setUsers={app.setUsers} currentUser={app.curUser} rolePerms={app.rolePerms} userOverrides={app.userOverrides} setUserOverrides={app.setUserOverrides} onUpdateUser={(updated) => { app.setCurUser(updated); app.setUsers((p) => p.map((u) => (u.id === updated.id ? { ...u, ...updated } : u))); }} lang={lang} setLang={setLang} openItemId={searchTargetFor("users")} onOpenItemHandled={clearSearchTarget} />
            )}
            {view === "settings" && app.userPerms.settings_manage && (
              <SettingsView warehouses={app.warehouses} company={app.company} setCompany={app.setCompany} jobNotifications={app.jobNotifications} setJobNotifications={app.setJobNotifications} maintenanceNotifications={app.maintenanceNotifications} setMaintenanceNotifications={app.setMaintenanceNotifications} setWarehouses={app.setWH} logos={app.logos} setLogos={app.setLogos} rolePerms={app.rolePerms} setRolePerms={app.setRolePerms} acculynxConfig={app.acculynxConfig} setAccuLynxConfig={app.setAccuLynxConfig} lang={lang} />
            )}
            {view === "logs" && app.userPerms.users_manage && (
              <AuditLogView perms={app.userPerms} inv={app.inv} users={app.users} companyId={app.curUser?.companyId} lang={lang} />
            )}
            {view === "owner" && app.curUser.isPlatformAdmin && (
              <OwnerConsole user={app.curUser} lang={lang} />
            )}
            {/* Sold outside the app on iOS. BillingView buys seat packs and opens
                the Stripe portal, both of which are purchases Apple would require
                to run through In-App Purchase. The flag is first in the chain so
                the component drops out of the App Store bundle entirely. */}
            {!IS_IOS_APP && view === "billing" && (app.curUser.role === "admin" || app.curUser.isPlatformAdmin) && (
              <BillingView user={app.curUser} lang={lang} />
            )}
            {/* No permission gate. Training is how someone learns the parts of
                the app they already have access to; gating it would hide the
                explanation from exactly the people who need it most. */}
            {view === "training" && (
              <TrainingView lang={lang} user={app.curUser} company={app.company} trainingMedia={app.trainingMedia} setTrainingMedia={app.setTrainingMedia} />
            )}
            {view === "profile" && (
              <ProfileView
                user={app.curUser}
                lang={lang}
                onUpdateUser={(updated) => {
                  app.setCurUser(updated);
                  app.setUsers((p) => p.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
                }}
              />
            )}
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