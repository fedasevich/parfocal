import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "cs", "en-XA"],
  pseudoLocale: "en-XA",
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["<rootDir>/src"],
      exclude: ["**/fake-api/**", "**/*.gen.ts"],
    },
  ],
  format: formatter({ lineNumbers: false }),
});
