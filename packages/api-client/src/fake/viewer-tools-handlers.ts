import { HttpResponse, http, type RequestHandler } from "msw";
import { type AnnotationLayers, annotationLayersSchema } from "../draft/list-annotation-layers.ts";
import {
  type OutlineTypes,
  outlineTypesDraftSchema,
  outlineTypesSchema,
  type TypedOutline,
  typerClasses,
} from "../draft/type-outlines.ts";
import type { TierMapping } from "../generated/api.ts";
import { liveModelTiers } from "./console-handlers.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { slideByIndex } from "./scenario.ts";
import { layersOnA1 } from "./scenario-viewer-tools.ts";

export const toAnnotationLayers = (slideId: string): AnnotationLayers =>
  annotationLayersSchema.parse({
    slide_id: slideId,
    layers: slideId === slideByIndex(1).id ? layersOnA1 : [],
    new_shapes_go_to: slideId === slideByIndex(1).id ? "area2-tumor" : "",
  });

export const toModelTiers = (): TierMapping[] => liveModelTiers();

export const getListAnnotationLayersMockHandler = (overrideResponse?: AnnotationLayers) =>
  http.get<{ slideId: string }>("*/api/slides/:slideId/annotation-layers", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toAnnotationLayers(params.slideId)),
  );

export const getListModelTiersMockHandler = (overrideResponse?: TierMapping[]) =>
  http.get("*/api/tenant/model-tiers", () => HttpResponse.json(overrideResponse ?? toModelTiers()));

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
): OutlineTypes =>
  outlineTypesSchema.parse({
    slide_id: slideId,
    ...fakeTyper,
    calibrated: true,
    outlines: outlines.map((outline) => fakeTypedOutline(outline.points)),
  });

export const getTypeOutlinesMockHandler = (overrideResponse?: OutlineTypes) =>
  http.post<{ slideId: string }>(
    "*/api/slides/:slideId/outline-types",
    async ({ params, request }) => {
      const parsed = outlineTypesDraftSchema.safeParse(await request.json());
      if (!parsed.success) {
        return HttpResponse.json(
          { type: "about:blank", title: "Send one to 500 closed outlines", status: 400 },
          { status: 400 },
        );
      }
      return HttpResponse.json(
        overrideResponse ?? toOutlineTypes(params.slideId, parsed.data.outlines),
      );
    },
  );

export const viewerToolsDraftOperations: DraftOperation[] = [
  {
    operationId: "typeOutlines",
    method: "post",
    path: "/api/slides/{slide_id}/outline-types",
    handler: () => getTypeOutlinesMockHandler(),
  },
  {
    operationId: "listAnnotationLayers",
    method: "get",
    path: "/api/slides/{slide_id}/annotation-layers",
    handler: () => getListAnnotationLayersMockHandler(),
  },
];

export const viewerToolsHandlers = (): RequestHandler[] => [getListModelTiersMockHandler()];
