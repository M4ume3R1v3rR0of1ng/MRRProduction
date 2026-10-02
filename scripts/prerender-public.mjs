// Gives each public page its own HTML file at build time, so a crawler or link
// unfurler that never runs JavaScript still gets that page's title, description,
// canonical URL and real body text, instead of the home page's for every path.
//
// Runs from the prerenderPublicPages plugin in vite.config.js, after the client
// bundle is written. Each page component is rendered to static markup in Node and
// dropped into the built index.html's <noscript>. Browsers with JS never show it;
// React still mounts into the empty #root exactly as before. Rendering the real
// components means this text can't drift from what visitors see.
//
// Output, all wired up in public/_redirects:
//   dist/index.html                    "/"  (landing page)
//   dist/{terms,privacy,training}.html  rewritten from /terms, /privacy, /training
//   dist/app.html                      every signed-in route and /login
//   dist/404.html                      anything else, served with a real 404
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
// Plain Node imports. The page modules import these same packages, and the dev
// server externalizes them for SSR, so both sides get one shared React instance.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const ORIGIN = "https://steadwerk.com";

// Titles and descriptions mirror each page's useDocumentMeta call, so the tab and
// the search result read the same before and after JS runs.
const PAGES = [
  {
    path: "/",
    file: "index.html",
    component: "LandingPage",
    title: "Steadwerk | Inventory & Fleet Software for Roofing Contractors",
    description:
      "Warehouse & fleet software for roofing and construction companies. Inventory, fleet, jobs, and scheduling in one place — $99/mo for 10 users.",
  },
  {
    path: "/terms",
    file: "terms.html",
    component: "TermsPage",
    title: "Terms & Conditions · Steadwerk",
    description: "Steadwerk's terms and conditions of service.",
  },
  {
    path: "/privacy",
    file: "privacy.html",
    component: "PrivacyPage",
    title: "Privacy Policy · Steadwerk",
    description: "How Steadwerk collects, uses, and protects your data.",
  },
  {
    path: "/training",
    file: "training.html",
    component: "TrainingPage",
    title: "Training · Steadwerk",
    description: "See Steadwerk's warehouse & fleet software in action.",
  },
];

// The pages' own calls to action are <button onClick>, which a crawler can't
// follow, so every prerendered page ends with plain links.
const LINKS = `<nav><p><a href="/login?signup">Start your 14-day free trial</a> · <a href="/login">Sign in</a> · <a href="/">Home</a> · <a href="/training">Training</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="mailto:help@steadwerk.com">help@steadwerk.com</a></p></nav>`;

const attr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// What a crawler needs is the text and its heading structure. Styles, decorative
// SVG and inline style attributes are most of the markup's weight and none of it.
function toCrawlerMarkup(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<\/?noscript>/g, "")
    .replace(/\s(style|class)="[^"]*"/g, "")
    .replace(/<button[^>]*>/g, "<span>")
    .replace(/<\/button>/g, "</span>");
}

function setHead(html, { path, title, description }) {
  const url = ORIGIN + path;
  const replace = (re, value) => {
    if (!re.test(html)) throw new Error(`prerender: index.html is missing ${re}`);
    html = html.replace(re, value);
  };
  replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(title)}</title>`);
  replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${attr(description)}$2`);
  replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${attr(description)}$2`);
  replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${attr(title)}$2`);
  // Safe here and only here: each of these files is served at exactly one URL.
  replace(
    /(<meta property="og:site_name"[^>]*>)/,
    `$1\n    <meta property="og:url" content="${url}" />\n    <link rel="canonical" href="${url}" />`,
  );
  return html;
}

const setNoscript = (html, body) => {
  if (!/<noscript>[\s\S]*?<\/noscript>/.test(html))
    throw new Error("prerender: index.html is missing its <noscript> block");
  return html.replace(
    /<noscript>[\s\S]*?<\/noscript>/,
    () => `<noscript><main>${body}</main></noscript>`,
  );
};

const NOT_FOUND = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>Page not found · Steadwerk</title>
    <link rel="icon" href="/steadwerk-icon.svg" type="image/svg+xml" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
        box-sizing: border-box; background: #23282D; color: #F4F1EA;
        font-family: Inter, system-ui, sans-serif; text-align: center; }
      h1 { font-size: 28px; margin: 24px 0 8px; }
      p { color: #B9B4AA; margin: 0 0 24px; }
      a { display: inline-block; background: #C97B2D; color: #23282D; font-weight: 600;
        padding: 12px 20px; border-radius: 6px; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <svg width="56" height="40" viewBox="96 144 320 224" aria-hidden="true"><path d="M112 160 L176 352 L256 192 L336 352 L400 160" fill="none" stroke="#C97B2D" stroke-width="40" stroke-linecap="square"/></svg>
      <h1>Page not found</h1>
      <p>There's nothing at this address.</p>
      <a href="/">Go to Steadwerk</a>
    </main>
  </body>
</html>
`;

export async function prerenderPublicPages(root, outDir) {
  const template = readFileSync(join(outDir, "index.html"), "utf8");

  // A bare server, not the project config: loading vite.config.js again from
  // inside its own build would re-register this plugin, the PWA plugin and Sentry.
  const vite = await createServer({
    root,
    configFile: false,
    plugins: [react()],
    resolve: { alias: { "@": join(root, "src") } },
    server: { middlewareMode: true, hmr: false, watch: null },
    // Only ever asked for four modules by path; scanning index.html for deps to
    // pre-bundle is wasted work and warns about the PWA virtual module.
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "error",
  });
  try {
    // Written before index.html is overwritten: the app shell keeps the generic
    // <noscript> copy and has no canonical, since it answers for many URLs.
    writeFileSync(join(outDir, "app.html"), template);

    for (const page of PAGES) {
      const { default: Page } = await vite.ssrLoadModule(`/src/public/${page.component}.jsx`);
      const markup = renderToStaticMarkup(
        createElement(MemoryRouter, { initialEntries: [page.path] }, createElement(Page, {})),
      );
      const html = setNoscript(setHead(template, page), toCrawlerMarkup(markup) + LINKS);
      writeFileSync(join(outDir, page.file), html);
    }
    writeFileSync(join(outDir, "404.html"), NOT_FOUND);
  } finally {
    await vite.close();
  }
}
