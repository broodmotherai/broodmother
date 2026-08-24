// Proprium kept this split across a root `eslint.config.base.mjs` and one file
// per app. There is one app here, so the base is inlined.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export const ignores = ["**/node_modules/**", "**/.next/**", "**/out/**", "**/dist/**", "**/*.tsbuildinfo"];

export default defineConfig([
  globalIgnores(ignores),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  ...nextTs,
  eslintConfigPrettier,
]);
