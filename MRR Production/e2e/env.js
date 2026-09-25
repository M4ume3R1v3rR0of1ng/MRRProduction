// e2e/env.js
//
// Same env-resolution shape as scripts/verify-tenant-isolation.mjs: prefer
// whatever is already in process.env (how e2e.yml's CI job sets it, from
// GitHub secrets), and fall back to parsing a local .env for `npm run
// test:e2e` on a dev machine. Playwright's Node process never loads .env on
// its own the way Vite does for the app build.
import fs from "node:fs";

function readDotEnv() {
  if (!fs.existsSync(".env")) return {};
  return Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

export function loadSupabaseEnv() {
  const dotEnv = readDotEnv();
  const url = process.env.VITE_SUPABASE_URL || dotEnv.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || dotEnv.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || dotEnv.SUPABASE_SERVICE_ROLE_KEY;

  const missing = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(
    (name) =>
      !{
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_ANON_KEY: anonKey,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      }[name],
  );
  if (missing.length) {
    throw new Error(
      `e2e: missing ${missing.join(", ")}. Set them in the environment (CI) or .env (local).`,
    );
  }
  return { url, anonKey, serviceKey };
}
