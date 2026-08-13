// src/hooks/useAppData.js
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../utils/supabase";
import { storage } from "../utils/storage";
import { useNotify } from "../context/NotificationContext";
import { SEED_U, SEED_W, SEED_I, SEED_V, SEED_JOBS } from "../data/seeds";
import { DEFAULT_ROLE_PERMS, getEffectivePerms } from "../database/permissions";
import { tot } from "../utils/helpers";
import { defaultPrefs, mergePrefs, groupById } from "../utils/automations";
import { resolveMaintManagers } from "../utils/maintenanceNotifications";

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
    // No explicit folder chosen means the server files into "Job Paperwork", which
    // is where the office puts these by hand today, so this needs no setup beyond
    // the API token.
    documentFolderId: "",
    documentFolderName: "Job Paperwork",
  });
  const [logos, setLogos] = useState(null);
  // The company this session is working in: { id, name, slug, branding }.
  const [company, setCompany] = useState(null);
  // Per-company automation rules, one settings row per group (see utils/automations).
  // Off by default — automatic outbound email is opt-in per Settings → Automations.
  const [jobNotifications, setJobNotifications] = useState(() => defaultPrefs("jobs"));
  const [maintenanceNotifications, setMaintenanceNotifications] = useState(() => defaultPrefs("maintenance"));
  // Company-uploaded training clips and photos. The bundled product tour is NOT here:
  // it ships in the build via src/data/trainingVideos.js. See supabase/26.
  const [trainingMedia, setTrainingMedia] = useState([]);

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
        // The company this session operates in. Every read below is scoped to it
        // EXPLICITLY, not just through RLS: a platform admin's RLS can read EVERY
        // company, which pours all tenants' jobs, inventory, and users onto one
        // dashboard. Platform-wide oversight lives in the Owner Console instead.
        let activeCompanyId = null;
        if (session?.user) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name, active, active_company_id, is_platform_admin")
            .eq("id", session.user.id)
            .maybeSingle();

          let targetCompanyId = prof?.active ? prof.active_company_id : null;

          // No company selected yet. A password sign-in always picks one, through
          // set_active_company() in LoginScreen — but an OAuth return never runs
          // that code: Google hands the browser back with a session already made
          // and no form submit to hang the selection off. With exactly one active
          // membership there is nothing to choose, so take it here rather than
          // bouncing the user to a picker with a single button on it. Two or more
          // is left unset on purpose: that choice is theirs, and LoginScreen has
          // the picker for it.
          if (prof?.active && !targetCompanyId) {
            const { data: memberships } = await supabase
              .from("memberships")
              .select("company_id")
              .eq("user_id", session.user.id)
              .eq("active", true);
            if (memberships?.length === 1) {
              const { error: pickErr } = await supabase.rpc("set_active_company", {
                target: memberships[0].company_id,
              });
              if (!pickErr) targetCompanyId = memberships[0].company_id;
            }
          }

          if (targetCompanyId) {
            activeCompanyId = targetCompanyId;
            const { data: membership } = await supabase
              .from("memberships")
              .select("role, company_id, companies ( name )")
              .eq("user_id", session.user.id)
              .eq("company_id", targetCompanyId)
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
            } else if (prof.is_platform_admin === true) {
              // The platform owner visiting a tenant they hold no membership in.
              // There is no membership row to read a role or a company name off,
              // so take the name from companies directly — their RLS already
              // permits it. The server agrees they act as 'admin' here; see
              // active_role() in supabase/31.
              const { data: co } = await supabase
                .from("companies")
                .select("name")
                .eq("id", targetCompanyId)
                .maybeSingle();
              setCurUser({
                id: session.user.id,
                email: session.user.email,
                name: prof.full_name,
                role: "admin",
                active: true,
                companyId: targetCompanyId,
                companyName: co?.name || null,
                isPlatformAdmin: true,
                // Drives the persistent banner. Being inside someone else's data
                // must never be a state you can forget you are in.
                isVisiting: true,
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

        // The platform operator's own tenant (Steadwerk). It runs no roofing
        // operations, so every query below would return an empty set — eleven round
        // trips to prove there are no jobs at a company that will never have one.
        // The nav hides those views anyway (see Sidebar), so skip straight to the
        // company row, which is all the Owner Console shell needs.
        //
        // Read from `companies` rather than my_company() because that RPC is one of
        // the queries in the block being skipped, and this decision has to be made
        // before the block runs.
        let platformCompany = false;
        if (activeCompanyId) {
          const { data: coFlag } = await supabase
            .from("companies")
            .select("id, name, slug, branding, is_platform_company")
            .eq("id", activeCompanyId)
            .maybeSingle();
          platformCompany = coFlag?.is_platform_company === true;
          if (platformCompany) {
            setCompany(coFlag);
            if (coFlag.branding?.logo) setLogos(coFlag.branding.logo);
            setInv([]);
            setVehs([]);
            setJobs([]);
            setReqs([]);
            setJobTrailers([]);
            setWH([]);
            setTrainingMedia([]);
            // Users and permissions DO matter here: Steadwerk has staff, and the
            // Users and Settings screens stay available to administer them.
            const { data: mems } = await supabase
              .from("memberships")
              .select("user_id, role, active")
              .eq("company_id", activeCompanyId);
            const memberIds = (mems || []).map((m) => m.user_id);
            const { data: profs } = memberIds.length
              ? await supabase.from("profiles").select("*").in("id", memberIds)
              : { data: [] };
            const roleByUser = Object.fromEntries((mems || []).map((m) => [m.user_id, m]));
            setUsers((profs || []).map((p) => {
              const m = roleByUser[p.id];
              return m ? { ...p, role: m.role, active: m.active } : p;
            }));
            setLoadErrors([]);
            setLoadingProgress(100);
            return;
          }
        }

        // No active company: signed out, or signed in but not placed in one yet.
        //
        // Every query below filters on company_id, and PostgREST serialises a null
        // filter as the literal string "null" — which Postgres rejects the moment
        // it casts to uuid ("invalid input syntax for type uuid: \"null\"", 22P02).
        // So this block used to fire eleven malformed requests on every logged-out
        // boot and then report them as failed tables, which surfaces a data-loss
        // warning to someone whose session simply has nothing to load.
        //
        // Clearing rather than just returning matters on a user→user switch: the
        // previous account's inventory and jobs are still in state, and leaving
        // them there would show one company's data to the next person.
        if (!activeCompanyId) {
          setInv([]);
          setVehs([]);
          setJobs([]);
          setReqs([]);
          setJobTrailers([]);
          setWH([]);
          setUsers([]);
          setUserOverrides({});
          setTrainingMedia([]);
          setLoadErrors([]);
          setLoadingProgress(100);
          return;
        }

        await Promise.all([
          (async () => {
            const { data, error } = await supabase.from("inventory").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Inventory"); setInv([]); }
            else setInv(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("vehicles").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Fleet"); setVehs([]); }
            else setVehs(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("jobs").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Jobs"); setJobs([]); }
            else setJobs(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("maintenance_requests").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Maintenance Requests"); setReqs([]); }
            else if (data && data.length > 0) setReqs(data.sort((a, b) => new Date(b.at) - new Date(a.at)));
            else setReqs([]);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("job_trailers").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Trailer Assignments"); setJobTrailers([]); }
            else setJobTrailers(data || []);
            trackProgress(9);
          })(),
          (async () => {
            const { data, error } = await supabase.from("warehouses").select("*").eq("company_id", activeCompanyId);
            if (error) { failedTables.push("Warehouses"); setWH([]); }
            else setWH(data || []);
            trackProgress(9);
          })(),
          (async () => {
            // Scope to the ACTIVE company's members. RLS is NOT enough: a platform
            // admin can read every profile and membership, which would list every
            // company's people here. Filter memberships to this company, then pull only
            // those profiles.
            //
            // The role shown must be the MEMBERSHIP role, not profiles.role — the latter
            // is deprecated and, for someone who works at two companies, holds whichever
            // role was written last. Overlaying it here keeps the `users` shape the rest
            // of the app expects.
            const { data: mems } = await supabase
              .from("memberships")
              .select("user_id, role, active")
              .eq("company_id", activeCompanyId);
            const memberIds = (mems || []).map((m) => m.user_id);
            const { data, error } = memberIds.length
              ? await supabase.from("profiles").select("*").in("id", memberIds)
              : { data: [], error: null };

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
            const { data, error } = await supabase.from("role_permissions").select("*").eq("company_id", activeCompanyId);
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
            const { data, error } = await supabase.from("user_permission_overrides").select("*").eq("company_id", activeCompanyId);
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
            const { data, error } = await supabase.from("settings").select("value").eq("key", "acculynx_config").eq("company_id", activeCompanyId).maybeSingle();
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
            // Ordered here rather than in the view so the list is already right if
            // anything else ever renders it. A missing table (migration 26 not run)
            // leaves the library empty rather than failing the whole boot.
            const { data, error } = await supabase
              .from("training_media")
              .select("*")
              .eq("company_id", activeCompanyId)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true });
            if (error) {
              console.error("Training media failed to load:", error);
              return;
            }
            setTrainingMedia(data || []);
          })(),
          // One settings row per automation group. Read them in parallel and merge each
          // onto its registry defaults, so a key added to the registry after a company
          // last saved resolves to that key's default instead of undefined.
          ...[
            ["jobs", setJobNotifications],
            ["maintenance", setMaintenanceNotifications],
          ].map(([groupId, setPrefs]) => (async () => {
            const settingsKey = groupById(groupId)?.settingsKey;
            if (!settingsKey) return;
            const { data, error } = await supabase.from("settings").select("value").eq("key", settingsKey).maybeSingle();
            if (!error && data?.value) {
              try {
                setPrefs(mergePrefs(groupId, JSON.parse(data.value)));
              } catch (e) {
                console.error(`Failed to parse stored ${groupId} automation prefs:`, e);
              }
            }
          })()),
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
          .eq("company_id", curUser.companyId)
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
          .eq("company_id", curUser.companyId)
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
        supabase.from("role_permissions").select("*").eq("company_id", curUser.companyId),
        supabase.from("user_permission_overrides").select("*").eq("company_id", curUser.companyId),
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

  // Who a new maintenance request emails: the maint_manage holders, resolved once here
  // rather than threading rolePerms and userOverrides into every view that can file one.
  // Same predicate as the dashboard popup, so the email and the popup always agree.
  const maintManagers = useMemo(
    () => resolveMaintManagers(users, rolePerms, userOverrides),
    [users, rolePerms, userOverrides],
  );

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
    maintenanceNotifications,
    setMaintenanceNotifications,
    maintManagers,
    trainingMedia,
    setTrainingMedia,
    pendingReqCount,
    lowStockCount,
    newJobsForMe,
    jobsAwaitingCloseCount,
    activeLogo,
    userPerms
  };
}