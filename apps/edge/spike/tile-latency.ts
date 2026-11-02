import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { signCapability, signingKey } from "../src/capability.ts";

type Sample = {
  arm: string;
  phase: "cold" | "warm";
  totalMs: number;
  r2Ms: number | null;
  cacheMs: number | null;
  outcome: string;
  colo: string;
  status: number;
  bytes: number;
};

const { values: options } = parseArgs({
  options: {
    url: { type: "string", default: "" },
    key: { type: "string", default: "" },
    ranges: { type: "string", default: "" },
    raw: { type: "string", default: "" },
    mode: { type: "string", default: "matrix" },
  },
});
const base = options.url;
const keyFile = options.key;
const rangesFile = options.ranges;
const rawFile = options.raw;
const mode = options.mode;
const SLIDE = "spike";
const ORIGINAL = "CMU-1.svs";
const ORIGINAL_SIZE = 177_552_579;
const CHUNK_BYTES = 196_608;
const CHUNKS = Array.from({ length: 30 }, (_, index) => `chunk-${String(index).padStart(2, "0")}`);
const COLD_SVS = 100;
const WARM_REPEATS = 5;
const WARM_RANGES = 20;

const ranges = JSON.parse(readFileSync(rangesFile, "utf8")) as [number, number][];
const token = await signCapability(
  {
    tenant: "spike",
    slide: SLIDE,
    original: ORIGINAL,
    size: ORIGINAL_SIZE,
    restricted: [],
    expires: Math.floor(Date.now() / 1000) + 3600,
  },
  await signingKey(readFileSync(keyFile, "utf8").trim()),
);

function metric(timing: string, name: string): number | null {
  const match = new RegExp(`${name};dur=(\\d+(?:\\.\\d+)?)`).exec(timing);
  return match?.[1] === undefined ? null : Number(match[1]);
}

async function fetchOnce(
  arm: string,
  phase: "cold" | "warm",
  file: string,
  cache: boolean,
  range?: [number, number],
): Promise<Sample> {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (cache) {
    headers.set("X-Spike-Cache", "on");
  }
  if (range !== undefined) {
    headers.set("Range", `bytes=${range[0]}-${range[0] + range[1] - 1}`);
  }
  const started = performance.now();
  const response = await fetch(`${base}/tiles/${SLIDE}/${file}`, { headers });
  const body = await response.arrayBuffer();
  const totalMs = performance.now() - started;
  const expected = range === undefined ? CHUNK_BYTES : range[1];
  if (body.byteLength !== expected) {
    throw new Error(`${file} returned ${body.byteLength} bytes, expected ${expected}`);
  }
  const timing = response.headers.get("Server-Timing") ?? "";
  return {
    arm,
    phase,
    totalMs,
    r2Ms: metric(timing, "r2"),
    cacheMs: metric(timing, "cache"),
    outcome: /cache;desc=(\w+)/.exec(timing)?.[1] ?? "none",
    colo: response.headers.get("cf-ray")?.split("-")[1] ?? "",
    status: response.status,
    bytes: body.byteLength,
  };
}

async function svsArm(arm: string, cache: boolean, offset: number): Promise<Sample[]> {
  const samples: Sample[] = [];
  const own = ranges.slice(offset, offset + COLD_SVS);
  for (const range of own) {
    samples.push(await fetchOnce(arm, "cold", ORIGINAL, cache, range));
  }
  for (let round = 0; round < WARM_REPEATS; round += 1) {
    for (const range of own.slice(0, WARM_RANGES)) {
      samples.push(await fetchOnce(arm, "warm", ORIGINAL, cache, range));
    }
  }
  return samples;
}

async function chunkArm(arm: string, cache: boolean, own: readonly string[]): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const chunk of own) {
    samples.push(await fetchOnce(arm, "cold", chunk, cache));
  }
  for (let round = 0; round < WARM_REPEATS; round += 1) {
    for (const chunk of own) {
      samples.push(await fetchOnce(arm, "warm", chunk, cache));
    }
  }
  return samples;
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN;
}

function summarise(samples: readonly Sample[]): void {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const name = `${sample.arm} ${sample.phase}`;
    groups.set(name, [...(groups.get(name) ?? []), sample]);
  }
  for (const [name, group] of groups) {
    const totals = group.map((sample) => sample.totalMs);
    const r2 = group.flatMap((sample) => (sample.r2Ms === null ? [] : [sample.r2Ms]));
    const outcomes = [...new Set(group.map((sample) => sample.outcome))].join("/");
    const statuses = [...new Set(group.map((sample) => sample.status))].join("/");
    const colos = [...new Set(group.map((sample) => sample.colo))].join("/");
    console.log(
      [
        name.padEnd(22),
        `n=${group.length}`,
        `p50=${quantile(totals, 0.5).toFixed(1)}`,
        `p95=${quantile(totals, 0.95).toFixed(1)}`,
        `r2p50=${r2.length > 0 ? quantile(r2, 0.5) : "-"}`,
        `r2n=${r2.length}`,
        `cache=${outcomes}`,
        `status=${statuses}`,
        `colo=${colos}`,
      ].join(" "),
    );
  }
}

if (mode === "probe") {
  const range = ranges.at(-1) as [number, number];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    console.log(JSON.stringify(await fetchOnce("probe", "cold", ORIGINAL, true, range)));
  }
} else {
  const first = await fetchOnce("isolate", "cold", ORIGINAL, false, ranges.at(-2));
  console.log(`first request ${first.totalMs.toFixed(1)} ms, colo ${first.colo}`);
  const samples = [
    ...(await svsArm("svs no-cache", false, 0)),
    ...(await svsArm("svs cache", true, COLD_SVS)),
    ...(await chunkArm("chunk no-cache", false, CHUNKS.slice(0, 15))),
    ...(await chunkArm("chunk cache", true, CHUNKS.slice(15))),
  ];
  writeFileSync(rawFile, JSON.stringify({ first, samples }));
  summarise(samples);
}
