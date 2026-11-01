import { HttpResponse, http } from "msw";
import { type AnnotationLayers, annotationLayersSchema } from "../draft/list-annotation-layers.ts";
import { type ModelTiers, modelTiersSchema } from "../draft/list-model-tiers.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { slideByIndex } from "./scenario.ts";
import { layersOnA1, modelTiers } from "./scenario-viewer-tools.ts";

export const toAnnotationLayers = (slideId: string): AnnotationLayers =>
  annotationLayersSchema.parse({
    slide_id: slideId,
    layers: slideId === slideByIndex(1).id ? layersOnA1 : [],
    new_shapes_go_to: slideId === slideByIndex(1).id ? "area2-tumor" : "",
  });

export const toModelTiers = (): ModelTiers => modelTiersSchema.parse({ tiers: modelTiers });

export const getListAnnotationLayersMockHandler = (overrideResponse?: AnnotationLayers) =>
  http.get<{ slideId: string }>("*/api/slides/:slideId/annotation-layers", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toAnnotationLayers(params.slideId)),
  );

export const getListModelTiersMockHandler = (overrideResponse?: ModelTiers) =>
  http.get("*/api/tenant/model-tiers", () => HttpResponse.json(overrideResponse ?? toModelTiers()));

export const viewerToolsDraftOperations: DraftOperation[] = [
  {
    operationId: "listAnnotationLayers",
    method: "get",
    path: "/api/slides/{slide_id}/annotation-layers",
    handler: () => getListAnnotationLayersMockHandler(),
  },
  {
    operationId: "listModelTiers",
    method: "get",
    path: "/api/tenant/model-tiers",
    handler: () => getListModelTiersMockHandler(),
  },
];
