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
