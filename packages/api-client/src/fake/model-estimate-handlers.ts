import { HttpResponse, http, type RequestHandler } from "msw";
import type { SlideEstimate } from "../generated/api.ts";

const secondsPerMm2 = 150.1;
const dollarsPerSecond = 0.0178 / 94.9;
const estimatedModel = "pathosam-hovernext";

const tissueOf = (slideId: string): number => {
  const sum = slideId.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return 20 + (sum % 41);
};

const estimateOf = (slideId: string, model: string): SlideEstimate => {
  if (model !== estimatedModel) {
    return { slide_id: slideId, tissue_mm2: null, minutes: null, dollars: null, projected: true };
  }
  const area = tissueOf(slideId);
  const seconds = area * secondsPerMm2;
  return {
    slide_id: slideId,
    tissue_mm2: area,
    minutes: Math.ceil(seconds / 60),
    dollars: Math.round(seconds * dollarsPerSecond * 10000) / 10000,
    projected: true,
  };
};

export const modelEstimateHandlers = (): RequestHandler[] => [
  http.get("*/api/projects/:projectId/models/:modelName/estimates", ({ params, request }) => {
    const slideIds = new URL(request.url).searchParams.getAll("slide_id");
    return HttpResponse.json(slideIds.map((id) => estimateOf(id, String(params.modelName))));
  }),
];
