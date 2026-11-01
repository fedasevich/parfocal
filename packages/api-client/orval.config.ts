import { defineConfig } from "orval";

export default defineConfig({
  parfocal: {
    input: { target: "./openapi.json" },
    output: {
      target: "./src/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      mode: "single",
      mock: { generators: [{ type: "msw" }] },
      tsconfig: { compilerOptions: { allowImportingTsExtensions: true } },
      override: {
        mutator: { path: "./src/fetcher.ts", name: "apiFetch" },
      },
    },
  },
});
