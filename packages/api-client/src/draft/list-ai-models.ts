import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const AiModelStatus = {
  active: "active",
  answering: "answering",
  "imports-only": "imports-only",
  hidden: "hidden",
} as const;

export const aiModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  source: z.enum(["parfocal", "lab"]),
  makes: z.array(z.string()),
  description: z.string(),
  runs_on: z.string(),
  who_can_run: z.string(),
  result_sets: z.number().int().nonnegative(),
  shown: z.boolean(),
  status: z.enum(AiModelStatus),
  latency_ms: z.number().int().nonnegative().nullable(),
});

export type AiModel = z.infer<typeof aiModelSchema>;

export const aiModelRunSchema = z.object({
  id: z.string(),
  model: z.string(),
  project: z.object({ id: z.string(), code: z.string(), name: z.string() }),
  slides: z.number().int().nonnegative(),
  slides_done: z.number().int().nonnegative(),
  started_by: z.string(),
});

export type AiModelRun = z.infer<typeof aiModelRunSchema>;

export const aiModelsSchema = z.object({
  models: z.array(aiModelSchema),
  running: z.array(aiModelRunSchema),
});

export type AiModels = z.infer<typeof aiModelsSchema>;

export const getListAiModelsUrl = () => "/api/tenant/models";

const draft = defineDraftQuery("listAiModels", getListAiModelsUrl, aiModelsSchema);

export type listAiModelsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListAiModelsQueryResult = listAiModelsResponse;
export type ListAiModelsQueryError = Problem;

export const listAiModels = (options?: DraftRequest) => draft.fetcher([], options);

export const getListAiModelsQueryKey = () => draft.queryKey();

export const getListAiModelsQueryOptions = <TData = listAiModelsResponse, TError = Problem>(
  options?: DraftQueryOptions<listAiModelsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([], options);

export const useListAiModels = <TData = listAiModelsResponse, TError = Problem>(
  options?: DraftQueryOptions<listAiModelsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([], options, queryClient);
