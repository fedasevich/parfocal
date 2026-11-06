import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { crossOriginIsolated } from "../browser/global-setup.ts";
import { serve } from "../test/pixel-source/serve.ts";

export const benchOriginVariable = "SAM_BENCH_ORIGIN";

const pageRoot = fileURLToPath(new URL("./page", import.meta.url));
const outDir = fileURLToPath(new URL("../test-results/sam-bench-page", import.meta.url));

export function modelsDir(): string {
  const configured = process.env["PARFOCAL_MODELS_DIR"];
  if (configured) return join(configured, "onnx");
  const cache = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  return join(cache, "parfocal", "models", "onnx");
}

export function missingGraphs(graphs: readonly string[]): string[] {
  return graphs.filter((graph) => !existsSync(join(modelsDir(), graph)));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  await build({
    root: pageRoot,
    base: "./",
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 32768,
      rolldownOptions: {
        input: { "sam-variants": join(pageRoot, "sam-variants.html") },
      },
    },
  });
  const served = await serve(
    { "/app": outDir, "/models": modelsDir() },
    { headers: crossOriginIsolated },
  );
  process.env[benchOriginVariable] = served.origin;
  return () => served.close();
}
