import { fileURLToPath } from "node:url";
import { syntheticDir } from "@parfocal/test-fixtures";
import { build } from "vite";
import { serve } from "../test/pixel-source/serve.ts";

export const gpuOriginVariable = "GPU_TIMING_ORIGIN";

const pageRoot = fileURLToPath(new URL("./page", import.meta.url));
const outDir = fileURLToPath(new URL("../test-results/gpu-timing-page", import.meta.url));

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
      chunkSizeWarningLimit: 4096,
      rolldownOptions: {
        input: { "gpu-timing": fileURLToPath(new URL("./page/gpu-timing.html", import.meta.url)) },
      },
    },
  });
  const served = await serve({ "/app": outDir, "/synthetic": syntheticDir });
  process.env[gpuOriginVariable] = served.origin;
  return () => served.close();
}
