import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { Problem } from "../generated/api.ts";
import { type DraftQueryOptions, type DraftRequest, defineDraftQuery } from "./define.ts";

export const sharedAiObjectSchema = z.object({
  object: z.string(),
  kind: z.enum(["region", "cell"]),
  number: z.number().int().positive(),
  class_id: z.string().nullable(),
  score: z.number().min(0).max(1),
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
});

export const sharedAiObjectsSchema = z.object({
  task_id: z.string(),
  slide_id: z.string(),
  result_set_id: z.string().nullable(),
  result_name: z.string().nullable(),
  objects: z.array(sharedAiObjectSchema),
});

export type SharedAiObject = z.infer<typeof sharedAiObjectSchema>;
export type SharedAiObjects = z.infer<typeof sharedAiObjectsSchema>;

export const getListSharedAiObjectsUrl = (taskId: string, slideId: string) =>
  `/api/review-tasks/${taskId}/slides/${slideId}/shared-layer/ai`;

const draft = defineDraftQuery(
  "listSharedAiObjects",
  getListSharedAiObjectsUrl,
  sharedAiObjectsSchema,
);

export type listSharedAiObjectsResponse = Awaited<ReturnType<typeof draft.fetcher>>;
export type ListSharedAiObjectsQueryResult = listSharedAiObjectsResponse;
export type ListSharedAiObjectsQueryError = Problem;

export const listSharedAiObjects = (taskId: string, slideId: string, options?: DraftRequest) =>
  draft.fetcher([taskId, slideId], options);

export const getListSharedAiObjectsQueryKey = (taskId: string, slideId: string) =>
  draft.queryKey(taskId, slideId);

export const getListSharedAiObjectsQueryOptions = <
  TData = listSharedAiObjectsResponse,
  TError = Problem,
>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<listSharedAiObjectsResponse, TData, TError>,
) => draft.queryOptions<TData, TError>([taskId, slideId], options);

export const useListSharedAiObjects = <TData = listSharedAiObjectsResponse, TError = Problem>(
  taskId: string,
  slideId: string,
  options?: DraftQueryOptions<listSharedAiObjectsResponse, TData, TError>,
  queryClient?: QueryClient,
) => draft.useDraftQuery<TData, TError>([taskId, slideId], options, queryClient);
