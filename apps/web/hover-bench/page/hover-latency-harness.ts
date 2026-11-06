import { createSamClient, type Patch } from "@parfocal/viewer-engine";
import {
  createSmartSession,
  type SmartReader,
  type SmartSam,
} from "../../src/aiseg/smart-session.ts";

export interface LatencyRequest {
  readonly modelsUrl: string;
  readonly fixturesUrl: string;
  readonly patches: number;
}

interface Nucleus {
  readonly id: number;
  readonly realistic: readonly [number, number];
}

interface ManifestPatch {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rgb: string;
  readonly nuclei: readonly Nucleus[];
}

interface Manifest {
  readonly patches: readonly ManifestPatch[];
}

export interface LatencyReport {
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly hardwareConcurrency: number;
  readonly adapter: { vendor: string; architecture: string } | null;
  readonly provider: string;
  readonly fellBack: boolean;
  readonly patches: number;
  readonly encodeMs: number[];
  readonly decodeMs: number[];
  readonly outlineMs: number[];
  readonly frameMs: number[];
  readonly withoutOutline: number;
  readonly cachedMs: number[];
  readonly sweep: { moves: number; decodes: number; settleMs: number };
}

declare global {
  interface Window {
    hoverLatency: { run(request: LatencyRequest): Promise<LatencyReport> };
  }
}

const source = 512;
const sweepMoves = 40;
const sweepIntervalMs = 16;

interface GpuAdapter {
  readonly info: { vendor: string; architecture: string };
}

async function gpuAdapter(): Promise<{ vendor: string; architecture: string } | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } })
    .gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) return null;
  return { vendor: adapter.info.vendor, architecture: adapter.info.architecture };
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.arrayBuffer();
}

const frame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now())));

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function run(request: LatencyRequest): Promise<LatencyReport> {
  const adapter = await gpuAdapter();
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBuffer(`${request.fixturesUrl}/manifest.json`)),
  ) as Manifest;
  const chosen = manifest.patches.slice(0, request.patches);
  const patches: Patch[] = [];
  for (const [index, entry] of chosen.entries()) {
    if (entry.width !== source || entry.height !== source)
      throw new Error(`${entry.name} is not ${source}`);
    patches.push({
      key: entry.name,
      level: 0,
      downsample: 1,
      x: index * source,
      y: 0,
      width: source,
      height: source,
      absent: false,
      rgb: new Uint8Array(await fetchBuffer(`${request.fixturesUrl}/${entry.rgb}`)),
    });
  }
  const reader: SmartReader = {
    read(query) {
      const index = Math.max(0, Math.min(patches.length - 1, Math.floor(query.x / source)));
      return Promise.resolve({ patch: patches[index] as Patch });
    },
  };

  const client = createSamClient({ modelsUrl: request.modelsUrl });
  const ready = await client.ready;
  const encodeMs: number[] = [];
  const decodeMs: number[] = [];
  let decodes = 0;
  const sam: SmartSam = {
    async encode(id, pixels) {
      const done = await client.encode(id, pixels);
      encodeMs.push(done.ms);
      return done;
    },
    async prompt(id, prompt) {
      decodes += 1;
      const outcome = await client.prompt(id, prompt);
      if (outcome.status === "answer") decodeMs.push(outcome.ms);
      return outcome;
    },
  };

  let shownAt = 0;
  let shown: Float32Array | null | undefined;
  const session = createSmartSession({
    slideId: "bench",
    reader,
    sam,
    onChange: () => undefined,
    onHover: (ring) => {
      shownAt = performance.now();
      shown = ring;
    },
  });

  const outlineMs: number[] = [];
  const frameMs: number[] = [];
  const cachedMs: number[] = [];
  let withoutOutline = 0;

  for (const [index, entry] of chosen.entries()) {
    const patch = patches[index] as Patch;
    await session.prewarm({ x: patch.x + source / 2, y: source / 2 });
    for (const nucleus of entry.nuclei) {
      const at = { x: patch.x + nucleus.realistic[0] + 0.5, y: nucleus.realistic[1] + 0.5 };
      session.clearHover();
      shown = undefined;
      await pause(20);
      const start = performance.now();
      await session.hover(at);
      const painted = await frame();
      if (shown === undefined) throw new Error("The hover never reported");
      if (shown === null) {
        withoutOutline += 1;
        continue;
      }
      outlineMs.push(shownAt - start);
      frameMs.push(painted - start);

      session.clearHover();
      shown = undefined;
      const again = performance.now();
      await session.hover(at);
      if (shown !== undefined && shown !== null) cachedMs.push(shownAt - again);
    }
  }

  const sweepPatch = patches[patches.length - 1] as Patch;
  session.clearHover();
  await pause(50);
  const before = decodes;
  let last: Promise<void> = Promise.resolve();
  for (let move = 0; move < sweepMoves; move++) {
    last = session.hover({
      x: sweepPatch.x + 16 + ((move * 13) % 480) + 0.5,
      y: 16 + ((move * 29) % 480) + 0.5,
    });
    await pause(sweepIntervalMs);
  }
  const lastMove = performance.now();
  await last;
  const settleMs = performance.now() - lastMove;

  session.close();
  client.close();
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated: self.crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    adapter,
    provider: ready.provider,
    fellBack: ready.fellBack,
    patches: chosen.length,
    encodeMs,
    decodeMs,
    outlineMs,
    frameMs,
    withoutOutline,
    cachedMs,
    sweep: { moves: sweepMoves, decodes: decodes - before, settleMs },
  };
}

window.hoverLatency = { run };
