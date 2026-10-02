import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { prerenderPublicPages } from "./scripts/prerender-public.mjs";

// Writes per-route HTML for the public pages and a real 404 page after the web
// build; see scripts/prerender-public.mjs. A plugin rather than a step in the npm
// script so it runs whatever build command Netlify's UI is set to. Skipped for
// the iOS build, which must never ship the landing page (it shows prices).
let resolvedConfig;
const prerender = {
  name: "prerender-public-pages",
  apply: (_config, env) => env.command === "build" && env.mode !== "ios",
  configResolved(config) {
    resolvedConfig = config;
  },
  async closeBundle() {
    const { root, build } = resolvedConfig;
    await prerenderPublicPages(root, resolve(root, build.outDir));
  },
};

// Named chunks for build.rollupOptions.output.codeSplitting below.
function chunkName(id) {
  // Kept OUT of the main pdf-vendor chunk on purpose: jsPDF imports these
  // lazily and only from its .html() and addSvgAsImage() renderers, which this
  // app never calls. In their own chunk they are emitted but never fetched;
  // folded in with jsPDF they would add ~340KB to every report upload.
  // canvg's own dependencies are listed because with includeDependenciesRecursively
  // off (see codeSplitting below) they aren't pulled in automatically.
  if (
    /node_modules[\\/](html2canvas|dompurify|canvg|raf|performance-now|rgbcolor|svg-pathdata|stackblur-canvas)[\\/]/.test(
      id,
    )
  )
    return "pdf-vendor-html";
  // jsPDF plus its runtime dependencies, named explicitly for the same reason.
  if (
    /node_modules[\\/](jspdf|jspdf-autotable|core-js|@babel[\\/]runtime|fflate|fast-png|iobuffer|pako)[\\/]/.test(
      id,
    )
  )
    return "pdf-vendor";

  // Every view is already lazy, so what was left in the entry chunk was
  // almost entirely two dependencies that never change between deploys:
  // the Supabase client (~690KB raw, auth-js alone is half of it) and
  // React. Folded into the entry they were re-downloaded in full on every
  // release, because the entry hash changes whenever any app code does.
  //
  // Split out, they keep their hash across deploys and stay in cache. Both
  // are still static imports fetched on first paint, so this trades no
  // startup latency for it — Vite emits modulepreload for both.
  //
  // iceberg-js is here because it arrives as a dependency of
  // @supabase/storage-js, not on its own.
  if (/node_modules[\\/](@supabase[\\/]|iceberg-js)/.test(id)) return "supabase-vendor";
  // react-router-dom (and its react-router dependency) is imported at the
  // very top of App.jsx/main.jsx, same as React itself — grouped with
  // react-vendor for the same reason: it changes on its own release
  // schedule, not on every app deploy.
  if (/node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
    return "react-vendor";
  return null;
}

export default defineConfig({
  // '@' -> src/, so a moved file's imports don't need recalculating relative
  // depth every time it changes folders. Vitest's `test` block below shares
  // this same defineConfig call, so it inherits the alias automatically.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    prerender,
    VitePWA({
      // Ship updates silently — a web app should always run the latest version
      // without asking the user to "reload to update".
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "steadwerk-icon.svg"],
      manifest: {
        name: "Steadwerk",
        short_name: "Steadwerk",
        description: "Warehouse & fleet software — tools that work as hard as you do.",
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#23282D",
        background_color: "#23282D",
        categories: ["business", "productivity"],
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell so the portal opens offline.
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        // jsPDF and its dependencies are ~800KB raw. They are dynamically imported
        // and only ever load for a company that has AccuLynx report upload switched
        // on, so precaching them would make every crew on a job-site connection pay
        // for a PDF engine they never open. They still cache normally once fetched.
        // og-image.png is only ever fetched by link-preview scrapers, never by the app.
        // The prerendered pages are only for crawlers and first visits; offline,
        // navigateFallback serves index.html for every route anyway.
        globIgnores: [
          "**/pdf-vendor-*.js",
          "og-image.png",
          "{app,404,terms,privacy,training}.html",
        ],
        cleanupOutdatedCaches: true,
        // SPA: serve index.html for offline navigations, but never for Netlify
        // functions — those must hit the network.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/\.netlify\//],
        // Deliberately NO runtime caching of Supabase responses: stale inventory,
        // job, or cost data would be worse than an honest offline error. The shell
        // loads offline, and that is the whole of the offline story — there is no
        // write queue behind it. Every write goes straight to Supabase and fails
        // visibly without a connection, which is what the SyncIndicator warns about.
      },
      devOptions: {
        // Keep the service worker OFF during `npm run dev` so it can't cache stale
        // content and confuse the dev workflow. Test the installable PWA against a
        // real build instead: `npm run build && npm run preview` (or the deployed
        // site). Flip to true only if you specifically want to debug the SW in dev.
        enabled: false,
        type: "module",
      },
    }),
    // Uploads source maps so Sentry can show real (unminified) stack traces on
    // client-side issues instead of pointing at bundled/mangled code — see
    // src/shared/utils/sentry.js for the client SDK setup this feeds.
    //
    // Gated on SENTRY_AUTH_TOKEN existing so a machine without it (any local dev
    // box that hasn't set one) gets a plain build with no upload attempt, rather
    // than a plugin instance that immediately errors for missing auth. Only
    // Netlify's build environment needs this var set — see .env.example.
    //
    // Must come after the other plugins in this array (Sentry's own guidance):
    // it needs to see the fully bundled output, which is only final once
    // vite-plugin-pwa and the rest have already run.
    process.env.SENTRY_AUTH_TOKEN &&
      sentryVitePlugin({
        org: "steadwerk",
        project: "steadwerk-web",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
          // The plugin uploads maps straight from dist/ before Netlify publishes
          // it, then this deletes the local copies — so the maps that de-anonymize
          // every stack trace back to real source never end up served publicly at
          // <chunk>.js.map. `sourcemap: 'hidden'` below already keeps the shipped
          // JS from linking to them; this is the belt to that suspenders.
          filesToDeleteAfterUpload: ["./dist/**/*.map"],
        },
      }),
  ],
  // jsPDF is reached only through a dynamic import(), so Vite's scanner does not
  // see it at server start. The first report upload then triggers dep discovery
  // and a re-optimize, which drops the in-flight request — surfacing as
  // "Failed to fetch dynamically imported module: .../jobReportPdf.js" and losing
  // that upload. Pre-bundling them at boot means the first import already resolves.
  optimizeDeps: {
    include: ["jspdf", "jspdf-autotable"],
  },
  build: {
    // Only generate maps at all when the Sentry plugin above is actually going
    // to run and upload+delete them — see filesToDeleteAfterUpload there. Tying
    // generation to the same SENTRY_AUTH_TOKEN check means a build with no token
    // (any local machine that hasn't set one) never writes a .map file into
    // dist/ in the first place, so there's nothing that could accidentally ship
    // to Netlify's publish output if that cleanup step were ever skipped or
    // failed partway through.
    //
    // 'hidden' (used only when a token IS present): maps are generated so
    // Sentry has something to upload, but the shipped JS carries no
    // `//# sourceMappingURL` comment pointing at them — a visitor's devtools
    // "Sources" tab still shows minified code, not your original source. Two
    // independent layers, not one: this keeps the JS from linking to the maps,
    // filesToDeleteAfterUpload keeps the maps from existing in dist/ at all.
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? "hidden" : false,
    rollupOptions: {
      output: {
        // Corral the PDF engine into predictably-named chunks so the service worker
        // can exclude them from the precache by name (see globIgnores above).
        // html2canvas/dompurify are optional jsPDF deps used only by its .html()
        // renderer, which this app never calls — they get emitted, never fetched.
        //
        // includeDependenciesRecursively: false is load-bearing. Rolldown's default
        // pulls every dependency of a matched module into its group, and jsPDF
        // depends on Vite's __vitePreload helper (for its lazy html2canvas import),
        // so the helper was swallowed into pdf-vendor. Every lazy() view import in
        // the entry calls that helper, so the entry imported pdf-vendor statically
        // and every landing-page visitor downloaded ~470KB of PDF engine up front.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [{ name: chunkName }],
        },
      },
    },
  },
  server: {
    // Pin the dev port so Netlify Dev (8888) always proxies to the right place.
    // Without strictPort, a stale Vite squatting 5173 pushes this one to 5174 while
    // Netlify keeps proxying to 5173 — the "Could not proxy request" 500. strictPort
    // makes a port clash fail loudly instead.
    port: 5173,
    strictPort: true,
    // Point the HMR WebSocket straight at Vite (5173) instead of letting the
    // browser open it against the page origin (8888). Netlify Dev's proxy mangles
    // WS frames ("reserved bits are on: reserved1 = 1") and HMR dies; connecting
    // directly to Vite bypasses the proxy. Harmless in plain `dev:ui-only` too
    // (page is already on 5173).
    hmr: { clientPort: 5173 },
    // Do NOT watch Netlify Dev's generated output. Netlify constantly rewrites
    // .netlify/functions-serve/** while running; Vite's watcher then hits
    // "EBUSY: resource busy or locked" on Windows/OneDrive and the whole dev
    // server crashes. Ignoring these dirs is what stops the repeated crashing.
    watch: { ignored: ["**/.netlify/**", "**/dist/**"] },
  },
  test: {
    // Node, not jsdom: these suites cover the money and permission logic, which is
    // pure. The one place that touches a browser global (pdfGenerator calls
    // window.open) stubs it itself, so jsdom would cost startup time and buy nothing.
    //
    // The exception is a component test that has to click something. Those are
    // .test.jsx files that opt in per file with `// @vitest-environment jsdom`, so
    // the node suites never pay jsdom's startup. See src/test/permissionMatrix.test.jsx.
    environment: "node",
    // Stubs the Supabase env vars before any module is imported. Without it the
    // nine suites that reach utils/supabase.js throw on import, and they only
    // ever passed locally because Vite was loading the gitignored .env off disk.
    // See src/test/setup.js for the full story.
    setupFiles: ["./src/test/setup.js"],
    // Netlify functions are covered too. The AccuLynx expense-notes cap is exactly
    // the fiddly boundary arithmetic that belongs under test, and it lives in
    // netlify/functions/_shared rather than src.
    include: ["src/**/*.test.{js,jsx}", "netlify/**/*.test.js"],
  },
});
