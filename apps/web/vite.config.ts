import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
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
  ],
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query"] },
  server: {
    headers: crossOriginIsolation,
    proxy: { "/api": "http://localhost:8000" },
  },
  preview: { headers: crossOriginIsolation },
  worker: { format: "es" },
  build: { target: "es2024" },
});
