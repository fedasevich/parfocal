import { fileURLToPath } from "node:url";
import { fixturesDir, syntheticDir } from "@parfocal/test-fixtures";
import { build } from "vite";
import { serve } from "../test/pixel-source/serve.ts";

export const harnessOriginVariable = "VIEWER_HARNESS_ORIGIN";

const pageRoot = fileURLToPath(new URL("./page", import.meta.url));
export const outDir = fileURLToPath(new URL("../test-results/harness", import.meta.url));

export const crossOriginIsolated = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin",
};

export default async function globalSetup(): Promise<() => Promise<void>> {
  await build({
    root: pageRoot,
    base: "./",
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      chunkSizeWarningLimit: 4096,
      rolldownOptions: {
        input: {
          memory: fileURLToPath(new URL("./page/memory.html", import.meta.url)),
          settings: fileURLToPath(new URL("./page/settings.html", import.meta.url)),
          pan: fileURLToPath(new URL("./page/pan.html", import.meta.url)),
        },
      },
    },
  });
  const served = await serve(
    { "/app": outDir, "/cache": fixturesDir(), "/synthetic": syntheticDir },
    { headers: crossOriginIsolated },
  );
  process.env[harnessOriginVariable] = served.origin;
  return () => served.close();
}
