import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ship updates silently — a web app should always run the latest version
      // without asking the user to "reload to update".
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'steadwerk-icon.svg'],
      manifest: {
        name: 'Steadwerk',
        short_name: 'Steadwerk',
        description: 'Warehouse & fleet software — tools that work as hard as you do.',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#23282D',
        background_color: '#23282D',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell so the portal opens offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // jsPDF and its dependencies are ~800KB raw. They are dynamically imported
        // and only ever load for a company that has AccuLynx report upload switched
        // on, so precaching them would make every crew on a job-site connection pay
        // for a PDF engine they never open. They still cache normally once fetched.
        globIgnores: ['**/pdf-vendor-*.js'],
        cleanupOutdatedCaches: true,
        // SPA: serve index.html for offline navigations, but never for Netlify
        // functions — those must hit the network.
        navigateFallback: 'index.html',
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
        type: 'module',
      },
    }),
  ],
  // jsPDF is reached only through a dynamic import(), so Vite's scanner does not
  // see it at server start. The first report upload then triggers dep discovery
  // and a re-optimize, which drops the in-flight request — surfacing as
  // "Failed to fetch dynamically imported module: .../jobReportPdf.js" and losing
  // that upload. Pre-bundling them at boot means the first import already resolves.
  optimizeDeps: {
    include: ['jspdf', 'jspdf-autotable'],
  },
  build: {
    rollupOptions: {
      output: {
        // Corral the PDF engine into predictably-named chunks so the service worker
        // can exclude them from the precache by name (see globIgnores above).
        // html2canvas/dompurify are optional jsPDF deps used only by its .html()
        // renderer, which this app never calls — they get emitted, never fetched.
        manualChunks(id) {
          // Kept OUT of the main pdf-vendor chunk on purpose: jsPDF imports these
          // two lazily and only from its .html() renderer, which this app never
          // calls. In their own chunk they are emitted but never fetched; folded in
          // with jsPDF they would add ~230KB to every report upload.
          if (/node_modules[\\/](html2canvas|dompurify)/.test(id)) return 'pdf-vendor-html';
          if (/node_modules[\\/](jspdf|jspdf-autotable|core-js)/.test(id)) return 'pdf-vendor';

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
          if (/node_modules[\\/](@supabase[\\/]|iceberg-js)/.test(id)) return 'supabase-vendor';
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
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
    environment: 'node',
    // Netlify functions are covered too. The AccuLynx expense-notes cap is exactly
    // the fiddly boundary arithmetic that belongs under test, and it lives in
    // netlify/functions/_shared rather than src.
    include: ['src/**/*.test.js', 'netlify/**/*.test.js'],
  },
});
