import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { expect, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { type LatencyProxy, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import { type Served, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import type { LifecycleSlide, LifecycleState } from "./page/lifecycle-harness.ts";

const slideFile = "CMU-1.svs";
const loadRttMs = 100;
const hiddenBeforeLossMs = 500;
const lostMs = 500;
const hiddenAfterRestoreMs = 500;
const budgetMs = 1000;
const readsBeforeHiding = 3;
const reportDir = fileURLToPath(new URL("../test-results/hidden-tab-hardware", import.meta.url));
const chromeBinary =
  process.env["PARFOCAL_CHROME"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debugPort = Number(process.env["PARFOCAL_E2E_PORT"] ?? 5210) + 1;

const hardware = process.env["PARFOCAL_GPU"] === "hardware";
const availability = fixtureAvailability(slideFile);

test.describe.configure({ mode: "serial", timeout: 120_000 });

let served: Served | null = null;
let slow: LatencyProxy | null = null;

test.beforeAll(async () => {
  if (!hardware || availability.status !== "ready") return;
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
  slow = await startLatencyProxy({ target: served.origin, rttMs: loadRttMs });
});

test.afterAll(async () => {
  await slow?.close();
  await served?.close();
  slow = null;
  served = null;
});

test.beforeEach(() => {
  test.skip(!hardware, "Set PARFOCAL_GPU=hardware to run in headed Chrome on the real GPU");
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, (value: unknown) => void>();

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
      if (message.id !== undefined) this.pending.get(message.id)?.(message);
    });
  }

  static async open(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () => reject(new Error(`Cannot open ${url}`)));
    });
    return new Cdp(socket);
  }

  async send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = this.nextId++;
    const answer = new Promise<{ result?: T; error?: { message: string } }>((resolve) => {
      this.pending.set(id, resolve as (value: unknown) => void);
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    const message = await answer;
    this.pending.delete(id);
    if (message.error) throw new Error(`${method}: ${message.error.message}`);
    return message.result as T;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result: { value: T };
      exceptionDetails?: { exception?: { description?: string }; text: string };
    }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result.result.value;
  }

  close(): void {
    this.socket.close();
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  return (await response.json()) as T;
}

async function waitForChrome(): Promise<{ Browser: string; webSocketDebuggerUrl: string }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await getJson("/json/version");
    } catch {
      await pause(100);
    }
  }
  throw new Error("Chrome did not open its debugging port");
}

interface TargetEntry {
  readonly id: string;
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

function slideAt(proxy: LatencyProxy): LifecycleSlide {
  return {
    url: `${proxy.url}/cache/${slideFile}`,
    formatId: "aperio-svs",
    workers: 6,
    magnification: 10,
    sleepWhenIdle: true,
    ...cmu1TissueCentre,
  };
}

const canvasExpression = `(() => {
  const canvas = document.querySelector("#viewer canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("No viewer canvas");
  const gl = canvas.getContext("webgl2");
  const extension = gl && gl.getExtension("WEBGL_lose_context");
  if (!gl || !extension) throw new Error("No WEBGL_lose_context");
  return { gl, extension };
})()`;

const installMarks = `(() => {
  Reflect.deleteProperty(document, "visibilityState");
  Reflect.deleteProperty(document, "hidden");
  const marks = { visibleAt: 0, lostEvents: 0, restoredEvents: 0 };
  window.hiddenTabMarks = marks;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") marks.visibleAt = performance.now();
  });
  document.addEventListener("webglcontextlost", () => { marks.lostEvents++; }, true);
  document.addEventListener("webglcontextrestored", () => { marks.restoredEvents++; }, true);
  return true;
})()`;

test("a real tab switch with a real context loss and restore completes the view within 1 s of returning", async () => {
  if (slow === null) throw new Error("The slide server is not running");
  const profile = mkdtempSync(join(tmpdir(), "parfocal-hidden-tab-"));
  const chrome = spawn(
    chromeBinary,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      "--ignore-gpu-blocklist",
      "--disable-features=CalculateNativeWinOcclusion",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const sockets: Cdp[] = [];
  try {
    const version = await waitForChrome();
    const browserCdp = await Cdp.open(version.webSocketDebuggerUrl);
    sockets.push(browserCdp);
    const targets = await getJson<TargetEntry[]>("/json/list");
    const first = targets.find((target) => target.type === "page");
    if (first === undefined) throw new Error("Chrome opened no tab");
    const tab = await Cdp.open(first.webSocketDebuggerUrl);
    sockets.push(tab);

    const renderer = await tab.evaluate<string>(`(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "no WebGL2";
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
    })()`);
    expect(renderer).not.toContain("SwiftShader");

    await browserCdp.send("Target.activateTarget", { targetId: first.id });
    if (process.platform === "darwin") {
      spawn("osascript", ["-e", 'tell application "Google Chrome" to activate'], {
        stdio: "ignore",
      });
    }
    await pause(1000);
    await tab.send("Page.navigate", { url: `${slow.url}/app/lifecycle.html` });
    for (let attempt = 0; attempt < 200; attempt++) {
      const ready = await tab
        .evaluate<boolean>("typeof window.lifecycleHarness !== 'undefined'")
        .catch(() => false);
      if (ready) break;
      await pause(50);
    }
    await tab.evaluate(installMarks);
    await tab.evaluate(`window.lifecycleHarness.open(${JSON.stringify(slideAt(slow))})`);
    for (let attempt = 0; attempt < 2000; attempt++) {
      const reads = await tab.evaluate<number>(
        "window.lifecycleHarness.state().sleep?.wakes.read ?? 0",
      );
      if (reads >= readsBeforeHiding) break;
      await pause(5);
    }
    const atHide = await tab.evaluate<LifecycleState>("window.lifecycleHarness.state()");
    expect(atHide.settled).toBe(false);
    expect(await tab.evaluate<string>("document.visibilityState")).toBe("visible");

    const { targetId: otherId } = await browserCdp.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank", newWindow: false, background: false },
    );
    await browserCdp.send("Target.activateTarget", { targetId: otherId });
    await pause(200);
    const hiddenWhileAway = await tab.evaluate<string>("document.visibilityState");
    expect(hiddenWhileAway).toBe("hidden");

    await pause(hiddenBeforeLossMs);
    const lost = await tab.evaluate<boolean>(`(() => {
      const { gl, extension } = ${canvasExpression};
      extension.loseContext();
      return gl.isContextLost();
    })()`);
    await pause(lostMs);
    await tab.evaluate(
      `(() => { ${canvasExpression}.extension.restoreContext(); return true; })()`,
    );
    await pause(hiddenAfterRestoreMs);
    const beforeReturn = await tab.evaluate<LifecycleState>("window.lifecycleHarness.state()");
    expect(await tab.evaluate<string>("document.visibilityState")).toBe("hidden");

    await browserCdp.send("Target.activateTarget", { targetId: first.id });
    await browserCdp.send("Target.closeTarget", { targetId: otherId });
    const toCompleteMs = await tab.evaluate<number>(`(async () => {
      await window.lifecycleHarness.waitUntilComplete(${budgetMs * 10});
      return performance.now() - window.hiddenTabMarks.visibleAt;
    })()`);

    const final = await tab.evaluate<LifecycleState>("window.lifecycleHarness.state()");
    const marks = await tab.evaluate<{ lostEvents: number; restoredEvents: number }>(
      "window.hiddenTabMarks",
    );
    const restored = await tab.evaluate<boolean>(
      `${canvasExpression}.gl.isContextLost() === false`,
    );
    const run = {
      chrome: version.Browser,
      renderer,
      hiddenWhileAway,
      readsAtHide: atHide.sleep?.wakes.read ?? 0,
      readsBeforeReturn: beforeReturn.sleep?.wakes.read ?? 0,
      lost,
      restored,
      lostEvents: marks.lostEvents,
      restoredEvents: marks.restoredEvents,
      toCompleteMs,
    };
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      join(reportDir, `run-${Date.now()}.json`),
      `${JSON.stringify({ ...run, errors: final.errors, sleep: final.sleep }, null, 2)}\n`,
    );
    console.log(`hidden-tab-hardware: ${JSON.stringify({ ...run, errors: final.errors })}`);
    expect(lost).toBe(true);
    expect(restored).toBe(true);
    expect(final.errors).toEqual([]);
    expect(toCompleteMs).toBeLessThan(budgetMs);
  } finally {
    for (const socket of sockets) socket.close();
    const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
