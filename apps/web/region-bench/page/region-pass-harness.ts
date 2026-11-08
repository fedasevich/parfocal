import { createSamClient, type Patch } from "@parfocal/viewer-engine";
import type { PresetPatchQuery } from "../../src/aiseg/patch-reader.ts";
import { planRegionTiles, type RegionSam, runRegionPass } from "../../src/aiseg/region-pass.ts";
import type { PresetPatchPlan } from "../../src/aiseg/scale-presets.ts";
import type { SmartReader } from "../../src/aiseg/smart-session.ts";

export interface RegionRequest {
  readonly modelsUrl: string;
  readonly fixturesUrl: string;
  readonly passes: number;
}

interface ManifestPatch {
  readonly rgb: string;
  readonly width: number;
  readonly height: number;
}

export interface RegionReport {
  readonly userAgent: string;
  readonly crossOriginIsolated: boolean;
  readonly provider: string;
  readonly fellBack: boolean;
  readonly tiles: number;
  readonly regionMicrons: number;
  readonly passMs: number[];
  readonly found: number[];
  readonly encodeMs: number[];
  readonly aisMs: number[];
}

declare global {
  interface Window {
    regionPass: { run(request: RegionRequest): Promise<RegionReport> };
  }
}

const source = 512;
const mosaic = source * 2;
const micronsPerPixel = 0.25;

const plan: PresetPatchPlan = {
  preset: "nuclei",
  level: 0,
  levelMicronsPerPixel: micronsPerPixel,
  sizedByMicrons: true,
  patchPixels: source,
  level0Pixels: source,
};

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.arrayBuffer();
}

async function mosaicRgb(fixturesUrl: string): Promise<Uint8Array> {
  const manifest = JSON.parse(
    new TextDecoder().decode(await fetchBuffer(`${fixturesUrl}/manifest.json`)),
  ) as { patches: ManifestPatch[] };
  const rgb = new Uint8Array(mosaic * mosaic * 3);
  for (const [index, entry] of manifest.patches.slice(0, 4).entries()) {
    if (entry.width !== source || entry.height !== source) throw new Error("fixture is not 512");
    const pixels = new Uint8Array(await fetchBuffer(`${fixturesUrl}/${entry.rgb}`));
    const left = (index % 2) * source;
    const top = Math.floor(index / 2) * source;
    for (let y = 0; y < source; y++) {
      rgb.set(
        pixels.subarray(y * source * 3, (y + 1) * source * 3),
        ((top + y) * mosaic + left) * 3,
      );
    }
  }
  return rgb;
}

function mosaicReader(rgb: Uint8Array): SmartReader {
  return {
    read(query: PresetPatchQuery) {
      const x = Math.max(0, Math.min(mosaic - source, Math.round(query.x) - source / 2));
      const y = Math.max(0, Math.min(mosaic - source, Math.round(query.y) - source / 2));
      const crop = new Uint8Array(source * source * 3);
      for (let row = 0; row < source; row++) {
        const from = ((y + row) * mosaic + x) * 3;
        crop.set(rgb.subarray(from, from + source * 3), row * source * 3);
      }
      const patch: Patch = {
        key: `${x}|${y}`,
        level: 0,
        downsample: 1,
        x,
        y,
        width: source,
        height: source,
        absent: false,
        rgb: crop,
      };
      return Promise.resolve({ patch });
    },
  };
}

async function run(request: RegionRequest): Promise<RegionReport> {
  const reader = mosaicReader(await mosaicRgb(request.fixturesUrl));
  const client = createSamClient({ modelsUrl: request.modelsUrl });
  const ready = await client.ready;
  const encodeMs: number[] = [];
  const aisMs: number[] = [];
  const sam: RegionSam = {
    async encode(id, pixels) {
      const done = await client.encode(id, pixels);
      encodeMs.push(done.ms);
      return done;
    },
    async segmentAll(id) {
      const started = performance.now();
      const outputs = await client.segmentAll(id);
      aisMs.push(performance.now() - started);
      return outputs;
    },
    drop: (id) => client.drop(id),
  };
  const region = { x: 128, y: 128, width: 768, height: 768 };
  const tiles = planRegionTiles(region, plan);
  const passMs: number[] = [];
  const found: number[] = [];
  for (let pass = 0; pass < request.passes; pass++) {
    const started = performance.now();
    const nuclei = await runRegionPass({ tiles, preset: "nuclei", reader, sam });
    passMs.push(performance.now() - started);
    found.push(nuclei.length);
  }
  client.close();
  return {
    userAgent: navigator.userAgent,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    provider: ready.provider,
    fellBack: ready.fellBack,
    tiles: tiles.length,
    regionMicrons: region.width * micronsPerPixel,
    passMs,
    found,
    encodeMs,
    aisMs,
  };
}

window.regionPass = { run };
