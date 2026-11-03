import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signCapability, signingKey } from "@parfocal/edge/capability";
import { expect, type Page, test } from "@playwright/test";
import { budget, exceeds } from "../../../scripts/perf-budgets.ts";
import { type LatencyProxy, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import { writeSpreadBigTiff } from "../test/pixel-source/spread-bigtiff.ts";
import { outDir } from "./global-setup.ts";
import type { OpenTiming } from "./page/same-origin-harness.ts";
import { type Gateway, startGateway } from "./tile-gateway.ts";

const rttMs = Number(process.env["SAME_ORIGIN_RTT_MS"] ?? 100);
const tenant = "11111111-1111-4111-8111-111111111111";
const tokenKey = btoa("same-origin-slide-bytes-test-key!");
const sidecarSamples = 3;
const reportPath = join(
  fileURLToPath(new URL("../test-results/same-origin", import.meta.url)),
  "report.json",
);

type Arm = "same-origin" | "cross-origin";

interface Measured {
  walk: number | null;
  sidecar: number[];
  preflights: number;
  reads: number;
}

const measured: Record<Arm, Measured> = {
  "same-origin": { walk: null, sidecar: [], preflights: 0, reads: 0 },
  "cross-origin": { walk: null, sidecar: [], preflights: 0, reads: 0 },
};

let folder = "";
let size = 0;
let appGateway: Gateway | null = null;
let otherGateway: Gateway | null = null;
let appProxy: LatencyProxy | null = null;
let otherProxy: LatencyProxy | null = null;
let opened = 0;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "same-origin-"));
  const written = await writeSpreadBigTiff({
    path: join(folder, "spread.tiff"),
    levels: 11,
    baseSize: 65536,
    tileSize: 256,
  });
  size = written.bytes;
  await writeFile(join(folder, "tile-index.json"), JSON.stringify(written.sidecar));
  appGateway = await startGateway({ tenant, slideDir: folder, appDir: outDir, tokenKey });
  appProxy = await startLatencyProxy({ target: appGateway.origin, rttMs });
  otherGateway = await startGateway({
    tenant,
    slideDir: folder,
    appDir: outDir,
    tokenKey,
    allowOrigin: new URL(appProxy.url).origin,
  });
  otherProxy = await startLatencyProxy({ target: otherGateway.origin, rttMs });
});

test.afterAll(async () => {
  mkdirSync(join(reportPath, ".."), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ rttMs, measured }, null, 2));
  await appProxy?.close();
  await otherProxy?.close();
  await appGateway?.close();
  await otherGateway?.close();
  await rm(folder, { recursive: true, force: true });
});

async function openHarness(page: Page): Promise<void> {
  await page.goto(`${appProxy?.url}/app/same-origin.html`);
  await page.waitForFunction(() => window.sameOriginHarness !== undefined);
}

async function signedOpen(page: Page, bytesOrigin: string, withIndex: boolean) {
  opened++;
  const slide = `slide-${opened}`;
  const token = await signCapability(
    {
      tenant,
      slide,
      original: "spread.tiff",
      size,
      restricted: [],
      expires: Math.floor(Date.now() / 1000) + 600,
    },
    await signingKey(tokenKey),
  );
  const directory = `${bytesOrigin}/tiles/${slide}/`;
  return page.evaluate((request): Promise<OpenTiming> => window.sameOriginHarness.open(request), {
    directory,
    token,
    withIndex,
  });
}

async function measure(page: Page, arm: Arm, bytesOrigin: string, gateway: Gateway) {
  await openHarness(page);
  const preflightsBefore = gateway.preflights.length;
  const readsBefore = gateway.reads.length;
  const walked = await signedOpen(page, bytesOrigin, false);
  const sidecar: OpenTiming[] = [];
  for (let sample = 0; sample < sidecarSamples; sample++) {
    sidecar.push(await signedOpen(page, bytesOrigin, true));
  }
  for (const timing of sidecar) expect(timing.levels).toBe(walked.levels);
  measured[arm] = {
    walk: Math.round(walked.ms),
    sidecar: sidecar.map((timing) => Math.round(timing.ms)),
    preflights: gateway.preflights.length - preflightsBefore,
    reads: gateway.reads.length - readsBefore,
  };
  console.log(`${arm}, ${rttMs} ms RTT: ${JSON.stringify(measured[arm])}`);
  return measured[arm];
}

test("bytes under the app origin carry the token with no preflight and open within the sidecar tile index budget", async ({
  page,
}) => {
  const result = await measure(page, "same-origin", appProxy?.url ?? "", appGateway as Gateway);
  expect(result.reads).toBeGreaterThan(0);
  expect(result.preflights).toBe(0);
  expect(result.walk ?? 0).toBeGreaterThan(Math.min(...result.sidecar));
  if (rttMs === 100) {
    const sidecarOpen = await budget("viewer.sidecar-open-ms");
    expect(exceeds(sidecarOpen, Math.min(...result.sidecar))).toBeNull();
  }
});

test("the same bytes on another origin pay a preflight for every file the token is sent to", async ({
  page,
}) => {
  const result = await measure(
    page,
    "cross-origin",
    otherProxy?.url ?? "",
    otherGateway as Gateway,
  );
  expect(result.reads).toBeGreaterThan(0);
  expect(result.preflights).toBeGreaterThanOrEqual(1 + 2 * sidecarSamples);
});
