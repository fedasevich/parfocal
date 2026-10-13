import { defineConfig } from "vite";
import { publicEnvOnly, publicEnvPrefix } from "./vite/public-env.ts";

const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  envPrefix: publicEnvPrefix,
  plugins: [publicEnvOnly()],
  server: {
    headers: crossOriginIsolation,
    proxy: { "/api": "http://localhost:8000" },
  },
  preview: { headers: crossOriginIsolation },
  worker: { format: "es" },
  build: { target: "es2024" },
});
