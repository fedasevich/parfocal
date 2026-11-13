import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin, ResolvedConfig } from "vite";

export const workersAssetLimit = 25 * 1024 * 1024;
const unpackedInBrowser = /^ort-wasm-.*\.wasm$/;

export async function fitAssetsToWorkersLimit(dir: string): Promise<string[]> {
  const packed: string[] = [];
  const tooLarge: string[] = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    if (!info.isFile() || info.size <= workersAssetLimit) continue;
    if (!unpackedInBrowser.test(name)) {
      tooLarge.push(name);
      continue;
    }
    const gzipped = gzipSync(await readFile(path), { level: 9 });
    if (gzipped.length > workersAssetLimit) {
      tooLarge.push(name);
      continue;
    }
    await writeFile(path, gzipped);
    packed.push(name);
  }
  if (tooLarge.length > 0) {
    throw new Error(`Assets over the 25 MiB Workers limit: ${tooLarge.join(", ")}`);
  }
  return packed;
}

export function assetsWithinWorkersLimit(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "parfocal-assets-within-workers-limit",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config.build.ssr) return;
      await fitAssetsToWorkersLimit(join(config.build.outDir, config.build.assetsDir));
    },
  };
}
