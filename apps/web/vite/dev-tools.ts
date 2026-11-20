import { join } from "node:path";
import type { Plugin } from "vite";

export const devToolsFlag = "PARFOCAL_PUBLIC_DEV_TOOLS";
export const developerRouteFiles = "^(prototype|flow-map|spikes|issue-states|issue-pages)\\.";
export const developerRoutePaths = [
  "/prototype",
  "/flow-map",
  "/spikes/",
  "/issue-states",
  "/issue-pages/",
] as const;

const flagValues = ["", "on", "off"];
const realDataEnvs = ["staging", "prod"];

export type DevToolsInput = {
  command: "serve" | "build";
  isPreview: boolean;
  env: Record<string, string | undefined>;
};

export function devToolsFor({ command, isPreview, env }: DevToolsInput): boolean {
  const flag = env[devToolsFlag] ?? "";
  if (!flagValues.includes(flag)) {
    throw new Error(`${devToolsFlag} must be on or off, got ${flag}`);
  }
  const on = flag === "on" || (command === "serve" && !isPreview && flag !== "off");
  const appEnv = env["PARFOCAL_PUBLIC_APP_ENV"] ?? "";
  if (on && command === "build" && realDataEnvs.includes(appEnv)) {
    throw new Error(`${devToolsFlag} must be off in ${appEnv}, got on`);
  }
  return on;
}

export function devToolsDefine(on: boolean): Record<string, string> {
  return { [`import.meta.env.${devToolsFlag}`]: JSON.stringify(on ? "on" : "off") };
}

export function productionRouteTree(root: string): string {
  return join(root, "node_modules", ".parfocal", "routeTree.gen.ts");
}

export function routeTreeWithoutDeveloperPages(root: string): Plugin {
  const source = join(root, "src", "routeTree.gen.ts");
  const replacement = productionRouteTree(root);
  return {
    name: "parfocal-route-tree-without-developer-pages",
    enforce: "pre",
    async resolveId(id, importer, options) {
      if (!id.includes("routeTree.gen")) return null;
      const resolved = await this.resolve(id, importer, { ...options, skipSelf: true });
      return resolved?.id === source ? replacement : null;
    },
  };
}
