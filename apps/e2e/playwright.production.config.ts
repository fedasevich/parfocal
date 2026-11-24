import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const webPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5194);
const apiPort = Number(process.env["PARFOCAL_E2E_API_PORT"] ?? webPort + 2000);
const persist = process.env["PARFOCAL_EDGE_PERSIST"] ?? `${root}.wrangler/main-paths`;
const tileKey = process.env["PARFOCAL_EDGE_TILE_KEY"] ?? "";

const edge = [
  "pnpm --filter @parfocal/edge exec wrangler dev --local",
  `--port ${webPort}`,
  `--inspector-port ${webPort + 3000}`,
  `--persist-to ${persist}`,
  "--show-interactive-dev-session=false",
  `--var API_ORIGIN:http://localhost:${apiPort}`,
  `--var TILE_TOKEN_KEY:${tileKey}`,
  `--var ROOM_TOKEN_KEY:${tileKey}`,
].join(" ");

export default defineConfig({
  ...base,
  testMatch: "main-paths.spec.ts",
  webServer: {
    command: edge,
    cwd: root,
    url: `http://localhost:${webPort}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
