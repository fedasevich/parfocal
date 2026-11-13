import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, type Plugin } from "vite";
import { bundleSummaryJson } from "./vite/bundle-summary.ts";
import { noAppPageForMissingData } from "./vite/data-paths.ts";
import { fixtureTilesInDevOnly } from "./vite/dev-tiles.ts";
import { fontPreloadInBuildOnly } from "./vite/font-preload.ts";
import { assetsWithinWorkersLimit } from "./vite/large-assets.ts";
import { publicEnvOnly, publicEnvPrefix } from "./vite/public-env.ts";

const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

function fakeApiWorkerInDevOnly(): Plugin {
  return { ...msw({ mode: "worker-only" }), apply: "serve" };
}

const mockAssets = fileURLToPath(new URL("../../docs/design/ux-mock/assets", import.meta.url));

const imageTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function mockAssetsInDevOnly(): Plugin {
  return {
    name: "parfocal-mock-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/mock-assets", (request, response, next) => {
        const file = join(mockAssets, normalize(request.url ?? "/").replace(/^(\.\.[/\\])+/, ""));
        if (!file.startsWith(mockAssets) || !existsSync(file)) return next();
        response.setHeader("Content-Type", imageTypes[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
  };
}

const root = fileURLToPath(new URL(".", import.meta.url));
const reportDir = join(root, "bundle-report");

function bundleReport(): Plugin[] {
  return [
    visualizer({
      filename: join(reportDir, "treemap.html"),
      template: "treemap",
      gzipSize: true,
      title: "Parfocal web bundle",
    }) as unknown as Plugin,
    bundleSummaryJson(root, join(reportDir, "summary.json")),
  ];
}

export default defineConfig(({ mode }) => ({
  envPrefix: publicEnvPrefix,
  plugins: [
    publicEnvOnly(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      addExtensions: true,
      quoteStyle: "double",
      semicolons: true,
      disableLogging: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()], exclude: [/\/generated\//, /node_modules/] }),
    tailwindcss(),
    fakeApiWorkerInDevOnly(),
    mockAssetsInDevOnly(),
    fontPreloadInBuildOnly(),
    fixtureTilesInDevOnly(),
    noAppPageForMissingData(),
    assetsWithinWorkersLimit(),
    ...(mode === "analyze" ? bundleReport() : []),
  ],
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] },
  server: {
    headers: crossOriginIsolation,
    proxy: { "/api": "http://localhost:8000" },
  },
  preview: { headers: crossOriginIsolation },
  html: { cspNonce: "PARFOCAL_CSP_NONCE" },
  worker: { format: "es" },
  build: {
    target: "es2024",
    ...(mode === "analyze" ? { outDir: join(reportDir, "dist"), emptyOutDir: true } : {}),
  },
}));
