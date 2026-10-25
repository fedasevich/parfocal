import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir, loadManifest } from "@parfocal/test-fixtures";
import type { Page } from "@playwright/test";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import {
  harnessGlobal,
  type VivBreakage,
  type VivHarness,
  type VivSceneRequest,
  type VivSceneResult,
} from "../harness/viv/protocol.ts";
import type { Frame } from "../src/frame.ts";
import { captureScreenshot } from "../src/playwright.ts";
import type { VivGoldenScene } from "./viv-scenes.ts";

export const harnessRoot = fileURLToPath(new URL("../harness/viv", import.meta.url));

const fixturePrefix = "/fixtures/";

export type FixtureAvailability =
  | { readonly status: "ready"; readonly path: string }
  | { readonly status: "missing"; readonly message: string; readonly required: boolean };

export function requiredFixtureGroups(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PARFOCAL_REQUIRE_FIXTURES ?? "")
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

export function fixtureAvailability(file: string): FixtureAvailability {
  const entry = loadManifest().remote.find((fixture) => fixture.file === file);
  if (entry === undefined) throw new Error(`${file} is not in fixtures.json`);
  const path = join(fixturesDir(), file);
  if (existsSync(`${path}.sha256`)) return { status: "ready", path };
  const required = entry.groups.some((group) => requiredFixtureGroups().includes(group));
  return {
    status: "missing",
    required,
    message: `${file} is not downloaded, run: pnpm fixtures ${entry.groups.join(" ")}`,
  };
}

function sendFixture(request: IncomingMessage, response: ServerResponse, path: string): void {
  const size = statSync(path).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (range === null) {
    response.writeHead(200, { "content-length": size, "accept-ranges": "bytes" });
    createReadStream(path).pipe(response);
    return;
  }
  const start = Number(range[1]);
  const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
  if (start >= size) {
    response.writeHead(416, { "content-range": `bytes */${size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${size}`,
    "accept-ranges": "bytes",
  });
  createReadStream(path, { start, end }).pipe(response);
}

function fixtureServer(): Plugin {
  const known = new Set(loadManifest().remote.map((fixture) => fixture.file));
  return {
    name: "parfocal-fixtures",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname);
        if (!pathname.startsWith(fixturePrefix)) {
          next();
          return;
        }
        const file = basename(pathname.slice(fixturePrefix.length));
        const path = join(fixturesDir(), file);
        if (!known.has(file) || !existsSync(path)) {
          response.writeHead(404);
          response.end();
          return;
        }
        sendFixture(request, response, path);
      });
    },
  };
}

export async function startVivHarness(): Promise<ViteDevServer> {
  const server = await createServer({
    root: harnessRoot,
    configFile: false,
    logLevel: "error",
    clearScreen: false,
    plugins: [fixtureServer()],
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  return server;
}

export function harnessUrl(server: ViteDevServer): string {
  const address = server.httpServer?.address() as AddressInfo | null | undefined;
  if (!address) throw new Error("The Viv harness server is not listening");
  return `http://127.0.0.1:${address.port}/`;
}

export function fixtureUrl(file: string): string {
  return `${fixturePrefix}${encodeURIComponent(file)}`;
}

export async function openHarness(page: Page, server: ViteDevServer): Promise<void> {
  await page.goto(harnessUrl(server));
  await page.waitForFunction((name) => name in globalThis, harnessGlobal, { timeout: 60_000 });
}

export async function renderVivScene(
  page: Page,
  request: VivSceneRequest,
): Promise<VivSceneResult> {
  return page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, VivHarness>)[name];
      if (harness === undefined) throw new Error("The Viv harness did not load");
      return harness.render(scene);
    },
    { name: harnessGlobal, scene: request },
  );
}

export async function renderVivFrame(
  page: Page,
  scene: VivGoldenScene,
  breakage: VivBreakage = "none",
): Promise<{ readonly result: VivSceneResult; readonly frame: Frame; readonly ms: number }> {
  const started = performance.now();
  const result = await renderVivScene(page, {
    url: fixtureUrl(scene.fixture),
    formatId: scene.formatId,
    view: scene.view,
    breakage,
    ...(scene.tissue === undefined ? {} : { tissue: scene.tissue }),
  });
  const ms = performance.now() - started;
  const frame = await captureScreenshot(page.locator("#viewer canvas"));
  return { result, frame, ms };
}
