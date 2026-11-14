import { lingui, linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    lingui(),
    babel({
      presets: [linguiTransformerBabelPreset(), reactCompilerPreset()],
      exclude: [/\/generated\//, /node_modules/],
    }),
    tailwindcss(),
    msw({ mode: "worker-only" }),
  ],
  build: { target: "es2024" },
});
