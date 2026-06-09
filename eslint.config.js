import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// Flat config for a Vite + React 18 + TypeScript app.
// Pragmatic by design: error on real bugs, warn on hooks-deps, stay quiet on
// stylistic noise Prettier already owns.
export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },

  // --- TypeScript / TSX source ---
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Rules of Hooks is non-negotiable; deps drift is advisory. Scoped to
      // exactly these two — react-hooks v7's `recommended-latest` also enables
      // the new compiler-lint rules (refs, preserve-caught-error, …), which
      // flag intentional, in-browser-verified patterns here as hard errors.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Fast-refresh boundary hygiene (Vite HMR).
      ...reactRefresh.configs.vite.rules,

      // Unused vars: lean on tsconfig's noUnusedLocals/Parameters for the hard
      // error; here, allow intentional `_`-prefixed throwaways without noise.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // New in ESLint 10 core-recommended; clashes with deliberate sentinel
      // re-throws (e.g. picker-abort -> throw new Error("cancelled")). Off — not
      // a real bug, and chaining `cause` there carries no signal.
      "preserve-caught-error": "off",

      // Working app, not a zero-warning museum: keep escape hatches usable.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description", "ts-ignore": true },
      ],
    },
  },

  // --- Test files: relax a few rules that fight common test ergonomics ---
  {
    files: ["src/**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // --- Config files run in Node ---
  {
    files: ["*.{js,ts}", "vite.config.ts", "vitest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  }
);
