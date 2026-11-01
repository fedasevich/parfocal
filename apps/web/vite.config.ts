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

export default defineConfig({
  envPrefix: publicEnvPrefix,
  plugins: [publicEnvOnly(), fakeApiWorkerInDevOnly()],
  server: {
    headers: crossOriginIsolation,
    proxy: { "/api": "http://localhost:8000" },
  },
  preview: { headers: crossOriginIsolation },
  worker: { format: "es" },
  build: { target: "es2024" },
});
