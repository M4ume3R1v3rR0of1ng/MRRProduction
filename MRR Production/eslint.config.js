// Flat config (ESLint 9+). Three environments live in this repo and each gets
// its own globals: browser code under src/, Node-run Netlify functions +
// build/verify scripts, and Vitest test files (which import their globals
// explicitly, so no extra env is needed there beyond Node).
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    // Everything not actually part of this app's source: build output, native
    // shell, vendored/generated dirs, and Claude Code's own tooling (.claude
    // ships its own scripts with their own conventions — not ours to lint).
    ignores: [
      "dist/**",
      "dev-dist/**",
      "node_modules/**",
      "ios/**",
      "public/**",
      "supabase/**",
      ".claude/**",
      ".netlify/**",
      ".github/**",
    ],
  },

  js.configs.recommended,

  // Browser app code (React).
  {
    files: ["src/**/*.{js,jsx}"],
    ignores: ["src/**/*.test.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules, // new JSX transform: no `React` import needed
      // Hand-picked rather than reactHooks.configs.recommended: that config bundles
      // the full React Compiler rule set (immutability, purity, refs, etc.), which
      // assumes code written for the compiler. This is plain React 18 with no
      // compiler in the build, so only the two rules meaningful without it apply.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "react/prop-types": "off", // plain JS/JSX codebase, no prop-types in use
      // Raw apostrophes/quotes in JSX text ("don't", "you're") are everywhere in
      // this app's copy and render fine unescaped — not worth flagging.
      "react/no-unescaped-entities": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Node-run code: Netlify functions, build/verify scripts, config files.
  {
    files: [
      "netlify/**/*.js",
      "scripts/**/*.mjs",
      "scripts/**/*.js",
      "*.config.js",
      "src/test/setup.js",
    ],
    ignores: ["netlify/**/*.test.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // `try { best-effort cleanup } catch {}` is a deliberate, commented pattern
      // in these scripts (e.g. scripts/verify-tenant-isolation.mjs) — not a bug.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // Tests (Node + Vitest, both src/ and netlify/): globals come from explicit
  // `import { describe, it, expect } from 'vitest'`, so only Node env is added.
  {
    files: ["src/**/*.test.js", "netlify/**/*.test.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Turns off ESLint stylistic rules that would fight Prettier. Must stay last.
  prettierConfig,
];
