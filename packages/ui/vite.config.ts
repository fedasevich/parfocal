import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()], exclude: [/\/generated\//, /node_modules/] }),
    tailwindcss(),
    msw({ mode: "worker-only" }),
  ],
  build: { target: "es2024" },
});
