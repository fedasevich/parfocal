import type { Plugin } from "vite";

const fontPreload = /^[ \t]*<link rel="preload"[^>]*as="font"[^>]*\/>\r?\n/gm;

export function fontPreloadInBuildOnly(): Plugin {
  return {
    name: "parfocal-font-preload",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace(fontPreload, ""),
    },
  };
}
