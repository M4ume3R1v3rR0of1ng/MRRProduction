// netlify/functions/chat.js
//
// A.N.V.I.L.'s backend — Assistant for Navigating Vehicles, Inventory & Labor.
//
// Runs server-side only: the Anthropic API key never reaches the browser.
// Every tool call is gated by the calling user's *actual* effective
// permissions, re-derived from their verified session token (never trusted
// from the client) by _shared/anvilPerms.js, which mirrors the same
// role/override logic as src/shared/database/permissions.js.
//
// TWO KINDS OF TOOL LIVE HERE
//
//   READ tools (below) answer questions and are safe to run the moment the
//   model asks for one. Permission-gated, company-scoped, and that's it.
//
//   WRITE tools (_shared/anvilActions.js) never fire on the turn the model
//   requests them. They return a signed preview, the user presses Confirm, and
//   a second request commits it. That module's header explains why.
//
// WHERE THE PAGE CONTEXT COMES FROM
//
// The widget sends which view the user is on and which record they have open,
// so "when is this one due?" resolves without them typing a unit number. It is
// a HINT APPENDED TO THE PROMPT, never a permission: a client that lies about
// its context still cannot read a thing the tool guards below would refuse.

import Anthropic from "@anthropic-ai/sdk";
import { adminClient, resolveCaller, corsHeaders as getCorsHeaders } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { checkRateLimit, rateLimitedResponse } from "./_shared/rateLimit.js";
import { parseDay, oilStatus, daysUntilOilDue } from "./_shared/oilForecast.js";
import { getEffectivePerms, loadCompanyRoster } from "./_shared/anvilPerms.js";
import {
  ACTION_TOOLS,
  ACTION_NAMES,
  previewAction,
  executeAction,
  verifyAction,
} from "./_shared/anvilActions.js";
import { buildBriefing, loadBriefingData } from "./_shared/anvilBriefing.js";

// CORS used to be a second, hand-copied ALLOWED_ORIGINS list here, which had
// drifted from _shared/tenant.js's copy and was missing "capacitor://localhost" —
// the iOS app's origin under WKWebView. That silently CORS-blocked chat for
// every iOS user. Importing the one shared list means it can't drift again.

const READ_TOOLS = [
  {
    name: "search_jobs",
    description:
      "Search production jobs/builds by status or free text (PO number, job name, or address). Returns PO, job name, address, status, and material item count. Use for questions about jobs, builds, or the production pipeline.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free text to match against PO number, job name, or address",
        },
        status: {
          type: "string",
          enum: ["draft", "approved", "active", "completed", "closed"],
          description: "Filter to a specific job status",
        },
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
        low_stock_only: {
          type: "boolean",
          description: "Only return items at or below their low-stock alert threshold",
        },
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
        vehicle_name: {
          type: "string",
          description: "Filter to vehicles whose name or plate contains this text",
        },
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
        status: {
          type: "string",
          enum: ["pending", "scheduled", "completed"],
          description: "Filter to a specific request status",
        },
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
          description:
            "Vehicle name or plate to get a predicted-next-service estimate for. Omit for fleet-wide chronic/trend insights only.",
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
          description:
            "Limit recommendations to vehicles whose name or plate contains this text. Omit for the whole fleet.",
        },
        horizon_days: {
          type: "number",
          description:
            "How far ahead to include predicted upcoming services, in days. Defaults to 30. Overdue items are always included regardless.",
        },
      },
    },
  },
  {
    name: "get_schedule",
    description:
      "Look up what is on the calendar for a window of days: jobs with their supervisor and trailers, maintenance in the shop, and any trailer double-booked between the two. Use for questions about the schedule, what is on today or this week, who is where, or whether anything clashes.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "First day of the window, YYYY-MM-DD. Defaults to today.",
        },
        days: {
          type: "number",
          description: "How many days the window covers. Defaults to 7, maximum 31.",
        },
      },
    },
  },
  {
    name: "get_job_costing",
    description:
      "Look up what jobs cost and earned: material cost actual vs planned, contract value, gross margin on materials, and a portfolio total. Use for questions about profitability, margin, cost overruns, or which jobs lost money. NOTE: this is revenue minus MATERIAL cost only — labour, overhead, subs and disposal are not in this system, so never call the result profit without saying so.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Narrow to jobs matching this PO, name or address." },
        status: {
          type: "string",
          enum: ["draft", "approved", "active", "completed", "closed"],
          description: "Filter to a specific job status.",
        },
        worst_first: {
          type: "boolean",
          description: "Sort by thinnest margin first, for finding the jobs that went wrong.",
        },
      },
    },
  },
  {
    name: "get_training_status",
    description:
      "Look up training compliance: who has assignments outstanding, which are overdue, and what is due soon. Use for questions about training, certifications, or who still has to watch something.",
    input_schema: {
      type: "object",
      properties: {
        person: {
          type: "string",
          description:
            "Narrow to one person by name or email. Omit for everyone the user is allowed to see.",
        },
        overdue_only: {
          type: "boolean",
          description: "Only return assignments past their due date.",
        },
      },
    },
  },
  {
    name: "get_my_briefing",
    description:
      "Assemble the caller's own operational briefing for today — the same one A.N.V.I.L. writes to them each morning: today's jobs, overdue oil changes, pending tickets, low stock, outstanding training, and loose ends, all filtered to what this user is allowed to see. Use when the user asks what they should be looking at, what needs attention, how the day looks, or for a catch-up.",
    input_schema: { type: "object", properties: {} },
  },
];

// What the model is offered: reads plus the confirm-gated writes.
const TOOLS = [...READ_TOOLS, ...ACTION_TOOLS];

// ── THE SYSTEM PROMPT IS SPLIT IN TWO, AND THE SPLIT IS LOAD-BEARING ───────
//
// Prompt caching is a PREFIX match, and the request renders in the order
// tools → system → messages. The frozen half below therefore sits directly
// after a tool list that never changes, which makes those ~3k tokens one
// stable prefix worth caching.
//
// Everything that varies per caller — their name, their role, their company,
// the page they are looking at — lives in the second block instead. It used to
// open the prompt, which put volatile bytes ahead of every instruction and
// made the whole thing uncacheable: a different name meant a different prefix,
// so nothing after it could ever be reused.
//
// The win is bigger than one request. A turn that calls tools re-sends this
// entire prefix on each pass of the loop below, up to five times, so the cache
// pays off WITHIN a single question as well as across a conversation.
//
// Keep this string free of interpolation. Anything company- or user-specific
// that creeps in here silently stops the cache from ever being read.
const STATIC_SYSTEM = `You are A.N.V.I.L. — Assistant for Navigating Vehicles, Inventory & Labor — the built-in assistant inside a Steadwerk account, an internal tool for warehouse staff, site supervisors, drivers, and office managers.
Answer questions about jobs, inventory, fleet vehicles, maintenance, the schedule, job costing, and training using the tools provided — never invent data.
When asked what maintenance to do, what is due, or what needs attention, call recommend_maintenance. It returns an already-ranked list: present it in that order, lead with the overdue items, and cite the reason it gives. Do not re-sort it or compute your own mileage math.
When asked how the day or week looks, or what they should be looking at, call get_my_briefing — it is already filtered to what this person is allowed to see.
Job costing covers MATERIAL cost only. Labour, overhead, subcontractors and disposal are not tracked anywhere in this system, so never call a margin from get_job_costing "profit" without saying what it leaves out.
You can also CHANGE things: file and schedule maintenance requests, correct stock, and log mileage. Those tools do not act when you call them — they return a preview, and the app shows the user a Confirm button. So: call the tool once, relay its summary in one short sentence, and stop. Never say something has been filed, corrected, scheduled or logged on the strength of a preview; the user has not pressed Confirm yet, and you will not be told when they do.
If a write tool reports an ambiguous match, ask the user which one they meant rather than guessing.
Never speculate about other companies on the platform; you have no access to them.
If a tool returns a permission error, tell the user plainly they don't have access to that rather than guessing or making something up.
Keep answers short and directly useful — this is an internal ops tool, not a chatty assistant.`;

/**
 * The half of the prompt that changes per request, kept deliberately small so
 * the cached prefix above carries the weight.
 */
function callerSystemBlock({ companyName, actorName, role, contextLine }) {
  return [
    `You are talking to ${actorName} (role: ${role}), in ${companyName}'s account.`,
    `All data you can see belongs to ${companyName}.`,
    contextLine,
  ]
    .filter(Boolean)
    .join("\n");
}

// Mirrors src/features/fleet/patterns.js — duplicated rather than imported because this
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
      if (
        typeof sorted[i].mi === "number" &&
        typeof sorted[i - 1].mi === "number" &&
        sorted[i].mi > sorted[i - 1].mi
      ) {
        mileGaps.push(sorted[i].mi - sorted[i - 1].mi);
      }
    }
    if (dayGaps.length === 0) continue;
    const avgDays = dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length;
    const avgMiles = mileGaps.length ? mileGaps.reduce((a, b) => a + b, 0) / mileGaps.length : null;
    const last = sorted[sorted.length - 1];
    const predictedNextDate = new Date(new Date(last.dt).getTime() + avgDays * 86400000)
      .toISOString()
      .split("T")[0];
    results.push({
      type,
      sampleSize: dayGaps.length,
      avgIntervalDays: Math.round(avgDays),
      avgIntervalMiles: avgMiles !== null ? Math.round(avgMiles) : null,
      predictedNextDate,
      predictedNextMileage:
        avgMiles !== null && typeof last.mi === "number" ? Math.round(last.mi + avgMiles) : null,
    });
  }
  return results.sort((a, b) => new Date(a.predictedNextDate) - new Date(b.predictedNextDate));
}

function detectChronicIssues(reqs, { windowDays = 60, minCount = 3 } = {}) {
  const cutoff = Date.now() - windowDays * 86400000;
  const groups = {};
  for (const r of reqs || []) {
    if (!r.at || new Date(r.at).getTime() < cutoff) continue;
    const types = (r.type || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
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

function detectFleetTrends(
  reqs,
  { recentDays = 30, baselineDays = 90, minRecentCount = 3, spikeRatio = 1.5 } = {},
) {
  const now = Date.now();
  const recentCutoff = now - recentDays * 86400000;
  const baselineCutoff = recentCutoff - baselineDays * 86400000;
  const recentCounts = {};
  const baselineCounts = {};
  for (const r of reqs || []) {
    if (!r.at) continue;
    const t = new Date(r.at).getTime();
    const types = (r.type || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
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
      results.push({
        issueType: type,
        recentCount,
        baselineCount,
        ratio: ratio !== null ? Math.round(ratio * 10) / 10 : null,
        isNew,
      });
    }
  }
  return results.sort((a, b) => b.recentCount - a.recentCount);
}

// --- Maintenance recommendation engine ---------------------------------------
//
// detailStatus below mirrors detSt in src/shared/utils/helpers.js, duplicated
// for the same reason as the pattern helpers above: this file runs standalone
// in the function bundle and can't import the frontend's ESM modules. oilStatus
// and daysUntilOilDue used to be duplicated the same way; they now live in
// ./_shared/oilForecast.js, a real shared import within this functions bundle.
//
// The scoring and ranking below happen HERE, not in the model. Asking an LLM to
// do arithmetic across two dozen vehicles and then sort the results is exactly
// the kind of task it gets quietly wrong, and a wrong maintenance ranking is
// worse than no ranking at all. The model's job is to explain this list, not to
// derive it.

const DAY_MS = 86400000;

// parseDay, oilStatus, daysUntilOilDue now live in ./_shared/oilForecast.js —
// send-maintenance-push-notices.js needs the exact same projection this file
// has always used for get_fleet_status/recommend_maintenance, so it's a real
// shared import rather than a third copy.

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
      add(
        v,
        PRIORITY.oilOverdue,
        "overdue",
        "Oil change",
        `${oil.milesSince} mi since the last change against a ${oil.interval} mi interval, ${Math.abs(oil.milesRemaining)} mi past due.`,
        oil,
      );
    } else if (oil?.state === "soon") {
      const eta = daysUntilOilDue(v);
      add(
        v,
        PRIORITY.oilSoon,
        "due_soon",
        "Oil change",
        `${oil.milesRemaining} mi left of a ${oil.interval} mi interval${eta !== null ? `, roughly ${eta} days at this truck's own mileage rate` : ""}.`,
        { ...oil, estimatedDaysUntilDue: eta },
      );
    }

    const detail = detailStatus(v);
    if (detail?.state === "overdue") {
      add(
        v,
        PRIORITY.detailOverdue,
        "overdue",
        "Detail",
        detail.daysSince === null
          ? "No detail has ever been recorded for this vehicle."
          : `${detail.daysSince} days since the last detail against a ${detail.interval} day interval.`,
        detail,
      );
    } else if (detail?.state === "soon") {
      add(
        v,
        PRIORITY.detailSoon,
        "due_soon",
        "Detail",
        `${detail.daysSince} days since the last detail, interval is ${detail.interval} days.`,
        detail,
      );
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
        add(
          v,
          PRIORITY.serviceOverdue,
          "overdue",
          s.type,
          `Projected due ${s.predictedNextDate}, ${plural(Math.abs(inDays))} ago (${basis}).`,
          s,
        );
      } else if (inDays === 0) {
        add(
          v,
          PRIORITY.serviceOverdue,
          "overdue",
          s.type,
          `Projected due today, ${s.predictedNextDate} (${basis}).`,
          s,
        );
      } else if (inDays <= horizonDays) {
        add(
          v,
          PRIORITY.serviceSoon,
          "due_soon",
          s.type,
          `Projected due ${s.predictedNextDate}, in ${plural(inDays)} (${basis}).`,
          s,
        );
      }
    }

    for (const c of chronic.filter((g) => g.vid === v.id)) {
      add(
        v,
        PRIORITY.chronic,
        "investigate",
        c.issueType,
        `${c.count} "${c.issueType}" requests in the last 60 days. Repeat repairs point at an underlying fault rather than a one-off${trendingTypes.has(c.issueType) ? ", and this issue type is also trending fleet-wide" : ""}.`,
        { ...c, trendingFleetWide: trendingTypes.has(c.issueType) },
      );
    }
  }

  recs.sort(
    (a, b) => b.priority - a.priority || String(a.vehicle).localeCompare(String(b.vehicle)),
  );

  return {
    horizon_days: horizonDays,
    vehicles_reviewed: vehicles.length,
    recommendations: recs.slice(0, 40),
    fleet_trends: trends,
  };
}

// ── Job costing ─────────────────────────────────────────────────────────────
//
// Mirrors src/features/reports/jobCosting.js, duplicated for the same reason
// learnServiceIntervals above is: that module is part of the browser bundle.
// The arithmetic is deliberately done HERE and not left to the model — asking
// one to compute margins across a job list is exactly the kind of task it gets
// quietly and confidently wrong.
const jobLines = (job) => (job?.items || job?.materials || []).filter(Boolean);

const numOf = (v) => {
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

// What the crew actually consumed, priced at the batches it genuinely came
// from (priceAtPull, resolved by FIFO) — not an average of the catalog price.
const actualMaterialCost = (job) =>
  jobLines(job).reduce(
    (s, i) => s + (numOf(i.pulled) - numOf(i.returned)) * numOf(i.priceAtPull),
    0,
  );

const plannedMaterialCost = (job) =>
  jobLines(job).reduce((s, i) => s + numOf(i.planned) * numOf(i.priceAtPull), 0);

// Zero is treated as unset on purpose: it is far more likely an empty field
// saved as 0 than a genuinely free roof.
const contractValue = (job) => {
  const v = parseFloat(String(job?.contract_value));
  return Number.isFinite(v) && v > 0 ? v : null;
};

const round2 = (n) => Math.round(n * 100) / 100;

// `admin` is the SERVICE-ROLE client: RLS does not apply to a single query below.
// The .eq("company_id", companyId) on each one is the ONLY thing keeping A.N.V.I.L.
// from reading another company's jobs, trucks, and pricing. If you add a tool
// here, it must be scoped the same way.
async function executeTool(admin, perms, caller, actorName, name, input) {
  const companyId = caller.companyId;
  switch (name) {
    case "search_jobs": {
      if (!perms.jobs_view) return { error: "This user does not have permission to view jobs." };
      let q = admin
        .from("jobs")
        .select("po, title, name, addr, status, materials, items")
        .eq("company_id", companyId)
        .limit(30);
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
      if (!perms.inv_view)
        return { error: "This user does not have permission to view inventory." };
      const { data, error } = await admin
        .from("inventory")
        .select("*")
        .eq("company_id", companyId)
        .limit(300);
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
      if (!perms.fleet_view)
        return { error: "This user does not have permission to view fleet data." };
      const { data, error } = await admin
        .from("vehicles")
        .select("*")
        .eq("company_id", companyId)
        .limit(200);
      if (error) return { error: error.message };
      let vehs = data || [];
      if (input.vehicle_name) {
        const needle = input.vehicle_name.toLowerCase();
        vehs = vehs.filter(
          (v) =>
            (v.name || "").toLowerCase().includes(needle) ||
            (v.plate || "").toLowerCase().includes(needle),
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
      let q = admin.from("maintenance_requests").select("*").eq("company_id", companyId).limit(30);
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
      const [{ data: vehData, error: vehError }, { data: reqData, error: reqError }] =
        await Promise.all([
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
          (v) =>
            (v.name || "").toLowerCase().includes(needle) ||
            (v.plate || "").toLowerCase().includes(needle),
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
      const [{ data: vehData, error: vehError }, { data: reqData, error: reqError }] =
        await Promise.all([
          admin.from("vehicles").select("*").eq("company_id", companyId).limit(200),
          admin.from("maintenance_requests").select("*").eq("company_id", companyId).limit(500),
        ]);
      if (vehError) return { error: vehError.message };
      if (reqError) return { error: reqError.message };

      let vehicles = vehData || [];
      if (input.vehicle_name) {
        const needle = input.vehicle_name.toLowerCase();
        vehicles = vehicles.filter(
          (v) =>
            (v.name || "").toLowerCase().includes(needle) ||
            (v.plate || "").toLowerCase().includes(needle),
        );
        if (vehicles.length === 0) {
          return { error: `No vehicle found matching "${input.vehicle_name}".` };
        }
      }

      // Chronic/trend detection reads the whole company's request history even
      // when the caller asked about one truck — a fleet-wide spike is context
      // that changes the recommendation for the single vehicle too.
      const horizonDays =
        Number.isFinite(input.horizon_days) && input.horizon_days > 0
          ? Math.min(input.horizon_days, 365)
          : 30;
      return buildMaintenanceRecommendations(vehicles, reqData || [], { horizonDays });
    }
    case "get_schedule": {
      // Jobs and maintenance both have to be visible for the answer to be
      // honest — a schedule missing shop time reads as a free truck.
      if (!perms.jobs_view) {
        return { error: "This user does not have permission to view the schedule." };
      }
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input.from || ""))
        ? input.from
        : new Date().toISOString().slice(0, 10);
      const days = Number.isFinite(input.days) && input.days > 0 ? Math.min(input.days, 31) : 7;

      const [
        { data: jobData, error: jobError },
        { data: reqData, error: reqError },
        { data: vehData, error: vehError },
        { data: linkData, error: linkError },
        { roster, error: rosterError },
      ] = await Promise.all([
        admin
          .from("jobs")
          .select('id, po, title, name, addr, status, "scheduledDate", assignedto')
          .eq("company_id", companyId)
          .limit(500),
        perms.maint_submit || perms.maint_manage || perms.fleet_view
          ? admin
              .from("maintenance_requests")
              .select("id, vid, vname, type, urgency, status, scheduled_date")
              .eq("company_id", companyId)
              .limit(500)
          : Promise.resolve({ data: [], error: null }),
        admin.from("vehicles").select("id, name").eq("company_id", companyId).limit(200),
        admin
          .from("job_trailers")
          .select("job_id, trailer_id")
          .eq("company_id", companyId)
          .limit(1000),
        // Not a bare profiles select — see loadCompanyRoster's header for why
        // that would hand over every tenant's names.
        loadCompanyRoster(admin, companyId),
      ]);
      for (const e of [jobError, reqError, vehError, linkError]) {
        if (e) return { error: e.message };
      }
      if (rosterError) return { error: rosterError };

      return buildScheduleWindow({
        from,
        days,
        jobs: jobData || [],
        reqs: reqData || [],
        vehs: vehData || [],
        jobTrailers: linkData || [],
        users: roster,
      });
    }
    case "get_job_costing": {
      // Two permissions, because they protect different numbers. reports_view
      // opens the costing page at all; jobs_revenue is what lets someone see
      // what a job SOLD for, which is deliberately separate from material cost
      // (see PERM_DEFS' note on jobs_revenue). Without it, cost and variance
      // are returned and every revenue-derived field is withheld — not zeroed,
      // because a margin of 0 reads as a disaster rather than as unknown.
      if (!perms.reports_view) {
        return { error: "This user does not have permission to view reports." };
      }
      if (!perms.inv_pricing_view && !perms.jobs_revenue) {
        return {
          error: "This user does not have permission to view job costs or pricing.",
        };
      }
      const { data, error } = await admin
        .from("jobs")
        .select("po, title, name, addr, status, materials, items, contract_value")
        .eq("company_id", companyId)
        .limit(500);
      if (error) return { error: error.message };

      let jobs = data || [];
      if (input.status) jobs = jobs.filter((j) => j.status === input.status);
      if (input.query) {
        const needle = String(input.query).toLowerCase();
        jobs = jobs.filter(
          (j) =>
            (j.po || "").toLowerCase().includes(needle) ||
            (j.title || j.name || "").toLowerCase().includes(needle) ||
            (j.addr || "").toLowerCase().includes(needle),
        );
      }

      const showRevenue = !!perms.jobs_revenue;
      const priced = [];
      const rows = jobs.map((j) => {
        const cost = actualMaterialCost(j);
        const planned = plannedMaterialCost(j);
        const revenue = showRevenue ? contractValue(j) : null;
        if (showRevenue && revenue !== null) priced.push({ revenue, cost });
        return {
          po: j.po,
          name: j.title || j.name,
          status: j.status,
          material_cost_actual: round2(cost),
          material_cost_planned: round2(planned),
          // Isolates quantity variance from price movement, since both sides
          // are costed at the same priceAtPull. Null when there was no plan to
          // compare against — 0 would read as "exactly on plan".
          materials_variance_pct: planned > 0 ? round2(((cost - planned) / planned) * 100) : null,
          contract_value: revenue,
          gross_profit_on_materials: revenue === null ? null : round2(revenue - cost),
          gross_margin_pct: revenue === null ? null : round2(((revenue - cost) / revenue) * 100),
        };
      });

      if (input.worst_first) {
        // Unpriced jobs sort last rather than first: "no margin recorded" is
        // not the worst margin.
        rows.sort((a, b) => {
          if (a.gross_margin_pct === null) return 1;
          if (b.gross_margin_pct === null) return -1;
          return a.gross_margin_pct - b.gross_margin_pct;
        });
      }

      const revenueTotal = priced.reduce((s, p) => s + p.revenue, 0);
      const costOfPriced = priced.reduce((s, p) => s + p.cost, 0);

      return {
        // Said in the payload, not just in the system prompt, because this is
        // the one caveat that turns a useful number into a misleading one.
        caveat:
          "Material cost only. Labour, overhead, subcontractors and disposal are not tracked in this system, so these margins overstate real profit by the largest cost line in roofing. Say so when quoting them.",
        jobs: rows.slice(0, 25),
        totals: {
          jobs: rows.length,
          // Jobs with no contract value are counted separately rather than
          // folded in at zero — a portfolio margin over unknown revenue is not
          // a conservative estimate, it is a wrong one.
          priced: showRevenue ? priced.length : null,
          unpriced: showRevenue ? rows.length - priced.length : null,
          material_cost_all_jobs: round2(rows.reduce((s, r) => s + r.material_cost_actual, 0)),
          revenue_of_priced: showRevenue ? round2(revenueTotal) : null,
          gross_margin_pct_of_priced:
            showRevenue && revenueTotal > 0
              ? round2(((revenueTotal - costOfPriced) / revenueTotal) * 100)
              : null,
        },
        // Present only when revenue was actually held back, so the model says
        // "I can't see contract values" rather than reporting a margin of
        // null as if the office had forgotten to enter one.
        ...(showRevenue ? {} : { revenue_withheld: true }),
      };
    }
    case "get_training_status": {
      // Everyone may ask about their OWN training; seeing anybody else's needs
      // users_manage, same as the roster page.
      const [
        { data: assignData, error: assignError },
        { data: mediaData, error: mediaError },
        { roster, error: rosterError },
      ] = await Promise.all([
        admin
          .from("training_assignments")
          .select("id, media_id, user_id, due_on, completed_at")
          .eq("company_id", companyId)
          .limit(1000),
        admin.from("training_media").select("id, title").limit(500),
        loadCompanyRoster(admin, companyId),
      ]);
      for (const e of [assignError, mediaError]) if (e) return { error: e.message };
      if (rosterError) return { error: rosterError };

      const today = new Date().toISOString().slice(0, 10);
      const titleOf = (id) => (mediaData || []).find((m) => m.id === id)?.title || "Untitled";
      const personOf = (id) => roster.find((u) => String(u.userId) === String(id));
      const nameOf = (id) => personOf(id)?.name || "Unknown";

      let rows = (assignData || []).filter((a) => !a.completed_at);
      if (!perms.users_manage) {
        rows = rows.filter((a) => String(a.user_id) === String(caller.userId));
      }
      if (input.person) {
        const needle = String(input.person).toLowerCase();
        rows = rows.filter((a) => {
          const u = personOf(a.user_id);
          return (
            (u?.name || "").toLowerCase().includes(needle) ||
            (u?.email || "").toLowerCase().includes(needle)
          );
        });
      }
      const withState = rows.map((a) => ({
        person: nameOf(a.user_id),
        item: titleOf(a.media_id),
        due_on: a.due_on || null,
        // An assignment with no deadline is outstanding, not overdue. Treating
        // a missing date as overdue would brand every open-ended assignment a
        // compliance failure.
        state: !a.due_on ? "no_deadline" : a.due_on < today ? "overdue" : "upcoming",
      }));
      const filtered = input.overdue_only
        ? withState.filter((a) => a.state === "overdue")
        : withState;

      return {
        scope: perms.users_manage ? "whole company" : "this user only",
        outstanding: filtered.length,
        overdue: withState.filter((a) => a.state === "overdue").length,
        assignments: filtered
          .sort((a, b) => String(a.due_on || "9999").localeCompare(String(b.due_on || "9999")))
          .slice(0, 30),
      };
    }
    case "get_my_briefing": {
      // Deliberately the same builder the morning cron uses — if "what should I
      // look at" and the 8am message ever disagreed, one of them is wrong and
      // nobody would know which.
      const data = await loadBriefingData(admin, companyId);
      if (data.error) return { error: data.error };
      const briefing = buildBriefing({
        member: { userId: caller.userId, name: actorName },
        perms,
        ...data,
      });
      return briefing
        ? { sections: briefing.sections }
        : { sections: [], note: "Nothing needs attention today." };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * The per-day calendar A.N.V.I.L. reports, mirroring src/shared/utils/schedule.js's
 * buildSchedule — including the conflict it finds, which no single calendar in
 * the app can see on its own: a trailer out on a job the same day it is booked
 * into the shop (trailers live in Fleet, shop time lives in Maintenance).
 *
 * Exported so the test can pin the conflict detection without a database.
 */
export function buildScheduleWindow({ from, days, jobs, reqs, vehs, jobTrailers, users }) {
  const dayOf = (v) => (v ? String(v).split("T")[0] : null);
  const start = new Date(`${from}T00:00:00Z`);
  const keys = Array.from({ length: days }, (_, i) =>
    new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
  );
  const window = new Set(keys);
  // `users` is a loadCompanyRoster() result: { userId, name }.
  const nameOf = (id) => users.find((x) => String(x.userId) === String(id))?.name || null;
  const vehName = (id) => vehs.find((v) => String(v.id) === String(id))?.name || null;

  const buckets = new Map(
    keys.map((k) => [k, { day: k, jobs: [], maintenance: [], trailerIds: new Set() }]),
  );

  for (const j of jobs) {
    const key = dayOf(j.scheduledDate);
    // A job with no scheduled day is not guessed at — inferring one from its
    // creation date would invent history.
    if (!key || !window.has(key)) continue;
    const bucket = buckets.get(key);
    const trailerIds = jobTrailers.filter((t) => t.job_id === j.id).map((t) => t.trailer_id);
    trailerIds.forEach((id) => bucket.trailerIds.add(String(id)));
    bucket.jobs.push({
      po: j.po || null,
      name: j.title || j.name || j.po || "Untitled job",
      address: j.addr || null,
      status: j.status,
      supervisor: nameOf(j.assignedto),
      trailers: trailerIds.map(vehName).filter(Boolean),
    });
  }

  for (const r of reqs) {
    const key = dayOf(r.scheduled_date);
    if (!key || !window.has(key)) continue;
    buckets.get(key).maintenance.push({
      request_id: r.id,
      // Matched on vid, not vehicle_id: nothing in the app ever writes
      // vehicle_id, so matching on it silently found nothing (see the same
      // note in src/shared/utils/schedule.js).
      vehicle: vehName(r.vid) || r.vname || "Vehicle",
      vehicle_id: r.vid,
      issue: r.type || "Service",
      urgency: r.urgency,
      status: r.status,
    });
  }

  const dayRows = keys.map((k) => {
    const b = buckets.get(k);
    const conflicts = b.maintenance
      .filter((m) => m.status !== "completed" && b.trailerIds.has(String(m.vehicle_id)))
      .map((m) => m.vehicle);
    return {
      day: k,
      jobs: b.jobs,
      maintenance: b.maintenance,
      trailers_out: b.trailerIds.size,
      // A truck cannot be out on a job and in the shop the same day.
      conflicts,
    };
  });

  return {
    from,
    days,
    // Empty days are dropped from the payload: a week with two jobs in it
    // should not cost five lines of "nothing on".
    schedule: dayRows.filter((d) => d.jobs.length || d.maintenance.length || d.conflicts.length),
    totals: {
      jobs: dayRows.reduce((s, d) => s + d.jobs.length, 0),
      maintenance: dayRows.reduce((s, d) => s + d.maintenance.length, 0),
      conflicts: dayRows.reduce((s, d) => s + d.conflicts.length, 0),
    },
  };
}

// A request's `content` is whatever ChatWidget's toApiContent() produced: a
// bare string for a text-only turn, or an array of {type: "image"|"text", ...}
// blocks when a photo was attached. Either way, this is what gets persisted to
// chat_messages.text — image bytes never get a row of their own (see
// supabase/41's "WHY THE BROWSER CAN READ BUT NEVER WRITE" for the rest of
// that table's reasoning); a photo with no caption still needs SOME text so
// the row isn't empty and history reads sensibly.
export function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
    if (content.some((b) => b?.type === "image")) return "[Photo attached]";
  }
  return "";
}

// What the user currently has on screen, as one sentence for the prompt.
//
// This is what makes "when is this one due?" work from the Fleet page without
// anybody typing a unit number. Three deliberate limits:
//
//   1. It is a HINT, NOT A GRANT. The tool guards above are unchanged, so a
//      forged context buys a client nothing it could not already ask for in
//      words.
//   2. It is whitelisted and length-capped. Everything here lands in a system
//      prompt, and an unbounded client-supplied string in a system prompt is a
//      prompt-injection hole with extra steps.
//   3. It says the user is LOOKING at the record, never that they asked about
//      it. A model told "the user is asking about truck 011" will answer about
//      011 when they typed a question about the whole fleet.
const VIEW_LABELS = {
  dashboard: "the Dashboard",
  buildjobs: "Build Jobs",
  pull: "Pull Inventory",
  inventory: "Inventory",
  fleet: "Fleet",
  requests: "Maintenance Requests",
  schedule: "the Schedule",
  reports: "Reports",
  training: "Training",
  users: "the user roster",
  logs: "the audit log",
  settings: "Settings",
  profile: "their own profile",
};

export function describeContext(context) {
  if (!context || typeof context !== "object") return "";
  const label = VIEW_LABELS[context.view];
  if (!label) return "";
  const record =
    typeof context.record === "string"
      ? context.record.slice(0, 80).replace(/\s+/g, " ").trim()
      : "";
  return record
    ? `The user is looking at the ${label} page, with "${record}" open. If they say "this" or "it" without naming anything, they most likely mean that record — but answer what they actually asked.`
    : `The user is looking at the ${label} page.`;
}

/**
 * Writes one exchange into the user's conversation — see supabase/41.
 *
 * Only the NEWEST incoming user message gets a row plus the reply; everything
 * before it was already persisted the moment IT was the newest turn, on a
 * prior call. Pass `incoming: null` for a reply with no user turn behind it,
 * which is what a Confirm press is.
 *
 * Best effort throughout: a failure here must not take down a reply the user
 * already has, or make a committed write look like it failed.
 */
async function persistTurn(admin, { caller, sessionId, reply, incoming, photoUrl }) {
  try {
    const rows = [];
    if (incoming?.role === "user") {
      const url = typeof photoUrl === "string" && photoUrl.startsWith("https://") ? photoUrl : null;
      rows.push({
        company_id: caller.companyId,
        user_id: caller.userId,
        role: "user",
        // The placeholder is still the fallback, because the photo may have
        // failed to reach storage (ChatWidget sends the question anyway —
        // supabase/55) and a turn with neither text nor a URL would otherwise
        // persist as an empty bubble.
        text: extractText(incoming.content) || (url ? "" : "[Photo attached]"),
        photo_url: url,
        origin_session_id: sessionId || null,
      });
    }
    rows.push({
      company_id: caller.companyId,
      user_id: caller.userId,
      role: "assistant",
      text: reply,
      origin_session_id: sessionId || null,
    });
    const { data: inserted, error } = await admin
      .from("chat_messages")
      .insert(rows)
      .select("id, role");
    if (error) {
      console.error("chat: failed to persist conversation turn:", error.message);
      return { userMessageId: null, assistantMessageId: null };
    }
    return {
      userMessageId: inserted.find((r) => r.role === "user")?.id || null,
      assistantMessageId: inserted.find((r) => r.role === "assistant")?.id || null,
    };
  } catch (err) {
    console.error("chat: failed to persist conversation turn:", err.message);
    return { userMessageId: null, assistantMessageId: null };
  }
}

const rawHandler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin || "";
  const corsHeaders = getCorsHeaders(requestOrigin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { accessToken, messages, sessionId, context, confirmAction, photoUrl } = body;
  // A confirm request carries no new user turn — just the signed action the
  // widget is handing back — so `messages` is only required for a normal chat
  // request.
  if (!accessToken || (!confirmAction && (!Array.isArray(messages) || messages.length === 0))) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing accessToken or messages" }),
    };
  }

  try {
    // Service-role client: RLS is bypassed intentionally, because permission
    // enforcement happens explicitly below per verified user. Tenant isolation is
    // NOT free here — it comes from passing caller.companyId into every tool query.
    const admin = adminClient();

    const { caller, error: callerError } = await resolveCaller(admin, accessToken);
    if (callerError) {
      return {
        statusCode: callerError.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: callerError.message }),
      };
    }

    // Keyed by the verified user, not IP — this is authenticated, and the thing
    // worth capping is per-account Anthropic API cost, not anonymous abuse.
    // 20 messages/min is generous for a person typing, cheap insurance against a
    // compromised session or a runaway integration scripting the chat endpoint.
    const rl = checkRateLimit(`chat:${caller.userId}`, { max: 20, windowMs: 60 * 1000 });
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterSeconds, corsHeaders);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, name")
      .eq("id", caller.userId)
      .single();

    const perms = await getEffectivePerms(admin, caller.userId, caller.companyId, caller.role);
    const actorName = profile?.full_name || profile?.name || caller.email || "a user";

    // ── The confirm path ───────────────────────────────────────────────────
    //
    // Pressing Confirm does NOT go back to the model. It commits the exact
    // action that was previewed and reports the outcome in A.N.V.I.L.'s own words.
    // Letting the model narrate the result would invite it to summarize a
    // write — and a write whose summary drifts from what landed is worse than
    // no summary at all.
    if (confirmAction) {
      const verdict = verifyAction(confirmAction, {
        userId: caller.userId,
        companyId: caller.companyId,
      });
      if (!verdict.ok) {
        return {
          statusCode: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ error: verdict.error }),
        };
      }

      const outcome = await executeAction(admin, {
        perms,
        caller,
        actorName,
        tool: confirmAction.tool,
        input: confirmAction.input,
      });
      if (outcome.error) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ reply: outcome.error, applied: false }),
        };
      }

      // The audit trail is written by THIS function, not the browser: a write
      // made on the user's behalf has to leave the same evidence as one they
      // clicked, and the browser is not in the loop to log it. Best effort —
      // a logging failure must not make a committed write look like it failed.
      try {
        await admin.from("audit_logs").insert([
          {
            company_id: caller.companyId,
            user_id: caller.userId,
            user_email: caller.email || null,
            action_type: outcome.audit.action_type,
            description: outcome.audit.description,
            metadata: { ...outcome.audit.metadata, active_view: "anvil", actor: actorName },
            created_at: new Date().toISOString(),
          },
        ]);
      } catch (auditErr) {
        console.error("chat: failed to audit an A.N.V.I.L. action:", auditErr.message);
      }

      const confirmRow = await persistTurn(admin, {
        caller,
        sessionId,
        reply: outcome.message,
        incoming: null,
      });
      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          reply: outcome.message,
          applied: true,
          assistantMessageId: confirmRow.assistantMessageId,
        }),
      };
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const contextLine = describeContext(context);

    let workingMessages = messages.slice(-20); // cap history sent per request
    let finalText = "";
    // The one write the model asked for this turn, waiting on a human. Only
    // ever one: see the comment at its assignment below.
    let pendingAction = null;

    for (let i = 0; i < 5; i++) {
      const response = await anthropic.messages.create({
        model: "claude-haiku-5-5",
        // Thinking is adaptive and ON by default on this model, and it draws
        // from the SAME budget as the answer. The old 1024 was sized for a
        // model that did not think at all; left there, a ranked maintenance
        // list or a relayed briefing gets cut off mid-sentence. Raise this
        // before lowering `effort` — a truncated answer is a bug, slow
        // thinking is only a cost.
        max_tokens: 16000,
        // Two blocks, not one string: see STATIC_SYSTEM. The breakpoint goes
        // on the frozen half, so the cache covers `tools` + these
        // instructions and stops short of anything caller-specific.
        system: [
          { type: "text", text: STATIC_SYSTEM, cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text: callerSystemBlock({
              companyName: caller.companyName,
              actorName,
              role: caller.role,
              contextLine,
            }),
          },
        ],
        tools: TOOLS,
        messages: workingMessages,
      });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      workingMessages = [...workingMessages, { role: "assistant", content: response.content }];
      const toolResults = await Promise.all(
        toolUses.map(async (toolUse) => {
          const input = toolUse.input || {};
          const result = ACTION_NAMES.has(toolUse.name)
            ? await previewAction(admin, { perms, caller, tool: toolUse.name, input })
            : await executeTool(admin, perms, caller, actorName, toolUse.name, input);

          // The FIRST valid preview wins and any later one in the same turn is
          // dropped. One Confirm button can only mean one thing, and a model
          // that batched "file a request and log the mileage" into one turn
          // would otherwise get a button that silently commits whichever
          // action happened to be last.
          if (result?.requires_confirmation && !pendingAction) {
            pendingAction = { summary: result.summary, ...result.action };
          }
          return {
            type: "tool_result",
            tool_use_id: toolUse.id,
            // The signature never goes to the model — it has no use for it and
            // a token in the transcript is a token that can be echoed back into
            // one. The widget gets it out-of-band, on the response below.
            content: JSON.stringify(
              result?.requires_confirmation
                ? { requires_confirmation: true, summary: result.summary }
                : result,
            ),
          };
        }),
      );
      workingMessages = [...workingMessages, { role: "user", content: toolResults }];
    }

    const replyText = finalText || "I wasn't able to find an answer to that.";

    const { userMessageId, assistantMessageId } = await persistTurn(admin, {
      caller,
      sessionId,
      reply: replyText,
      incoming: messages[messages.length - 1],
      // Where the attached photo landed in storage, if the client got it
      // there. The model still reads the base64 off the message itself; this
      // is only so the turn can be replayed after a reload (supabase/55).
      photoUrl,
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      // pendingAction is omitted entirely when there isn't one, so the widget's
      // confirm bar is driven by presence rather than by a truthiness check on
      // a half-populated object.
      body: JSON.stringify({
        reply: replyText,
        userMessageId,
        assistantMessageId,
        ...(pendingAction ? { pendingAction } : {}),
      }),
    };
  } catch (err) {
    console.error("Chat function error:", err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message }) };
  }
};

export const handler = withSentry("chat", rawHandler);
