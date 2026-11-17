import { HttpResponse, http, type RequestHandler } from "msw";
import { getListAnnotationLayersMockHandler } from "../generated/api.msw.ts";
import {
  type AnnotationLayers,
  type OutlinesToType,
  type OutlineTypes,
  type TierMapping,
  type TypedOutline,
  TyperClass,
} from "../generated/api.ts";
import { liveModelTiers } from "./console-handlers.ts";
import { slideByIndex } from "./scenario.ts";
import { layersOnA1 } from "./scenario-viewer-tools.ts";
import { servingOf } from "./worker-outage.ts";

export const toAnnotationLayers = (slideId: string): AnnotationLayers => ({
  slide_id: slideId,
  layers: slideId === slideByIndex(1).id ? layersOnA1 : [],
  new_shapes_go_to: slideId === slideByIndex(1).id ? "area2-tumor" : "",
});

export const toModelTiers = (): TierMapping[] =>
  liveModelTiers().map((mapping) => ({ ...mapping, serving: servingOf(mapping.model?.name) }));

export const getListModelTiersMockHandler = (overrideResponse?: TierMapping[]) =>
  http.get("*/api/tenant/model-tiers", () => HttpResponse.json(overrideResponse ?? toModelTiers()));

const typerClasses = Object.values(TyperClass);

export const fakeTyper = { typer: "pathosam-hovernext", version: "v1.2" } as const;

const centroidOf = (points: readonly number[]) => {
  let x = 0;
  let y = 0;
  const vertices = points.length >> 1;
  for (let i = 0; i < vertices * 2; i += 2) {
    x += points[i] ?? 0;
    y += points[i + 1] ?? 0;
  }
  return { x: x / Math.max(1, vertices), y: y / Math.max(1, vertices) };
};

export const fakeTypedOutline = (points: readonly number[]): TypedOutline => {
  const centre = centroidOf(points);
  const cell = Math.abs(Math.floor(centre.x / 32) + Math.floor(centre.y / 32));
  const top = typerClasses[cell % typerClasses.length] ?? "other";
  const close = cell % 3 === 2;
  const lead = close ? 0.46 : 0.82;
  const second = close ? 0.4 : 0.1;
  const runnerUp = typerClasses[(cell + 1) % typerClasses.length] ?? "other";
  const rest = (1 - lead - second) / 2;
  const probabilities = { tumor: rest, stroma: rest, immune: rest, other: rest };
  probabilities[top] = lead;
  probabilities[runnerUp] = second;
  return {
    probabilities,
    type: top,
    alternatives: close ? [runnerUp] : [],
    foreground: cell % 4 === 3 ? 0.35 : 0.9,
  };
};

export const toOutlineTypes = (
  slideId: string,
  outlines: readonly { points: readonly number[] }[],
): OutlineTypes => ({
  slide_id: slideId,
  ...fakeTyper,
  calibrated: true,
  outlines: outlines.map((outline) => fakeTypedOutline(outline.points)),
});

const maxOutlines = 500;

const sendable = (body: Partial<OutlinesToType> | null): body is OutlinesToType =>
  Array.isArray(body?.outlines) &&
  body.outlines.length >= 1 &&
  body.outlines.length <= maxOutlines &&
  body.outlines.every((outline) => Array.isArray(outline.points) && outline.points.length >= 6);

export const fakeTypeOutlinesHandler = (overrideResponse?: OutlineTypes) =>
  http.post<{ slideId: string }>(
    "*/api/slides/:slideId/outline-types",
    async ({ params, request }) => {
      const body = (await request.json()) as Partial<OutlinesToType> | null;
      if (!sendable(body)) {
        return HttpResponse.json(
          { type: "about:blank", title: "Send one to 500 closed outlines", status: 422 },
          { status: 422 },
        );
      }
      return HttpResponse.json(overrideResponse ?? toOutlineTypes(params.slideId, body.outlines));
    },
  );

export const viewerToolsHandlers = (): RequestHandler[] => [
  fakeTypeOutlinesHandler(),
  getListModelTiersMockHandler(),
  getListAnnotationLayersMockHandler(({ params }) => toAnnotationLayers(String(params.slideId))),
];
