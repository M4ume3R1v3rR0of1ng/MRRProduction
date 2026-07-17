// src/hooks/useAppData.js
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";
import { storage } from "../utils/storage";
import { useNotify } from "../context/NotificationContext";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "../data/seeds";
import { DEFAULT_ROLE_PERMS, getEffectivePerms } from "../database/permissions";
import { processOfflineQueue } from "../utils/offlineSync";
import { tot } from "../utils/helpers";
import { DEFAULT_JOB_NOTIFICATIONS } from "../utils/jobNotifications";

export function useAppData() {
  const [loading, setLoading] = useState(true);
  // ── 🟢 FIXED: ADDED LACKING PROGRESS TRACKER STATE ──
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  const [curUser, setCurUser] = useState(null);
  // Start empty, not seeded. Seeding the initial state meant Maumee River's trucks
  // and staff were the first thing rendered for EVERY company, for the moment before
  // the real fetch resolved. In a multi-tenant app that is another company's data on
  // screen, however briefly.
  const [users, setUsers] = useState([]);
  const [warehouses, setWH] = useState([]);
  const [inv, setInv] = useState([]);
  const [vehs, setVehs] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [jobTrailers, setJobTrailers] = useState([]);
  const [rolePerms, setRolePerms] = useState({
    warehouse: { ...DEFAULT_ROLE_PERMS.warehouse },
    coordinator: { ...DEFAULT_ROLE_PERMS.coordinator },
    manager: { ...DEFAULT_ROLE_PERMS.manager },
    employee: { ...DEFAULT_ROLE_PERMS.employee },
    field: { ...DEFAULT_ROLE_PERMS.field },
    bookkeeper: { ...DEFAULT_ROLE_PERMS.bookkeeper },
  });

  const [userOverrides, setUserOverrides] = useState({});
  // Table loads that errored during the last load() run. Non-empty triggers the
  // red "live data failed to load" banner in App — the affected lists are left
  // empty on purpose; plausible-looking seed data hid real outages.
  const [loadErrors, setLoadErrors] = useState([]);
  const [acculynxConfig, setAccuLynxConfig] = useState({
    apiKey: "",
    enabled: false,
    autoSync: true,
    proxyUrl: "",
  });
  const [logos, setLogos] = useState(null);
  // The company this session is working in: { id, name, slug, branding }.
  const [company, setCompany] = useState(null);
  // Per-company job-move email rules, from settings(key='job_notifications').
  // Off by default — automatic outbound email is opt-in per Settings → Notifications.
  const [jobNotifications, setJobNotifications] = useState(DEFAULT_JOB_NOTIFICATIONS);

  const { showToast } = useNotify();

  // Records which auth identity (user id, or null for anonymous) the last data load ran
  // under, so the auth listener below only refetches on a genuine identity change.
  const loadedAuthIdRef = useRef(null);

  // ── ⚙️ UNIFIED DATA INITIALIZATION ENGINE ──
  async function load() {
      console.log("🚀 Initializing Steadwerk boot sequence via useAppData...");
      try {
        setLoading(true);
        setLoadingProgress(10); // Start cache extraction step[cite: 6]

        const { data: { session } = {} } = await supabase.auth.getSession();
        loadedAuthIdRef.current = session?.user?.id || null;

        // ── Restore the signed-in user from the persisted session ──
        // Supabase keeps the session alive across reloads, but curUser was never
        // rehydrated from it — so a refresh dumped you back on the login screen even
        // though you were still authenticated. That also broke the company switcher,
        // which reloads the page on purpose.
        //
        // Identity now comes from the MEMBERSHIP (role is per-company), not from the
        // deprecated profiles.role.
        if (session?.user) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name, active, active_company_id, is_platform_admin")
            .eq("id", session.user.id)
            .maybeSingle();

          if (prof?.active && prof.active_company_id) {
            const { data: membership } = await supabase
              .from("memberships")
              .select("role, company_id, companies ( name )")
              .eq("user_id", session.user.id)
              .eq("company_id", prof.active_company_id)
              .eq("active", true)
              .maybeSingle();

            if (membership) {
              setCurUser({
                id: session.user.id,
                email: session.user.email,
                name: prof.full_name,
                role: membership.role,
                active: true,
                companyId: membership.company_id,
                companyName: membership.companies?.name || null,
                isPlatformAdmin: prof.is_platform_admin === true,
              });
            }
          }
        }

        const [ax] = await Promise.all([
          storage.get("mrr-v7-acculynx").catch(() => null),
        ]);

        if (ax?.value) setAccuLynxConfig((p) => ({ ...p, ...JSON.parse(ax.value) }));

        setLoadingProgress(25); // Cache verified, starting database lookups[cite: 6]

        // Smooth 9% progression helper for each completed query block[cite: 6]
        const trackProgress = (incrementValue) => {
          setLoadingProgress((prev) => Math.min(prev + incrementValue, 95));
        };

        // ⚠️ NO SEED FALLBACK ON EMPTY. This used to fall back to SEED_I / SEED_V /
        // SEED_JOBS / SEED_W / SEED_U whenever a table came back with zero rows.
        // That was defensible with one company; it is a serious bug with several.
        //
        // An empty table is the NORMAL state for a company that just signed up. With
        // the old behaviour, his brother's very first login would have shown him
        // Maumee River's trucks ('Truck 001'), warehouses, and staff ('Sam', 'Ian')
        // as though they were his own — real-looking data belonging to another
        // company, presented as his.
        //
        // Empty now renders empty. A FAILED query still records the failure so the UI
        // can say so, because fake data that looks real is worse than none.
        const failedTables = [];

        await Promise.all([
          (async () => {
            const { data, error } = await supabase.from("inventory").select("*");
            if (error) { failedTables.push("Inventory"); setInv([]); }
            else setInv(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("vehicles").select("*");
            if (error) { failedTables.push("Fleet"); setVehs([]); }
            else setVehs(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("jobs").select("*");
            if (error) { failedTables.push("Jobs"); setJobs([]); }
            else setJobs(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("maintenance_requests").select("*");
            if (error) { failedTables.push("Maintenance Requests"); setReqs([]); }
            else if (data && data.length > 0) setReqs(data.sort((a, b) => new Date(b.at) - new Date(a.at)));
            else setReqs([]);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("job_trailers").select("*");
            if (error) { failedTables.push("Trailer Assignments"); setJobTrailers([]); }
            else setJobTrailers(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("warehouses").select("*");
            if (error) { failedTables.push("Warehouses"); setWH([]); }
            else setWH(data || []);
            trackProgress(9);
          })(),
          (async () => {
            // RLS scopes both of these to the active company: profiles to people who
            // share it, memberships to that company's rows. So the join below is
            // already tenant-safe without any explicit filter.
            //
            // The role shown must be the MEMBERSHIP role, not profiles.role — the
            // latter is deprecated and, for someone who works at two companies, holds
            // whichever role was written last. Overlaying it here keeps the `users`
            // shape the rest of the app expects.
            const [{ data, error }, { data: mems }] = await Promise.all([
              supabase.from("profiles").select("*"),
              supabase.from("memberships").select("user_id, role, active"),
            ]);

            if (error) { failedTables.push("Users"); setUsers([]); }
            else {
              const roleByUser = Object.fromEntries((mems || []).map((m) => [m.user_id, m]));
              setUsers(
                (data || []).map((p) => {
                  const m = roleByUser[p.id];
                  return m ? { ...p, role: m.role, active: m.active } : p;
                }),
              );
            }
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("role_permissions").select("*");
            // On failure the safe DEFAULT_ROLE_PERMS stay in effect, but the
            // user is told — admin-customized permissions silently reverting
            // to defaults is otherwise invisible.
            if (error) failedTables.push("Permissions");
            else if (data && data.length > 0) {
              const formattedRolePerms = {};
              data.forEach((row) => {
                // Layer stored perms over defaults so perm keys added after the
                // row was saved (e.g. fleet_photo_delete) resolve to their default
                // instead of undefined/false until an admin toggles them.
                formattedRolePerms[row.role] = { ...(DEFAULT_ROLE_PERMS[row.role] || {}), ...row.permissions };
              });
              setRolePerms((p) => ({ ...p, ...formattedRolePerms }));
            }
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("user_permission_overrides").select("*");
            if (error) failedTables.push("User Permission Overrides");
            else if (data && data.length > 0) {
              const formattedUserOv = {};
              data.forEach((row) => {
                formattedUserOv[row.user_id] = row.overrides;
              });
              setUserOverrides(formattedUserOv);
            }
            trackProgress(7);
          })(),
          (async () => {
            // Branding (logo, colors, name) lives on the company row now. A user can
            // belong to several companies, so this goes through my_company() — which
            // returns exactly the ACTIVE one — rather than selecting from `companies`
            // and hoping there's only one row.
            const { data, error } = await supabase.rpc("my_company");
            const row = Array.isArray(data) ? data[0] : data;
            if (!error && row) {
              setCompany(row);
              if (row.branding?.logo) setLogos(row.branding.logo);
            }
            trackProgress(7);
          })(),
          (async () => {
            const { data, error } = await supabase.from("settings").select("value").eq("key", "acculynx_config").maybeSingle();
            if (!error && data?.value) {
              try {
                setAccuLynxConfig((p) => ({ ...p, ...JSON.parse(data.value) }));
              } catch (e) {
                console.error("Failed to parse stored AccuLynx config:", e);
              }
            }
            // The API key itself is not readable by the browser (column privileges),
            // so ask whether one is configured rather than trying to read it back.
            const { data: status } = await supabase.rpc("company_integration_status");
            if (status?.acculynxConfigured) {
              setAccuLynxConfig((p) => ({ ...p, apiKeyConfigured: true }));
            }
            trackProgress(7);
          })(),
          (async () => {
            const { data, error } = await supabase.from("settings").select("value").eq("key", "job_notifications").maybeSingle();
            if (!error && data?.value) {
              try {
                setJobNotifications((p) => ({ ...p, ...JSON.parse(data.value) }));
              } catch (e) {
                console.error("Failed to parse stored job-notification prefs:", e);
              }
            }
          })(),
        ]);

        setLoadErrors(failedTables);
        setLoadingProgress(100);
        console.log("🏁 Core synchronization complete. Hook environment primed.");
      } catch (e) {
        console.error("🚨 Critical failure during app instantiation sequence:", e);
        setLoadErrors(["App Startup"]);
      } finally {
        setLoading(false);
      }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 🔐 POST-LOGIN DATA REFETCH ──
  // The boot load above can run before anyone is signed in; RLS then returns zero rows
  // and every table falls back to seed data. Re-run the full load whenever a different
  // identity signs in. The id guard skips the SIGNED_IN echoes supabase emits on tab
  // refocus, so this only fires on real anonymous→user or user→user transitions.
  useEffect(() => {
    const { data: { subscription } = {} } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        loadedAuthIdRef.current = null;
        return;
      }
      if (event === "SIGNED_IN" && session?.user && session.user.id !== loadedAuthIdRef.current) {
        loadedAuthIdRef.current = session.user.id;
        load();
      }
    });
    return () => subscription?.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 💾 BACKGROUND STORAGE SYNCHRONIZER EFFECTS ──
  useEffect(() => { if (!loading) storage.set("mrr-v7-roleperms", JSON.stringify(rolePerms)).catch(() => {}); }, [rolePerms, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-userov", JSON.stringify(userOverrides)).catch(() => {}); }, [userOverrides, loading]);
  useEffect(() => { if (!loading) storage.set("mrr-v7-acculynx", JSON.stringify(acculynxConfig)).catch(() => {}); }, [acculynxConfig, loading]);

  // ── 📡 OFFLINE BACKEND RETRY LISTENER ──
  useEffect(() => {
    const handleReconnect = () => processOfflineQueue(showToast);
    window.addEventListener("online", handleReconnect);
    if (navigator.onLine) processOfflineQueue(showToast);
    return () => window.removeEventListener("online", handleReconnect);
  }, [showToast]);

  // ── 💬 TEAM CHAT UNREAD TRACKING ──
  const [chatUnread, setChatUnread] = useState(0);

  const markChatRead = async () => {
    if (!curUser) return;
    setChatUnread(0);
    try {
      // company_id is omitted on purpose — the column DEFAULTs to active_company_id(),
      // so Postgres fills it before resolving the conflict. The PK is (company_id,
      // user_id) now, and the conflict target has to match it exactly.
      await supabase.from("team_chat_reads").upsert(
        { user_id: curUser.id, last_read_at: new Date().toISOString() },
        { onConflict: "company_id,user_id" },
      );
    } catch (err) {
      console.error("Failed to update chat read state:", err);
    }
  };

  useEffect(() => {
    if (!curUser) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: readRow } = await supabase
          .from("team_chat_reads")
          .select("last_read_at")
          .eq("user_id", curUser.id)
          .maybeSingle();

        if (!readRow?.last_read_at) {
          // First time ever seeing chat — mark caught up instead of dumping the whole backlog as "unread".
          // team_chat_reads PK is (company_id, user_id); company_id comes from the column DEFAULT.
          await supabase.from("team_chat_reads").upsert(
            { user_id: curUser.id, last_read_at: new Date().toISOString() },
            { onConflict: "company_id,user_id" },
          );
          if (!cancelled) setChatUnread(0);
          return;
        }

        const { count } = await supabase
          .from("team_chat_messages")
          .select("id", { count: "exact", head: true })
          .gt("created_at", readRow.last_read_at)
          .neq("user_id", curUser.id);

        if (!cancelled) setChatUnread(count || 0);
      } catch (err) {
        console.error("Failed to compute chat unread count:", err);
      }
    })();

    const channel = supabase
      .channel("realtime-chat-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_chat_messages" }, (payload) => {
        if (payload.new.user_id !== curUser.id) {
          setChatUnread((prev) => prev + 1);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [curUser]);

  // ── 🔄 LIVE PERMISSION REFRESH ──
  // Permissions used to load once at login and go stale until re-login — an admin
  // toggling a role's access wouldn't reach anyone already signed in (the source of
  // the "I turned it on but it won't let him" confusion). Subscribe to changes on the
  // permission tables and re-pull; userPerms recomputes automatically from the new
  // rolePerms/userOverrides. RLS scopes the events to the caller's own company.
  useEffect(() => {
    if (!curUser) return;

    const refetchPerms = async () => {
      const [{ data: rp }, { data: ov }] = await Promise.all([
        supabase.from("role_permissions").select("*"),
        supabase.from("user_permission_overrides").select("*"),
      ]);
      if (rp) {
        const formatted = {};
        rp.forEach((row) => {
          formatted[row.role] = { ...(DEFAULT_ROLE_PERMS[row.role] || {}), ...row.permissions };
        });
        setRolePerms((p) => ({ ...p, ...formatted }));
      }
      const formattedOv = {};
      (ov || []).forEach((row) => { formattedOv[row.user_id] = row.overrides; });
      setUserOverrides(formattedOv);
    };

    const channel = supabase
      .channel("realtime-perms")
      .on("postgres_changes", { event: "*", schema: "public", table: "role_permissions" }, refetchPerms)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_permission_overrides" }, refetchPerms)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [curUser]);

  // ── 📊 COMPUTED MEMO VALUES ──
  const pendingReqCount = useMemo(() => reqs.filter((r) => r.status === "pending").length, [reqs]);
  const lowStockCount = useMemo(() => inv.filter((i) => tot(i) <= i.alrt).length, [inv]);
  const newJobsForMe = useMemo(() => curUser ? jobs.filter((j) => (j.newforassigned) && (j.assignedto || j.assignedTo) === curUser.id).length : 0, [jobs, curUser]);
  const jobsAwaitingCloseCount = useMemo(() => jobs.filter((j) => j.status === "completed").length, [jobs]);
  const activeLogo = logos || null;

  const userPerms = useMemo(() => {
    if (!curUser) return {};
    return getEffectivePerms(curUser, rolePerms, userOverrides);
  }, [curUser, rolePerms, userOverrides]);

  // ── 🔔 SIGN-IN ALERT: tell whoever can close jobs how many are waiting ──
  useEffect(() => {
    if (!curUser) return;
    const perms = getEffectivePerms(curUser, rolePerms, userOverrides);
    if (!perms.jobs_close) return;
    const count = jobs.filter((j) => j.status === "completed").length;
    if (count > 0) {
      showToast(
        `🧾 ${count} completed job${count !== 1 ? "s" : ""} waiting to be closed out once AccuLynx pricing is confirmed.`,
        "warning",
        8000,
      );
    }
    // Fires once per sign-in (curUser.id change), not on every jobs/rolePerms update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curUser?.id]);

  return {
    loading,
    loadingProgress, // Safely exposed to App.jsx for visual tracking
    loadErrors,
    reload: load,
    curUser,
    setCurUser,
    users,
    setUsers,
    warehouses,
    setWH,
    inv,
    setInv,
    vehs,
    setVehs,
    reqs,
    setReqs,
    jobs,
    setJobs,
    jobTrailers,
    setJobTrailers,
    rolePerms,
    setRolePerms,
    userOverrides,
    setUserOverrides,
    acculynxConfig,
    setAccuLynxConfig,
    chatUnread,
    markChatRead,
    logos,
    setLogos,
    company,
    setCompany,
    jobNotifications,
    setJobNotifications,
    pendingReqCount,
    lowStockCount,
    newJobsForMe,
    jobsAwaitingCloseCount,
    activeLogo,
    userPerms
  };
}