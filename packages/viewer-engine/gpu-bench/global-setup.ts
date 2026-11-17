import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir, syntheticDir } from "@parfocal/test-fixtures";
import { build } from "vite";
import { serve } from "../test/pixel-source/serve.ts";

export const gpuOriginVariable = "GPU_TIMING_ORIGIN";
export const nucleiFileVariable = "GPU_TIMING_NUCLEI";

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
        input: {
          "gpu-timing": fileURLToPath(new URL("./page/gpu-timing.html", import.meta.url)),
          "custom-gpu-timing": fileURLToPath(
            new URL("./page/custom-gpu-timing.html", import.meta.url),
          ),
        },
      },
    },
  });
  const nuclei = process.env[nucleiFileVariable];
  const served = await serve({
    "/app": outDir,
    "/synthetic": syntheticDir,
    "/cache": fixturesDir(),
    ...(nuclei ? { "/nuclei": dirname(nuclei) } : {}),
  });
  process.env[gpuOriginVariable] = served.origin;
  return () => served.close();
}
