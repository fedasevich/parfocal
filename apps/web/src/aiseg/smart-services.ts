import type { SamClient } from "@parfocal/viewer-engine";
import { readBuildConfig } from "../config.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { type EmbedderWarmOptions, warmEmbedderIfSlow } from "./embedder-warm.ts";
import { usesServerEmbeddings } from "./one-click-tiers.ts";
import { createPresetPatchReader } from "./patch-reader.ts";
import type { OutlineTier } from "./prompt-fallback.ts";
import type { RegionSam } from "./region-pass.ts";
import { type PresetPatchPlan, planPresetPatch, type ScalePresetId } from "./scale-presets.ts";
import {
  createServerEmbeddings,
  httpEmbeddingTransport,
  withServerEmbeddings,
  withServerTiles,
} from "./server-embeddings.ts";
import type { SmartReader, SmartSam } from "./smart-session.ts";
import {
  createEncoderSource,
  createViewEmbeddings,
  type EncoderSourceSignal,
  withSeenLevels,
  withViewEmbeddings,
} from "./view-embeddings.ts";

export interface SmartServices {
  readonly reader: SmartReader;
  readonly sam: SmartSam & RegionSam & Partial<Pick<SamClient, "pool">>;
  readonly plan: (preset: ScalePresetId) => Promise<PresetPatchPlan>;
  readonly encoderSource?: Pick<EncoderSourceSignal, "get" | "subscribe">;
  readonly close: () => void;
}

export type SmartOpenRequest = Awaited<
  ReturnType<typeof import("@parfocal/viewer-engine").signedOpenRequest>
>;

export interface SmartServicesContext {
  readonly slide: { readonly width: number; readonly height: number };
  readonly slideId?: string;
  readonly tier?: OutlineTier;
  readonly open: () => Promise<SmartOpenRequest>;
}

const serverFirst = (context: SmartServicesContext) => usesServerEmbeddings(context.tier ?? "good");

export type SmartServicesLoader = (context: SmartServicesContext) => Promise<SmartServices>;

export const defaultModelsUrl = "/models";

export function modelsUrl(): string {
  return import.meta.env.PARFOCAL_PUBLIC_MODELS_URL || defaultModelsUrl;
}

async function loadFakeServices(
  context: SmartServicesContext,
  fakeBest: boolean,
): Promise<SmartServices> {
  const { createFakeReader, createFakeSam } = await import("./fake-sam.ts");
  const reader = createFakeReader(context.slide);
  const sam = createFakeSam();
  const plan = (preset: ScalePresetId) =>
    Promise.resolve(planPresetPatch([{ downsample: 1 }], null, preset));
  const { slideId } = context;
  if (!fakeBest || !serverFirst(context) || slideId === undefined) {
    return { reader, sam, plan, close: () => undefined };
  }
  const encoderSource = createEncoderSource();
  const views = createViewEmbeddings();
  const best = withViewEmbeddings(
    { ...sam, adopt: (id: string) => Promise.resolve({ id, ms: 1, evicted: [] }) },
    {
      views,
      slideId,
      slide: context.slide,
      downsampleOf: () => 1,
      onSource: (source) => encoderSource.set(source),
    },
  );
  const windowed: SmartReader = {
    async read(query, signal) {
      const read = await reader.read(query, signal);
      const { patch } = read;
      const key = [patch.level, patch.x, patch.y, patch.width, patch.height].join("|");
      return { ...read, patch: { ...patch, key } };
    },
  };
  return { reader: windowed, sam: best, plan, encoderSource, close: () => views.close() };
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
    cache: engine.rangeCacheFor(opened),
  });
  const local = engine.createSamClient({ modelsUrl: modelsUrl() });
  const presets = createPresetPatchReader(inner);
  const close = () => {
    local.close();
    inner.close();
  };
  const { slideId } = context;
  if (!serverFirst(context) || slideId === undefined) {
    return { reader: presets, sam: local, plan: (preset) => presets.plan(preset), close };
  }
  const server = createServerEmbeddings(httpEmbeddingTransport());
  const levels = new Map<number, number>();
  const encoderSource = createEncoderSource();
  const views = createViewEmbeddings();
  const sam = withViewEmbeddings(withServerEmbeddings(local, server), {
    views,
    slideId,
    slide: context.slide,
    downsampleOf: (level) => levels.get(level),
    onSource: (source) => encoderSource.set(source),
  });
  const reader = withSeenLevels(withServerTiles(presets, server, slideId), levels);
  const closeAll = () => {
    views.close();
    close();
  };
  return { reader, sam, plan: (preset) => reader.plan(preset), encoderSource, close: closeAll };
}

export function withEmbedderWarm(
  loader: SmartServicesLoader,
  options: EmbedderWarmOptions = {},
): SmartServicesLoader {
  return (context) => {
    if (context.slideId !== undefined && serverFirst(context))
      void warmEmbedderIfSlow(context.slideId, options);
    return loader(context);
  };
}

const loadWarmedRealServices = withEmbedderWarm(loadRealServices);

export const loadSmartServices: SmartServicesLoader = (context) => {
  const config = readBuildConfig();
  if (import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on" && config.fakeApi !== "off")
    return loadFakeServices(context, config.fakeApi === "all");
  return loadWarmedRealServices(context);
};

type SharedEntry = { readonly loaded: Promise<SmartServices>; holders: number };

export function shareServices(loader: SmartServicesLoader): SmartServicesLoader {
  const shared = new Map<string, SharedEntry>();
  return (context) => {
    const key = serverFirst(context) ? "server-first" : "browser";
    let entry = shared.get(key);
    if (entry === undefined) {
      const created: SharedEntry = { loaded: loader(context), holders: 0 };
      created.loaded.catch(() => {
        if (shared.get(key) === created) shared.delete(key);
      });
      shared.set(key, created);
      entry = created;
    }
    const held = entry;
    held.holders += 1;
    let released = false;
    return held.loaded.then((services) => ({
      ...services,
      close: () => {
        if (released) return;
        released = true;
        held.holders -= 1;
        if (held.holders > 0) return;
        if (shared.get(key) === held) shared.delete(key);
        services.close();
      },
    }));
  };
}
