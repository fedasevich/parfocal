import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const edgeDevFlag = "PARFOCAL_EDGE_DEV";
export const edgeWorkerPrefixes = ["/tiles/", "/rt/"];
export const edgeWorkerPaths = edgeWorkerPrefixes.map((prefix) => `${prefix}*`);

const edgeConfig = fileURLToPath(new URL("../../edge/wrangler.jsonc", import.meta.url));
const workerKeys = ["TILE_TOKEN_KEY", "ROOM_TOKEN_KEY"] as const;

export type EdgeDevInput = {
  command: "serve" | "build";
  isPreview: boolean;
  env: Record<string, string | undefined>;
};

export function edgeDevFor({ command, isPreview, env }: EdgeDevInput): boolean {
  const flag = env[edgeDevFlag] ?? "";
  if (!["", "on", "off"].includes(flag)) {
    throw new Error(`${edgeDevFlag} must be on or off, got ${flag}`);
  }
  return flag === "on" && command === "serve" && !isPreview;
}

type Bucket = { binding: string; bucket_name?: string; remote?: boolean };

export type EdgeDevOverrides = {
  r2_buckets: Bucket[];
  assets: {
    binding: string;
    not_found_handling: "single-page-application";
    run_worker_first: string[];
  };
  vars: Record<string, string>;
};

export function edgeDevOverrides(
  buckets: readonly Bucket[],
  env: Record<string, string | undefined>,
): EdgeDevOverrides {
  const vars: Record<string, string> = {};
  for (const key of workerKeys) {
    const value = env[key];
    if (!value) throw new Error(`${edgeDevFlag}=on needs ${key} from .env`);
    vars[key] = value;
  }
  return {
    r2_buckets: buckets.map((bucket) => ({ ...bucket, remote: true })),
    assets: {
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: edgeWorkerPaths,
    },
    vars,
  };
}

export function customizeEdgeWorker(
  worker: { r2_buckets: Bucket[] },
  env: Record<string, string | undefined>,
): Omit<EdgeDevOverrides, "r2_buckets"> {
  const { r2_buckets, ...rest } = edgeDevOverrides(worker.r2_buckets, env);
  worker.r2_buckets = r2_buckets;
  return rest;
}

export async function edgeWorker(
  on: boolean,
  env: Record<string, string | undefined>,
): Promise<Plugin[]> {
  if (!on) return [];
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return cloudflare({
    configPath: edgeConfig,
    inspectorPort: false,
    persistState: false,
    config: (worker) => customizeEdgeWorker(worker, env),
  });
}
