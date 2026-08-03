// netlify/functions/chat.js
// Data-aware AI chat widget backend. Runs server-side only — the Anthropic
// API key never reaches the browser. Every tool call is gated by the calling
// user's *actual* effective permissions, re-derived here from their verified
// session token (never trusted from the client), mirroring the same
// role/override logic as src/database/permissions.js's getEffectivePerms.

import Anthropic from "@anthropic-ai/sdk";
import { adminClient, resolveCaller } from "./_shared/tenant.js";

const ALLOWED_ORIGINS = [
  "https://steadwerk.com",
  "https://www.steadwerk.com",
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
  "http://localhost:8888",
  "http://localhost:3000",
];

function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

const TOOLS = [
  {
    name: "search_jobs",
    description:
      "Search production jobs/builds by status or free text (PO number, job name, or address). Returns PO, job name, address, status, and material item count. Use for questions about jobs, builds, or the production pipeline.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to match against PO number, job name, or address" },
        status: { type: "string", enum: ["draft", "approved", "active", "completed", "closed"], description: "Filter to a specific job status" },
      },
    },
  },
  {
    name: "get_inventory_status",
    description:
      "Look up warehouse inventory stock levels. Returns item name, category, unit, total stock on hand, and whether it's at/below its low-stock threshold. Use for questions about material stock or what's low/out of stock.",
    input_schema: {
      type: "object",
      properties: {
        item_name: { type: "string", description: "Filter to items whose name contains this text" },
        low_stock_only: { type: "boolean", description: "Only return items at or below their low-stock alert threshold" },
      },
    },
  },
  {
    name: "get_fleet_status",
    description:
      "Look up fleet vehicle status: mileage, miles since last oil change, oil change interval, and asset status. Use for questions about trucks, trailers, or fleet maintenance status.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_name: { type: "string", description: "Filter to vehicles whose name or plate contains this text" },
      },
    },
  },
  {
    name: "get_maintenance_requests",
    description:
      "Look up vehicle maintenance requests: vehicle, issue type, urgency, status, and notes. Use for questions about maintenance tickets or vehicle repair requests.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "scheduled", "completed"], description: "Filter to a specific request status" },
      },
    },
  },
  {
    name: "get_maintenance_insights",
    description:
      "Look up learned maintenance patterns: vehicles with chronic/recurring issues, fleet-wide trending issue types, and a predicted next-service date/mileage for a specific vehicle based on its own service history. Use for questions like 'which trucks have recurring problems', 'is anything trending up fleet-wide', or 'when will X need service next'.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_name: {
          type: "string",
          description: "Vehicle name or plate to get a predicted-next-service estimate for. Omit for fleet-wide chronic/trend insights only.",
        },
      },
    },
  },
  {
    name: "recommend_maintenance",
    description:
      "Produce a ranked, actionable maintenance to-do list for the fleet. Combines oil-change and detail status, each vehicle's own learned service cadence, and chronic repeat-repair patterns into one priority-ordered list with the evidence behind each item. Use this for questions like 'what maintenance should we do', 'what's due', 'what needs attention', or 'what should I schedule this month'. Prefer this over get_fleet_status when the user wants advice rather than raw numbers.",
    input_schema: {
      type: "object",
      properties: {
        vehicle_name: {
          type: "string",
          description: "Limit recommendations to vehicles whose name or plate contains this text. Omit for the whole fleet.",
        },
        horizon_days: {
          type: "number",
          description: "How far ahead to include predicted upcoming services, in days. Defaults to 30. Overdue items are always included regardless.",
        },
      },
    },
  },
];

// Mirrors src/utils/patterns.js — duplicated rather than imported because this
// function runs as CommonJS in Node while the frontend module is ESM.
function learnServiceIntervals(vehicle) {
  if (!vehicle?.sl || vehicle.sl.length < 2) return [];
  const byType = {};
  for (const s of vehicle.sl) {
    if (!s.type || !s.dt) continue;
    (byType[s.type] ||= []).push(s);
  }
  const results = [];
  for (const [type, entries] of Object.entries(byType)) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => new Date(a.dt) - new Date(b.dt));
    const dayGaps = [];
    const mileGaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (new Date(sorted[i].dt) - new Date(sorted[i - 1].dt)) / 86400000;
      if (days > 0) dayGaps.push(days);
      if (typeof sorted[i].mi === "number" && typeof sorted[i - 1].mi === "number" && sorted[i].mi > sorted[i - 1].mi) {
        mileGaps.push(sorted[i].mi - sorted[i - 1].mi);
      }
    }
    if (dayGaps.length === 0) continue;
    const avgDays = dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length;
    const avgMiles = mileGaps.length ? mileGaps.reduce((a, b) => a + b, 0) / mileGaps.length : null;
    const last = sorted[sorted.length - 1];
    const predictedNextDate = new Date(new Date(last.dt).getTime() + avgDays * 86400000).toISOString().split("T")[0];
    results.push({
      type,
      sampleSize: dayGaps.length,
      avgIntervalDays: Math.round(avgDays),
      avgIntervalMiles: avgMiles !== null ? Math.round(avgMiles) : null,
      predictedNextDate,
      predictedNextMileage: avgMiles !== null && typeof last.mi === "number" ? Math.round(last.mi + avgMiles) : null,
    });
  }
  return results.sort((a, b) => new Date(a.predictedNextDate) - new Date(b.predictedNextDate));
}

function detectChronicIssues(reqs, { windowDays = 60, minCount = 3 } = {}) {
  const cutoff = Date.now() - windowDays * 86400000;
  const groups = {};
  for (const r of reqs || []) {
    if (!r.at || new Date(r.at).getTime() < cutoff) continue;
    const types = (r.type || "").split(",").map((t) => t.trim()).filter(Boolean);
    for (const t of types) {
      const key = `${r.vid}::${t}`;
      (groups[key] ||= { vid: r.vid, vname: r.vname, issueType: t, dates: [] }).dates.push(r.at);
    }
  }
  return Object.values(groups)
    .filter((g) => g.dates.length >= minCount)
    .map((g) => ({ ...g, count: g.dates.length }))
    .sort((a, b) => b.count - a.count);
}

function detectFleetTrends(reqs, { recentDays = 30, baselineDays = 90, minRecentCount = 3, spikeRatio = 1.5 } = {}) {
  const now = Date.now();
  const recentCutoff = now - recentDays * 86400000;
  const baselineCutoff = recentCutoff - baselineDays * 86400000;
  const recentCounts = {};
  const baselineCounts = {};
  for (const r of reqs || []) {
    if (!r.at) continue;
    const t = new Date(r.at).getTime();
    const types = (r.type || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (t >= recentCutoff) {
      for (const type of types) recentCounts[type] = (recentCounts[type] || 0) + 1;
    } else if (t >= baselineCutoff) {
      for (const type of types) baselineCounts[type] = (baselineCounts[type] || 0) + 1;
    }
  }
  const allTypes = new Set([...Object.keys(recentCounts), ...Object.keys(baselineCounts)]);
  const results = [];
  for (const type of allTypes) {
    const recentCount = recentCounts[type] || 0;
    if (recentCount < minRecentCount) continue;
    const recentRate = recentCount / recentDays;
    const baselineCount = baselineCounts[type] || 0;
    const baselineRate = baselineCount / baselineDays;
    const isNew = baselineCount === 0;
    const ratio = isNew ? null : recentRate / baselineRate;
    if (isNew || ratio >= spikeRatio) {
      results.push({ issueType: type, recentCount, baselineCount, ratio: ratio !== null ? Math.round(ratio * 10) / 10 : null, isNew });
    }
  }
  return results.sort((a, b) => b.recentCount - a.recentCount);
}

// --- Maintenance recommendation engine ---------------------------------------
//
// Mirrors oilSt / detSt / predDays in src/utils/helpers.js, duplicated for the
// same reason as the pattern helpers above: this file runs standalone in the
// function bundle and can't import the frontend's ESM modules.
//
// The scoring and ranking below happen HERE, not in the model. Asking an LLM to
// do arithmetic across two dozen vehicles and then sort the results is exactly
// the kind of task it gets quietly wrong, and a wrong maintenance ranking is
// worse than no ranking at all. The model's job is to explain this list, not to
// derive it.

const DAY_MS = 86400000;

// Stored dates are plain calendar days ("YYYY-MM-DD"). Parse and format both
// ends in one frame (UTC) so a projection never drifts across a day boundary —
// the same mixed-reference-frame bug helpers.js calls out for detSt.
function parseDay(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function oilStatus(v) {
  if (v.type !== "truck") return null;
  const interval = Number(v.oii);
  if (!interval || interval <= 0) return null;
  const milesSince = (Number(v.mi) || 0) - (Number(v.lomi) || 0);
  const pct = milesSince / interval;
  return {
    milesSince: Math.round(milesSince),
    interval,
    milesRemaining: Math.round(interval - milesSince),
    state: pct >= 1 ? "overdue" : pct >= 0.8 ? "soon" : "ok",
  };
}

// Days until the oil change comes due, projected from how fast this truck
// actually accrues miles rather than a fleet-wide guess.
function daysUntilOilDue(v) {
  if (v.type !== "truck" || !Array.isArray(v.mil) || v.mil.length < 2) return null;
  const log = v.mil
    .filter((e) => e?.dt && typeof e.mi === "number" && parseDay(e.dt))
    .sort((a, b) => parseDay(a.dt) - parseDay(b.dt));
  if (log.length < 2) return null;
  const spanDays = (parseDay(log[log.length - 1].dt) - parseDay(log[0].dt)) / DAY_MS;
  if (spanDays < 1) return null;
  const milesPerDay = (log[log.length - 1].mi - log[0].mi) / spanDays;
  if (milesPerDay <= 0) return null;
  const remaining = Number(v.oii) - ((Number(v.mi) || 0) - (Number(v.lomi) || 0));
  return remaining <= 0 ? 0 : Math.round(remaining / milesPerDay);
}

function detailStatus(v) {
  const interval = Number(v.dii);
  if (!interval || interval <= 0) return null;
  // No recorded detail date means it has never been done — overdue, matching detSt.
  if (!v.ldd) return { daysSince: null, interval, state: "overdue" };
  const day = parseDay(v.ldd);
  if (!day) return null;
  const elapsed = (Date.now() - day.getTime()) / DAY_MS;
  return {
    daysSince: Math.round(elapsed),
    interval,
    state: elapsed >= interval ? "overdue" : elapsed >= interval * 0.8 ? "soon" : "ok",
  };
}

// Priority is a fixed scale, not a tuned model: overdue beats predicted, and a
// chronic fault outranks routine upkeep because it points at a root cause that
// keeps generating work.
const PRIORITY = {
  oilOverdue: 100,
  chronic: 90,
  serviceOverdue: 80,
  oilSoon: 60,
  detailOverdue: 50,
  serviceSoon: 40,
  detailSoon: 30,
};

// Exported for direct testing: the ranking is the part worth pinning down, and
// it's pure, so it can be exercised without a session or a database.
export function buildMaintenanceRecommendations(vehicles, reqs, { horizonDays = 30 } = {}) {
  const chronic = detectChronicIssues(reqs);
  const trends = detectFleetTrends(reqs);
  const trendingTypes = new Set(trends.map((t) => t.issueType));
  const now = Date.now();
  const recs = [];

  const add = (v, priority, urgency, item, reason, evidence) =>
    recs.push({
      vehicle: v.name,
      plate: v.plate || null,
      item,
      urgency,
      reason,
      evidence,
      priority,
    });

  for (const v of vehicles) {
    // A retired truck doesn't need an oil change. Recommending one wastes the
    // reader's attention and makes the whole list look untrustworthy.
    if (String(v.status || "").toLowerCase() === "retired") continue;

    const oil = oilStatus(v);
    if (oil?.state === "overdue") {
      add(v, PRIORITY.oilOverdue, "overdue", "Oil change",
        `${oil.milesSince} mi since the last change against a ${oil.interval} mi interval, ${Math.abs(oil.milesRemaining)} mi past due.`,
        oil);
    } else if (oil?.state === "soon") {
      const eta = daysUntilOilDue(v);
      add(v, PRIORITY.oilSoon, "due_soon", "Oil change",
        `${oil.milesRemaining} mi left of a ${oil.interval} mi interval${eta !== null ? `, roughly ${eta} days at this truck's own mileage rate` : ""}.`,
        { ...oil, estimatedDaysUntilDue: eta });
    }

    const detail = detailStatus(v);
    if (detail?.state === "overdue") {
      add(v, PRIORITY.detailOverdue, "overdue", "Detail",
        detail.daysSince === null
          ? "No detail has ever been recorded for this vehicle."
          : `${detail.daysSince} days since the last detail against a ${detail.interval} day interval.`,
        detail);
    } else if (detail?.state === "soon") {
      add(v, PRIORITY.detailSoon, "due_soon", "Detail",
        `${detail.daysSince} days since the last detail, interval is ${detail.interval} days.`,
        detail);
    }

    // Learned per-vehicle cadence: what this truck's own service history says
    // is coming, as opposed to the configured interval.
    for (const s of learnServiceIntervals(v)) {
      const due = parseDay(s.predictedNextDate);
      if (!due) continue;
      const inDays = Math.round((due.getTime() - now) / DAY_MS);
      const basis = `history shows about every ${s.avgIntervalDays} days across ${s.sampleSize} prior interval${s.sampleSize === 1 ? "" : "s"}`;
      const plural = (n) => `${n} day${Math.abs(n) === 1 ? "" : "s"}`;
      if (inDays < 0) {
        add(v, PRIORITY.serviceOverdue, "overdue", s.type,
          `Projected due ${s.predictedNextDate}, ${plural(Math.abs(inDays))} ago (${basis}).`, s);
      } else if (inDays === 0) {
        add(v, PRIORITY.serviceOverdue, "overdue", s.type,
          `Projected due today, ${s.predictedNextDate} (${basis}).`, s);
      } else if (inDays <= horizonDays) {
        add(v, PRIORITY.serviceSoon, "due_soon", s.type,
          `Projected due ${s.predictedNextDate}, in ${plural(inDays)} (${basis}).`, s);
      }
    }

    for (const c of chronic.filter((g) => g.vid === v.id)) {
      add(v, PRIORITY.chronic, "investigate", c.issueType,
        `${c.count} "${c.issueType}" requests in the last 60 days. Repeat repairs point at an underlying fault rather than a one-off${trendingTypes.has(c.issueType) ? ", and this issue type is also trending fleet-wide" : ""}.`,
        { ...c, trendingFleetWide: trendingTypes.has(c.issueType) });
    }
  }

  recs.sort((a, b) => b.priority - a.priority || String(a.vehicle).localeCompare(String(b.vehicle)));

  return {
    horizon_days: horizonDays,
    vehicles_reviewed: vehicles.length,
    recommendations: recs.slice(0, 40),
    fleet_trends: trends,
  };
}

// Mirrors src/database/permissions.js getEffectivePerms() — keep in sync.
// Permission config is per-company now: two companies can define 'manager' quite
// differently, so both lookups are scoped by companyId.
async function getEffectivePerms(admin, userId, companyId, role) {
  if (role === "admin") {
    return { jobs_view: true, inv_view: true, inv_pricing_view: true, fleet_view: true, maint_submit: true, maint_manage: true };
  }
  const [{ data: roleRow }, { data: overrideRow }] = await Promise.all([
    admin.from("role_permissions").select("permissions")
      .eq("company_id", companyId).eq("role", role).maybeSingle(),
    admin.from("user_permission_overrides").select("overrides")
      .eq("company_id", companyId).eq("user_id", userId).maybeSingle(),
  ]);
  return { ...(roleRow?.permissions || {}), ...(overrideRow?.overrides || {}) };
}

// ⚠️ `admin` is the SERVICE-ROLE client: RLS does not apply to a single query below.
// The .eq("company_id", companyId) on each one is the ONLY thing keeping the
// assistant from reading another company's jobs, trucks, and pricing. If you add a
// tool here, it must be scoped the same way.
async function executeTool(admin, perms, companyId, name, input) {
  switch (name) {
    case "search_jobs": {
      if (!perms.jobs_view) return { error: "This user does not have permission to view jobs." };
      let q = admin.from("jobs").select("po, title, name, addr, status, materials, items")
        .eq("company_id", companyId).limit(30);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) return { error: error.message };
      let jobs = data || [];
      if (input.query) {
        const needle = input.query.toLowerCase();
        jobs = jobs.filter(
          (j) =>
            (j.po || "").toLowerCase().includes(needle) ||
            (j.title || j.name || "").toLowerCase().includes(needle) ||
            (j.addr || "").toLowerCase().includes(needle),
        );
      }
      return jobs.slice(0, 10).map((j) => ({
        po: j.po,
        name: j.title || j.name,
        address: j.addr,
        status: j.status,
        material_count: (j.items || j.materials || []).length,
      }));
    }
    case "get_inventory_status": {
      if (!perms.inv_view) return { error: "This user does not have permission to view inventory." };
      const { data, error } = await admin.from("inventory").select("*")
        .eq("company_id", companyId).limit(300);
      if (error) return { error: error.message };
      let items = data || [];
      if (input.item_name) {
        const needle = input.item_name.toLowerCase();
        items = items.filter((i) => (i.name || "").toLowerCase().includes(needle));
      }
      const withStock = items.map((i) => {
        const stock = (i.batches || []).reduce((s, b) => s + (parseFloat(b.rem) || 0), 0);
        return {
          name: i.name,
          category: i.cat,
          unit: i.unit,
          stock,
          low_stock_alert: i.alrt,
          is_low_stock: stock <= i.alrt,
        };
      });
      const filtered = input.low_stock_only ? withStock.filter((i) => i.is_low_stock) : withStock;
      return filtered.slice(0, 25);
    }
    case "get_fleet_status": {
      if (!perms.fleet_view) return { error: "This user does not have permission to view fleet data." };
      const { data, error } = await admin.from("vehicles").select("*")
        .eq("company_id", companyId).limit(200);
      if (error) return { error: error.message };
      let vehs = data || [];
      if (input.vehicle_name) {
        const needle = input.vehicle_name.toLowerCase();
        vehs = vehs.filter(
          (v) => (v.name || "").toLowerCase().includes(needle) || (v.plate || "").toLowerCase().includes(needle),
        );
      }
      return vehs.slice(0, 25).map((v) => ({
        name: v.name,
        type: v.type,
        plate: v.plate,
        mileage: v.mi,
        miles_since_oil_change: v.type === "truck" ? (v.mi || 0) - (v.lomi || 0) : null,
        oil_change_interval: v.oii,
        status: v.status,
      }));
    }
    case "get_maintenance_requests": {
      if (!perms.maint_submit && !perms.maint_manage) {
        return { error: "This user does not have permission to view maintenance requests." };
      }
      let q = admin.from("maintenance_requests").select("*")
        .eq("company_id", companyId).limit(30);
      if (input.status) q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return (data || []).map((r) => ({
        vehicle: r.vname,
        type: r.type,
        urgency: r.urgency,
        status: r.status,
        notes: r.notes,
      }));
    }
    case "get_maintenance_insights": {
      if (!perms.maint_manage && !perms.fleet_view) {
        return { error: "This user does not have permission to view maintenance insights." };
      }
      const [{ data: vehData, error: vehError }, { data: reqData, error: reqError }] = await Promise.all([
        admin.from("vehicles").select("*").eq("company_id", companyId).limit(200),
        admin.from("maintenance_requests").select("*").eq("company_id", companyId).limit(500),
      ]);
      if (vehError) return { error: vehError.message };
      if (reqError) return { error: reqError.message };

      const result = {
        chronic_issues: detectChronicIssues(reqData || []),
        trending_issues: detectFleetTrends(reqData || []),
      };

      if (input.vehicle_name) {
        const needle = input.vehicle_name.toLowerCase();
        const veh = (vehData || []).find(
          (v) => (v.name || "").toLowerCase().includes(needle) || (v.plate || "").toLowerCase().includes(needle),
        );
        result.predicted_next_service = veh
          ? learnServiceIntervals(veh)
          : { error: `No vehicle found matching "${input.vehicle_name}".` };
      }

      return result;
    }
    case "recommend_maintenance": {
      if (!perms.maint_manage && !perms.fleet_view) {
        return { error: "This user does not have permission to view maintenance recommendations." };
      }
      const [{ data: vehData, error: vehError }, { data: reqData, error: reqError }] = await Promise.all([
        admin.from("vehicles").select("*").eq("company_id", companyId).limit(200),
        admin.from("maintenance_requests").select("*").eq("company_id", companyId).limit(500),
      ]);
      if (vehError) return { error: vehError.message };
      if (reqError) return { error: reqError.message };

      let vehicles = vehData || [];
      if (input.vehicle_name) {
        const needle = input.vehicle_name.toLowerCase();
        vehicles = vehicles.filter(
          (v) => (v.name || "").toLowerCase().includes(needle) || (v.plate || "").toLowerCase().includes(needle),
        );
        if (vehicles.length === 0) {
          return { error: `No vehicle found matching "${input.vehicle_name}".` };
        }
      }

      // Chronic/trend detection reads the whole company's request history even
      // when the caller asked about one truck — a fleet-wide spike is context
      // that changes the recommendation for the single vehicle too.
      const horizonDays =
        Number.isFinite(input.horizon_days) && input.horizon_days > 0 ? Math.min(input.horizon_days, 365) : 30;
      return buildMaintenanceRecommendations(vehicles, reqData || [], { horizonDays });
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export const handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  const { accessToken, messages } = body;
  if (!accessToken || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing accessToken or messages" }) };
  }

  try {
    // Service-role client: RLS is bypassed intentionally, because permission
    // enforcement happens explicitly below per verified user. Tenant isolation is
    // NOT free here — it comes from passing caller.companyId into every tool query.
    const admin = adminClient();

    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return { statusCode: callerError.status, headers: corsHeaders, body: JSON.stringify({ error: callerError.message }) };
    }

    const { data: profile } = await admin
      .from("profiles").select("full_name, name").eq("id", caller.userId).single();

    const perms = await getEffectivePerms(admin, caller.userId, caller.companyId, caller.role);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `You are the in-app assistant for ${caller.companyName}'s warehouse & fleet management system, an internal tool for warehouse staff, site supervisors, and office managers.
You are talking to ${profile?.full_name || profile?.name || "a user"} (role: ${caller.role}).
Answer questions about jobs, inventory, fleet vehicles, maintenance requests, and maintenance patterns/predictions using the tools provided — never invent data.
When asked what maintenance to do, what is due, or what needs attention, call recommend_maintenance. It returns an already-ranked list: present it in that order, lead with the overdue items, and cite the reason it gives. Do not re-sort it or compute your own mileage math.
All data you can see belongs to ${caller.companyName}. Never speculate about other companies on the platform; you have no access to them.
If a tool returns a permission error, tell the user plainly they don't have access to that information rather than guessing or making something up.
Keep answers short and directly useful — this is an internal ops tool, not a chatty assistant.`;

    let workingMessages = messages.slice(-20); // cap history sent per request
    let finalText = "";

    for (let i = 0; i < 5; i++) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages: workingMessages,
      });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      finalText = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      workingMessages = [...workingMessages, { role: "assistant", content: response.content }];
      const toolResults = await Promise.all(
        toolUses.map(async (toolUse) => ({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(
            await executeTool(admin, perms, caller.companyId, toolUse.name, toolUse.input || {}),
          ),
        })),
      );
      workingMessages = [...workingMessages, { role: "user", content: toolResults }];
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ reply: finalText || "I wasn't able to find an answer to that." }),
    };
  } catch (err) {
    console.error("Chat function error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};
