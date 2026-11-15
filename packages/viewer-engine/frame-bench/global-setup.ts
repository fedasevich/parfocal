import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { build } from "vite";
import { crossOriginIsolated } from "../browser/global-setup.ts";
import { type Served, serve } from "../test/pixel-source/serve.ts";

const pageRoot = fileURLToPath(new URL("..", import.meta.url));
const outDir = fileURLToPath(new URL("../test-results/frame-bench-page", import.meta.url));

export const pagePath = "/app/frame-bench/page/frame-bench.html";

export async function buildAndServe(): Promise<Served> {
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
          "frame-bench": fileURLToPath(new URL("./page/frame-bench.html", import.meta.url)),
        },
      },
    },
  });
  return serve({ "/app": outDir, "/cache": fixturesDir() }, { headers: crossOriginIsolated });
}
