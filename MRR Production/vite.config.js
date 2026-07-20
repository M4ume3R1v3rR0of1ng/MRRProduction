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
        cleanupOutdatedCaches: true,
        // SPA: serve index.html for offline navigations, but never for Netlify
        // functions — those must hit the network.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/\.netlify\//],
        // Deliberately NO runtime caching of Supabase responses: stale inventory,
        // job, or cost data would be worse than an honest offline error. The shell
        // loads offline; live data follows the app's own online/offline handling.
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
    include: ['src/**/*.test.js'],
  },
});
