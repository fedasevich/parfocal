import { type GpuWaiting, getScoreViewMapTileUrl } from "@parfocal/api-client";
import type { ViewMapScorer, ViewMapTileRequest } from "@parfocal/viewer-engine";
import { type FakeApiMode, readBuildConfig } from "../config.ts";
import { type GpuCancel, serverGpuCancel, untilGpuAnswers } from "../gpu/gpu-wait.ts";

export const fakeTumorSpots = [
  { x: 0.32, y: 0.4, radius: 0.08, peak: 0.99 },
  { x: 0.64, y: 0.58, radius: 0.05, peak: 0.9 },
  { x: 0.5, y: 0.22, radius: 0.03, peak: 0.6 },
] as const;

export function fakeTumorProbability(
  slide: { readonly width: number; readonly height: number },
  x: number,
  y: number,
): number {
  const side = Math.max(slide.width, slide.height);
  let highest = 0;
  for (const spot of fakeTumorSpots) {
    const dx = (x - spot.x * slide.width) / (spot.radius * side);
    const dy = (y - spot.y * slide.height) / (spot.radius * side);
    highest = Math.max(highest, spot.peak * Math.exp(-(dx * dx + dy * dy)));
  }
  return highest;
}

export function createFakeViewMapScorer(slide: {
  readonly width: number;
  readonly height: number;
}): ViewMapScorer & { readonly asked: ViewMapTileRequest[] } {
  const asked: ViewMapTileRequest[] = [];
  const scorer = (request: ViewMapTileRequest) => {
    asked.push(request);
    const values = new Uint8Array(request.width * request.height);
    for (let row = 0; row < request.height; row++) {
      for (let column = 0; column < request.width; column++) {
        const x = request.area.x + (column + 0.5) * request.cell;
        const y = request.area.y + (row + 0.5) * request.cell;
        values[row * request.width + column] = Math.round(255 * fakeTumorProbability(slide, x, y));
      }
    }
    return Promise.resolve(values);
  };
  return Object.assign(scorer, { asked });
}

export function queuedScorer(holdMs = 300): ViewMapScorer {
  return () => {
    let waited = 0;
    return untilGpuAnswers<Uint8Array>(
      "view-map",
      (call, signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            waited += holdMs / 1000;
            resolve({
              waiting: {
                state: "waiting",
                call: call ?? "queued",
                waited_seconds: waited,
                hold_seconds: holdMs / 1000,
              },
            });
          }, holdMs);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("The queued view tile was cancelled"));
          });
        }),
      () => Promise.resolve(),
    );
  };
}

export function fakeGpuQueued(search: string = globalThis.location?.search ?? ""): boolean {
  return new URLSearchParams(search).get("gpu") === "queued";
}

export type ViewTilePost = (slideId: string, column: number, row: number) => Promise<Uint8Array>;

export function viewTilePoster(cancelCall: GpuCancel = serverGpuCancel): ViewTilePost {
  return (slideId, column, row) =>
    untilGpuAnswers(
      "view-map",
      async (call, signal) => {
        const params = call === null ? undefined : { call };
        const response = await fetch(getScoreViewMapTileUrl(slideId, column, row, params), {
          method: "POST",
          credentials: "same-origin",
          signal,
        });
        if (response.status === 202) return { waiting: (await response.json()) as GpuWaiting };
        if (!response.ok) throw new Error("The view tile could not be mapped");
        return { answered: new Uint8Array(await response.arrayBuffer()) };
      },
      cancelCall,
    );
}

export const postViewTile: ViewTilePost = viewTilePoster();

export function createServerViewMapScorer(
  slideId: string,
  post: ViewTilePost = postViewTile,
): ViewMapScorer {
  return async (request) => {
    const values = await post(slideId, request.key.column, request.key.row);
    if (values.length !== request.width * request.height) {
      throw new Error("The view tile came back with the wrong number of cells");
    }
    return values;
  };
}

export type ViewMapSource = "fake" | "server" | null;

export function viewMapSourceOf(config: {
  readonly fakeApi: FakeApiMode;
  readonly devTools: boolean;
}): ViewMapSource {
  if (config.fakeApi === "off") return "server";
  return config.devTools ? "fake" : null;
}

export function buildViewMapSource(): ViewMapSource {
  return viewMapSourceOf({
    fakeApi: readBuildConfig().fakeApi,
    devTools: import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on",
  });
}

export function viewMapScorerFor(
  source: ViewMapSource,
  slide: { readonly width: number; readonly height: number },
  slideId: string,
  post?: ViewTilePost,
): ViewMapScorer | null {
  if (source === "fake") return fakeGpuQueued() ? queuedScorer() : createFakeViewMapScorer(slide);
  if (source === "server") return createServerViewMapScorer(slideId, post);
  return null;
}
