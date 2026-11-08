import { readBuildConfig } from "../config.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { createPresetPatchReader } from "./patch-reader.ts";
import type { RegionSam } from "./region-pass.ts";
import { type PresetPatchPlan, planPresetPatch, type ScalePresetId } from "./scale-presets.ts";
import type { SmartReader, SmartSam } from "./smart-session.ts";

export interface SmartServices {
  readonly reader: SmartReader;
  readonly sam: SmartSam & RegionSam;
  readonly plan: (preset: ScalePresetId) => Promise<PresetPatchPlan>;
  readonly close: () => void;
}

export type SmartOpenRequest = Awaited<
  ReturnType<typeof import("@parfocal/viewer-engine").signedOpenRequest>
>;

export interface SmartServicesContext {
  readonly slide: { readonly width: number; readonly height: number };
  readonly open: () => Promise<SmartOpenRequest>;
}

export type SmartServicesLoader = (context: SmartServicesContext) => Promise<SmartServices>;

export const defaultModelsUrl = "/models";

export function modelsUrl(): string {
  return import.meta.env.PARFOCAL_PUBLIC_MODELS_URL || defaultModelsUrl;
}

async function loadFakeServices(context: SmartServicesContext): Promise<SmartServices> {
  const { createFakeReader, createFakeSam } = await import("./fake-sam.ts");
  return {
    reader: createFakeReader(context.slide),
    sam: createFakeSam(),
    plan: (preset) => Promise.resolve(planPresetPatch([{ downsample: 1 }], null, preset)),
    close: () => undefined,
  };
}

async function loadRealServices(context: SmartServicesContext): Promise<SmartServices> {
  const engine = await loadViewerEngine();
  const opened = await context.open();
  const request = {
    formatId: opened.formatId,
    url: String(opened.url),
    ...(opened.index === undefined ? {} : { index: opened.index }),
  };
  const inner = engine.createWorkerPatchReader({
    request,
    cache: engine.createRangeCache(opened.fetch === undefined ? {} : { fetch: opened.fetch }),
  });
  const sam = engine.createSamClient({ modelsUrl: modelsUrl() });
  const reader = createPresetPatchReader(inner);
  return {
    reader,
    sam,
    plan: (preset) => reader.plan(preset),
    close: () => {
      sam.close();
      inner.close();
    },
  };
}

export const loadSmartServices: SmartServicesLoader = (context) => {
  const config = readBuildConfig();
  if (import.meta.env.DEV && config.fakeApi !== "off") return loadFakeServices(context);
  return loadRealServices(context);
};

export function shareServices(loader: SmartServicesLoader): SmartServicesLoader {
  let shared: Promise<SmartServices> | null = null;
  let holders = 0;
  return (context) => {
    shared ??= loader(context);
    holders += 1;
    let released = false;
    const loaded = shared;
    loaded.catch(() => {
      if (shared === loaded) shared = null;
      holders = 0;
    });
    return loaded.then((services) => ({
      ...services,
      close: () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders > 0) return;
        if (shared === loaded) shared = null;
        services.close();
      },
    }));
  };
}
