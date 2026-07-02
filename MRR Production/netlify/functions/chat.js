// netlify/functions/chat.js
// Data-aware AI chat widget backend. Runs server-side only — the Anthropic
// API key never reaches the browser. Every tool call is gated by the calling
// user's *actual* effective permissions, re-derived here from their verified
// session token (never trusted from the client), mirroring the same
// role/override logic as src/database/permissions.js's getEffectivePerms.

const Anthropic = require("@anthropic-ai/sdk");
const { createClient } = require("@supabase/supabase-js");

const ALLOWED_ORIGINS = [
  "https://mrrproduction.netlify.app",
  "http://localhost:5173",
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
];

// Mirrors src/database/permissions.js getEffectivePerms() — keep in sync.
async function getEffectivePerms(admin, userId, role) {
  if (role === "admin") {
    return { jobs_view: true, inv_view: true, inv_pricing_view: true, fleet_view: true, maint_submit: true, maint_manage: true };
  }
  const [{ data: roleRow }, { data: overrideRow }] = await Promise.all([
    admin.from("role_permissions").select("permissions").eq("role", role).maybeSingle(),
    admin.from("user_permission_overrides").select("overrides").eq("user_id", userId).maybeSingle(),
  ]);
  return { ...(roleRow?.permissions || {}), ...(overrideRow?.overrides || {}) };
}

async function executeTool(admin, perms, name, input) {
  switch (name) {
    case "search_jobs": {
      let q = admin.from("jobs").select("po, title, name, addr, status, materials, items").limit(30);
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
      const { data, error } = await admin.from("inventory").select("*").limit(300);
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
      const { data, error } = await admin.from("vehicles").select("*").limit(200);
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
      let q = admin.from("maintenance_requests").select("*").limit(30);
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
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

exports.handler = async (event) => {
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
    const supabaseUrl = process.env.SUPABASE_URL;
    // Service-role client used for both verifying the caller's token and the
    // actual reads — RLS is bypassed intentionally because permission
    // enforcement happens explicitly below, per verified user.
    const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: "Not authenticated" }) };
    }
    const userId = authData.user.id;

    const { data: profile } = await admin.from("profiles").select("full_name, name, role, active").eq("id", userId).single();
    if (!profile || profile.active === false) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: "Account inactive" }) };
    }

    const perms = await getEffectivePerms(admin, userId, profile.role);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const systemPrompt = `You are the in-app assistant for Maumee River Roofing's warehouse & fleet management system, an internal tool for warehouse staff, site supervisors, and office managers.
You are talking to ${profile.full_name || profile.name || "a user"} (role: ${profile.role}).
Answer questions about jobs, inventory, fleet vehicles, and maintenance requests using the tools provided — never invent data.
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
          content: JSON.stringify(await executeTool(admin, perms, toolUse.name, toolUse.input || {})),
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
