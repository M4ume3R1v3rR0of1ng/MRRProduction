// src/hooks/useAppData.js
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";
import { storage } from "../utils/storage";
import { useNotify } from "../context/NotificationContext";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "../data/seeds";
import { DEFAULT_ROLE_PERMS, getEffectivePerms } from "../database/permissions";
import { processOfflineQueue } from "../utils/offlineSync";
import { tot } from "../utils/helpers";

export function useAppData() {
  const [loading, setLoading] = useState(true);
  // ── 🟢 FIXED: ADDED LACKING PROGRESS TRACKER STATE ──
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  const [curUser, setCurUser] = useState(null);
  const [users, setUsers] = useState(SEED_U);
  const [warehouses, setWH] = useState(SEED_W);
  const [inv, setInv] = useState(SEED_I);
  const [vehs, setVehs] = useState(SEED_V);
  const [reqs, setReqs] = useState([]);
  const [jobs, setJobs] = useState(SEED_JOBS);
  const [jobTrailers, setJobTrailers] = useState([]);
  const [rolePerms, setRolePerms] = useState({
    warehouse: { ...DEFAULT_ROLE_PERMS.warehouse },
    coordinator: { ...DEFAULT_ROLE_PERMS.coordinator },
    manager: { ...DEFAULT_ROLE_PERMS.manager },
    field: { ...DEFAULT_ROLE_PERMS.field },
    bookkeeper: { ...DEFAULT_ROLE_PERMS.bookkeeper },
  });

  const [userOverrides, setUserOverrides] = useState({});
  const [acculynxConfig, setAccuLynxConfig] = useState({
    apiKey: "",
    enabled: false,
    autoSync: true,
    proxyUrl: "",
  });
  const [logos, setLogos] = useState(null);

  const { showToast } = useNotify();

  // Records which auth identity (user id, or null for anonymous) the last data load ran
  // under, so the auth listener below only refetches on a genuine identity change.
  const loadedAuthIdRef = useRef(null);

  // ── ⚙️ UNIFIED DATA INITIALIZATION ENGINE ──
  async function load() {
      console.log("🚀 Initializing Maumee River Roofing WMS Boot Sequence via useAppData...");
      try {
        setLoading(true);
        setLoadingProgress(10); // Start cache extraction step[cite: 6]

        const { data: { session } = {} } = await supabase.auth.getSession();
        loadedAuthIdRef.current = session?.user?.id || null;

        const [ax] = await Promise.all([
          storage.get("mrr-v7-acculynx").catch(() => null),
        ]);

        if (ax?.value) setAccuLynxConfig((p) => ({ ...p, ...JSON.parse(ax.value) }));

        setLoadingProgress(25); // Cache verified, starting database lookups[cite: 6]

        // Smooth 9% progression helper for each completed query block[cite: 6]
        const trackProgress = (incrementValue) => {
          setLoadingProgress((prev) => Math.min(prev + incrementValue, 95));
        };

        await Promise.all([
          (async () => {
            const { data, error } = await supabase.from("inventory").select("*");
            if (error) setInv(SEED_I);
            else if (data && data.length > 0) setInv(data);
            else setInv(SEED_I);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("vehicles").select("*");
            if (error) setVehs(SEED_V);
            else if (data && data.length > 0) setVehs(data);
            else setVehs(SEED_V);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("jobs").select("*");
            if (error) setJobs(SEED_JOBS);
            else if (data && data.length > 0) setJobs(data);
            else setJobs(SEED_JOBS);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("maintenance_requests").select("*");
            if (error) setReqs([]);
            else if (data && data.length > 0) setReqs(data.sort((a, b) => new Date(b.at) - new Date(a.at)));
            else setReqs([]);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("job_trailers").select("*");
            if (error) setJobTrailers([]);
            else setJobTrailers(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("warehouses").select("*");
            if (error) setWH(SEED_W);
            else if (data && data.length > 0) setWH(data);
            else setWH(SEED_W);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("profiles").select("*");
            if (error) setUsers(SEED_U);
            else if (data && data.length > 0) setUsers(data);
            else setUsers(SEED_U);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("role_permissions").select("*");
            if (data && data.length > 0) {
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
            if (data && data.length > 0) {
              const formattedUserOv = {};
              data.forEach((row) => {
                formattedUserOv[row.user_id] = row.overrides;
              });
              setUserOverrides(formattedUserOv);
            }
            trackProgress(7);
          })(),
          (async () => {
            const { data, error } = await supabase.from("settings").select("value").eq("key", "company_logo").maybeSingle();
            if (!error && data?.value) setLogos(data.value);
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
            trackProgress(7);
          })(),
        ]);

        setLoadingProgress(100);
        console.log("🏁 Core synchronization complete. Hook environment primed.");
      } catch (e) {
        console.error("🚨 Critical failure during app instantiation sequence:", e);
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
      await supabase.from("team_chat_reads").upsert(
        { user_id: curUser.id, last_read_at: new Date().toISOString() },
        { onConflict: "user_id" },
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
          await supabase.from("team_chat_reads").upsert(
            { user_id: curUser.id, last_read_at: new Date().toISOString() },
            { onConflict: "user_id" },
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

  // ── 📊 COMPUTED MEMO VALUES ──
  const pendingReqCount = useMemo(() => reqs.filter((r) => r.status === "pending").length, [reqs]);
  const lowStockCount = useMemo(() => inv.filter((i) => tot(i) <= i.alrt).length, [inv]);
  const newJobsForMe = useMemo(() => curUser ? jobs.filter((j) => (j.newforassigned || j.newForAssigned) && (j.assignedto || j.assignedTo) === curUser.id).length : 0, [jobs, curUser]);
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
    pendingReqCount,
    lowStockCount,
    newJobsForMe,
    jobsAwaitingCloseCount,
    activeLogo,
    userPerms
  };
}