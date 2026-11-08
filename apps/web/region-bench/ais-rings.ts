import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aisInstances } from "../src/aiseg/ais-instances.ts";

interface MapsEntry {
  readonly name: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

interface RingsEntry {
  readonly name: string;
  readonly rings: number[][];
  readonly ms: number;
}

function readMaps(folder: string, entry: MapsEntry): Float32Array {
  const bytes = readFileSync(join(folder, entry.file));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}

export function ringsFor(folder: string): RingsEntry[] {
  const entries = JSON.parse(readFileSync(join(folder, "maps.json"), "utf8")) as MapsEntry[];
  return entries.map((entry) => {
    const maps = readMaps(folder, entry);
    const started = performance.now();
    const instances = aisInstances(maps, entry.width, entry.height);
    const ms = performance.now() - started;
    return {
      name: entry.name,
      rings: instances.map((instance) => Array.from(instance.ring)),
      ms,
    };
  });
}

const [folder, out] = process.argv.slice(2);
if (folder === undefined || out === undefined) {
  throw new Error("usage: node region-bench/ais-rings.ts MAPS_FOLDER OUT_JSON");
}
writeFileSync(out, JSON.stringify(ringsFor(folder)));
