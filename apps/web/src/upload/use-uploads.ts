import { useSyncExternalStore } from "react";
import { readBuildConfig } from "../config.ts";
import type { UploadEngine } from "./engine.ts";
import { createLazyUploadEngine } from "./lazy-engine.ts";

const engines = new Map<string, UploadEngine>();

export function uploadEngineFor(apiBaseUrl: string): UploadEngine {
  const endpoint = `${apiBaseUrl}/uploads`;
  let engine = engines.get(endpoint);
  if (engine === undefined) {
    engine = createLazyUploadEngine({ endpoint });
    engines.set(endpoint, engine);
  }
  return engine;
}

export function useUploadEngine(): UploadEngine {
  return uploadEngineFor(readBuildConfig().apiBaseUrl);
}

export function useUploads() {
  const engine = useUploadEngine();
  const entries = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return { engine, entries };
}
