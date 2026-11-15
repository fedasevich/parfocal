import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { type Connect, defineConfig, loadEnv, type Plugin } from "vite";
import { bundleSummaryJson } from "./vite/bundle-summary.ts";
import { noAppPageForMissingData } from "./vite/data-paths.ts";
import { fixtureTilesWithDevTools } from "./vite/dev-tiles.ts";
import {
  developerRouteFiles,
  devToolsDefine,
  devToolsFor,
  productionRouteTree,
  routeTreeWithoutDeveloperPages,
} from "./vite/dev-tools.ts";
import { edgeDevFor, edgeWorker, edgeWorkerPrefixes } from "./vite/edge-dev.ts";
import { fontPreloadInBuildOnly } from "./vite/font-preload.ts";
import { assetsWithinWorkersLimit } from "./vite/large-assets.ts";
import { publicEnvOnly, publicEnvPrefix } from "./vite/public-env.ts";

const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

const apiProxy = { "/api": `http://localhost:${process.env["PARFOCAL_API_PORT"] ?? "8000"}` };

function fakeApiWorkerWithDevTools(devTools: boolean): Plugin {
  return {
    ...msw({ mode: "worker-only" }),
    apply: (_, { command }) => command === "serve" || devTools,
  };
}

const mockAssets = fileURLToPath(new URL("../../docs/design/ux-mock/assets", import.meta.url));

const imageTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

const serveMockAsset: Connect.NextHandleFunction = (request, response, next) => {
  const file = join(mockAssets, normalize(request.url ?? "/").replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(mockAssets) || !existsSync(file)) return next();
  response.setHeader("Content-Type", imageTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(response);
};

function mockAssetsWithDevTools(devTools: boolean): Plugin {
  return {
    name: "parfocal-mock-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/mock-assets", serveMockAsset);
    },
    configurePreviewServer(server) {
      if (devTools) server.middlewares.use("/mock-assets", serveMockAsset);
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

const outDirOf = (mode: string) => {
  if (mode === "analyze") return { outDir: join(reportDir, "dist"), emptyOutDir: true };
  if (mode === "e2e") return { outDir: join(root, "dist-e2e"), emptyOutDir: true };
  return {};
};

export default defineConfig(({ command, mode, isPreview }) => {
  const devTools = devToolsFor({
    command,
    isPreview: isPreview === true,
    env: loadEnv(mode, root, publicEnvPrefix),
  });
  const withoutDeveloperPages = command === "build" && !devTools;
  const edgeDev = edgeDevFor({ command, isPreview: isPreview === true, env: process.env });
  return {
    envPrefix: publicEnvPrefix,
    define: devToolsDefine(devTools),
    plugins: [
      publicEnvOnly(),
      ...(withoutDeveloperPages ? [routeTreeWithoutDeveloperPages(root)] : []),
      tanstackRouter({
        ...(withoutDeveloperPages
          ? {
              routeFileIgnorePattern: developerRouteFiles,
              generatedRouteTree: productionRouteTree(root),
            }
          : {}),
        target: "react",
        autoCodeSplitting: true,
        addExtensions: true,
        quoteStyle: "double",
        semicolons: true,
        disableLogging: true,
      }),
      react(),
      lingui(),
      babel({
        presets: [
          linguiTransformerBabelPreset({ descriptorFields: "message" }),
          reactCompilerPreset(),
        ],
        exclude: [/\/generated\//, /node_modules/],
      }),
      tailwindcss(),
      fakeApiWorkerWithDevTools(devTools),
      mockAssetsWithDevTools(devTools),
      fontPreloadInBuildOnly(),
      ...(edgeDev ? [] : [fixtureTilesWithDevTools(devTools)]),
      noAppPageForMissingData(edgeDev ? edgeWorkerPrefixes : []),
      assetsWithinWorkersLimit(),
      edgeWorker(edgeDev, process.env),
      ...(mode === "analyze" ? bundleReport() : []),
    ],
    resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] },
    server: { headers: crossOriginIsolation, proxy: apiProxy },
    preview: { headers: crossOriginIsolation, proxy: apiProxy },
    html: { cspNonce: "PARFOCAL_CSP_NONCE" },
    worker: { format: "es" },
    build: { target: "es2024", ...outDirOf(mode) },
  };
});
