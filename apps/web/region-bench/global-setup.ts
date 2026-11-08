import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { serve } from "../../../packages/viewer-engine/test/pixel-source/serve.ts";

export const regionOriginVariable = "REGION_BENCH_ORIGIN";

const pageRoot = fileURLToPath(new URL("./page", import.meta.url));
const outDir = fileURLToPath(new URL("../test-results/region-bench-page", import.meta.url));

const crossOriginIsolated = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
};

function cacheRoot(): string {
  return join(process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache"), "parfocal");
}

export function modelsDir(): string {
  const configured = process.env["PARFOCAL_MODELS_DIR"];
  return configured ? join(configured, "onnx") : join(cacheRoot(), "models", "onnx");
}

export function fixturesDir(): string {
  const configured = process.env["PARFOCAL_DATASETS_DIR"];
  return configured
    ? join(configured, "smart-select-smoke")
    : join(cacheRoot(), "datasets", "smart-select-smoke");
}

export function missingGraphs(graphs: readonly string[]): string[] {
  return graphs.filter((graph) => !existsSync(join(modelsDir(), graph)));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await build({
    root: pageRoot,
    base: "./",
    configFile: false,
    logLevel: "warn",
    worker: { format: "es" },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 32768,
      rolldownOptions: { input: { "region-pass": join(pageRoot, "region-pass.html") } },
    },
  });
  const served = await serve(
    { "/app": outDir, "/models": modelsDir(), "/fixtures": fixturesDir() },
    { headers: crossOriginIsolated },
  );
  process.env[regionOriginVariable] = served.origin;
  return () => served.close();
}
