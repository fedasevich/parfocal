import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { startLatencyProxy } from "../../../packages/latency-proxy/src/index.ts";
import { signCapability, signingKey } from "../src/capability.ts";

const { values: options } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:8791" },
    key: { type: "string", default: "" },
    size: { type: "string", default: "8388608" },
    rtt: { type: "string", default: "0,20" },
  },
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const SLIDE = "33333333-3333-4333-8333-333333333333";
const ORIGINAL = "original.bin";
const TILE_BYTES = 25_000;
const COLD = 60;
const WARM_RANGES = 20;
const WARM_REPEATS = 5;
const size = Number(options.size);
const rtts = options.rtt.split(",").map(Number);

const token = await signCapability(
  {
    tenant: TENANT,
    slide: SLIDE,
    original: ORIGINAL,
    size,
    restricted: [],
    expires: Math.floor(Date.now() / 1000) + 3600,
  },
  await signingKey(readFileSync(options.key, "utf8").trim()),
);

type Sample = { ms: number; outcome: string; workerMs: number | null };

function percentile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return Math.round((sorted[index] ?? Number.NaN) * 10) / 10;
}

function metric(timing: string, name: string): number | null {
  const match = new RegExp(`${name};dur=(\\d+(?:\\.\\d+)?)`).exec(timing);
  return match?.[1] === undefined ? null : Number(match[1]);
}

async function fetchRange(base: string, offset: number): Promise<Sample> {
  const started = performance.now();
  const response = await fetch(`${base}/tiles/${SLIDE}/${ORIGINAL}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Range: `bytes=${offset}-${offset + TILE_BYTES - 1}`,
    },
  });
  const body = await response.arrayBuffer();
  const ms = performance.now() - started;
  if (response.status !== 206 || body.byteLength !== TILE_BYTES) {
    throw new Error(`unexpected ${response.status} with ${body.byteLength} bytes`);
  }
  const timing = response.headers.get("Server-Timing") ?? "";
  const outcome = /cache;desc=(\w+)/.exec(timing)?.[1] ?? "none";
  return { ms, outcome, workerMs: metric(timing, "r2") ?? metric(timing, "cache") };
}

function summary(rtt: number, phase: string, samples: readonly Sample[]) {
  const outcomes = [...new Set(samples.map((sample) => sample.outcome))].join("/");
  const worker = samples.flatMap((sample) => (sample.workerMs === null ? [] : [sample.workerMs]));
  return {
    rtt,
    phase,
    n: samples.length,
    p50: percentile(
      samples.map((sample) => sample.ms),
      0.5,
    ),
    p95: percentile(
      samples.map((sample) => sample.ms),
      0.95,
    ),
    workerP50: worker.length === 0 ? null : percentile(worker, 0.5),
    outcomes,
  };
}

const slots = Math.floor(size / TILE_BYTES);
let next = 0;
const rows = [];
for (const rtt of rtts) {
  const proxy = await startLatencyProxy({ target: options.url, rttMs: rtt });
  try {
    await fetchRange(proxy.url, (slots - 1) * TILE_BYTES);
    const offsets = Array.from({ length: COLD }, () => (next++ % (slots - 1)) * TILE_BYTES);
    const cold = [];
    for (const offset of offsets) cold.push(await fetchRange(proxy.url, offset));
    const warm = [];
    for (let round = 0; round < WARM_REPEATS; round += 1) {
      for (const offset of offsets.slice(0, WARM_RANGES))
        warm.push(await fetchRange(proxy.url, offset));
    }
    rows.push(summary(rtt, "cold", cold), summary(rtt, "warm", warm));
  } finally {
    await proxy.close();
  }
}
console.log(JSON.stringify(rows, null, 2));
